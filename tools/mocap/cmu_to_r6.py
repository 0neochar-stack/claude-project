#!/usr/bin/env python3
"""CMU mocap BVH -> Roblox R6 KeyframeSequence (.rbxmx) + viewer JSON.

R6 has 6 blocks (Torso, Head, two arms, two legs) and no elbows or knees, so each limb block
aims from its shoulder/hip toward the hand/ankle, keeping the twist of the upper bone.
The torso takes its orientation from the spine (hips -> neck) and the shoulder line.

R6 Motor6D C0/C1 frames are rotated (classic Roblox values below), so every Transform is solved from
the desired world orientation:  T = C0^-1 * Part0^-1 * Part1 * C1   (Part1 = Part0 * C0 * T * C1^-1)

Usage:
  python3 -I tools/mocap/cmu_to_r6.py IN.bvh --start 1.95 --end 3.25 --name Jump360 --out-dir out/
      [--fps 60] [--root-motion keep|vertical|inplace] [--loop] [--priority Action]
"""

import argparse
import json
import math
import os
import sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))
sys.path.insert(0, HERE)

import bvh as bvh_mod  # noqa: E402
import math3d as m  # noqa: E402
import rbxmx  # noqa: E402  (CFrame property writer + priorities)
from cmu_to_r15 import bvh_world, heading_deg, resample_indices, reduce, UP  # noqa: E402

DOWN = (0.0, -1.0, 0.0)


def cf(x, y, z, *r):
    """Roblox CFrame.new(x,y,z, R00..R22) -> (pos, quat)."""
    return ((x, y, z), m.mat3_to_quat(((r[0], r[1], r[2]), (r[3], r[4], r[5]), (r[6], r[7], r[8]))))


# Classic R6 rig (Motor6D C0/C1 as created by Roblox for R6 characters).
R6_JOINTS = [
    # name, part0, part1, C0, C1
    ("RootJoint", "HumanoidRootPart", "Torso", cf(0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0), cf(0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0)),
    ("Neck", "Torso", "Head", cf(0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0), cf(0, -0.5, 0, -1, 0, 0, 0, 0, 1, 0, 1, 0)),
    ("Right Shoulder", "Torso", "Right Arm", cf(1, 0.5, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0), cf(-0.5, 0.5, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0)),
    ("Left Shoulder", "Torso", "Left Arm", cf(-1, 0.5, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0), cf(0.5, 0.5, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0)),
    ("Right Hip", "Torso", "Right Leg", cf(1, -1, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0), cf(0.5, 1, 0, 0, 0, 1, 0, 1, 0, -1, 0, 0)),
    ("Left Hip", "Torso", "Left Leg", cf(-1, -1, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0), cf(-0.5, 1, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0)),
]
SIZES = {"Torso": [2, 2, 1], "Head": [2, 1, 1], "Right Arm": [1, 2, 1], "Left Arm": [1, 2, 1],
         "Right Leg": [1, 2, 1], "Left Leg": [1, 2, 1]}
POSE_TREE = {"HumanoidRootPart": ["Torso"], "Torso": ["Head", "Right Arm", "Left Arm", "Right Leg", "Left Leg"]}
HRP_REST = ((0.0, 3.0, 0.0), m.QUAT_IDENTITY)  # standing R6: HRP/Torso centre 3 studs up, feet on y=0

# limb part -> (upper bone joint whose twist we keep, its child (bone dir), aim start joint, aim end joint)
LIMBS = {
    "Left Arm": ("LeftArm", "LeftForeArm", "LeftArm", "LeftHand"),
    "Right Arm": ("RightArm", "RightForeArm", "RightArm", "RightHand"),
    "Left Leg": ("LeftUpLeg", "LeftLeg", "LeftUpLeg", "LeftFoot"),
    "Right Leg": ("RightUpLeg", "RightLeg", "RightUpLeg", "RightFoot"),
}


def cf_mul(a, b):
    (pa, qa), (pb, qb) = a, b
    return (m.vec_add(pa, m.quat_rotate(qa, pb)), m.quat_normalize(m.quat_mul(qa, qb)))


def cf_inv(a):
    p, q = a
    qi = m.quat_conj(q)
    return (m.vec_scale(m.quat_rotate(qi, p), -1.0), qi)


def fk_r6(transforms, hrp=HRP_REST):
    cfs = {"HumanoidRootPart": hrp}
    for name, p0, p1, c0, c1 in R6_JOINTS:
        t = transforms.get(p1, ((0.0, 0.0, 0.0), m.QUAT_IDENTITY))
        cfs[p1] = cf_mul(cf_mul(cf_mul(cfs[p0], c0), t), cf_inv(c1))
    return cfs


def solve_rot(p0_rot, c0, c1, p1_rot):
    """Rotation of T so that Part1 gets world rotation p1_rot."""
    return m.quat_normalize(m.quat_mul(m.quat_mul(m.quat_mul(m.quat_conj(c0[1]), m.quat_conj(p0_rot)), p1_rot), c1[1]))


def basis_quat(right, up):
    """World rotation whose X axis is `right` and Y axis is `up` (orthogonalised)."""
    y = m.vec_normalize(up)
    x = m.vec_normalize(m.vec_sub(right, m.vec_scale(y, m.vec_dot(right, y))))
    z = m.vec_cross(x, y)
    return m.mat3_to_quat(((x[0], y[0], z[0]), (x[1], y[1], z[1]), (x[2], y[2], z[2])))


def foot_bottom(cfs, leg):
    p, q = cfs[leg]
    return min(m.quat_rotate(q, (sx * 0.5, -1.0, sz * 0.5))[1] + p[1] for sx in (-1, 1) for sz in (-1, 1))


def retarget(anim, idx, root_motion):
    rot0, pos0 = bvh_world(anim, idx[0])
    yaw0 = heading_deg(rot0["Hips"])
    conv = m.quat_mul(m.quat_from_axis_angle(UP, math.pi), m.quat_from_axis_angle(UP, math.radians(-yaw0)))
    conv_inv = m.quat_conj(conv)
    to_rbx_rot = lambda q: m.quat_mul(m.quat_mul(conv, q), conv_inv)  # noqa: E731

    # scale: CMU hip->ankle length onto the R6 leg (2 studs, hip pivot to bottom)
    leg_len = m.vec_length(anim.joint_map["LeftLeg"].offset) + m.vec_length(anim.joint_map["LeftFoot"].offset)
    scale = 2.0 / leg_len
    # rest corrections: R6 limb hangs down; CMU upper bone points along its child's OFFSET
    D = {part: m.quat_between(DOWN, m.quat_rotate(conv, m.vec_normalize(anim.joint_map[child].offset)))
         for part, (_, child, _, _) in LIMBS.items()}
    D_head = m.quat_between(UP, m.quat_rotate(conv, m.vec_normalize(anim.joint_map["Head"].offset)))

    worlds = [bvh_world(anim, f) for f in idx]
    floor = min(min(pw["LeftToeBase"][1], pw["RightToeBase"][1], pw["LeftFoot"][1], pw["RightFoot"][1]) for _, pw in worlds)
    start = pos0["Hips"]
    P = lambda pw, j: m.quat_rotate(conv, pw[j])  # noqa: E731  world position in Roblox axes (file units)

    frames, desired = [], []
    for rw, pw in worlds:
        # --- desired world rotations
        up = m.vec_sub(P(pw, "Neck1"), P(pw, "Hips"))
        right = m.vec_sub(P(pw, "RightArm"), P(pw, "LeftArm"))
        hips_right = m.vec_sub(P(pw, "RightUpLeg"), P(pw, "LeftUpLeg"))
        torso_q = basis_quat(m.vec_add(right, hips_right), up)
        want = {"Torso": torso_q,
                "Head": m.quat_mul(to_rbx_rot(rw["Head"]), D_head)}
        for part, (bone, _, a, b) in LIMBS.items():
            q_upper = m.quat_mul(to_rbx_rot(rw[bone]), D[part])
            cur = m.quat_rotate(q_upper, DOWN)
            aim = m.vec_normalize(m.vec_sub(P(pw, b), P(pw, a)))
            want[part] = m.quat_normalize(m.quat_mul(m.quat_between(cur, aim), q_upper))
        desired.append(want)

        # --- torso position: hips (scaled, relative to start/floor) + 1 stud up the spine
        hips = m.vec_sub(pw["Hips"], (start[0], floor, start[2]))
        if root_motion != "keep":
            hips = (0.0, hips[1], 0.0)
        hips_rbx = m.vec_scale(m.quat_rotate(conv, hips), scale)
        torso_pos = m.vec_add(hips_rbx, m.quat_rotate(torso_q, (0.0, 1.0, 0.0)))

        # --- R6 legs have no knees: tilt each rigid 2-stud leg so its bottom lands at the foot's real height
        #     (the classic R6 crouch: torso drops, legs angle out instead of the body being pushed up)
        torso_cf = (torso_pos, torso_q)
        for part, side, ankle, toe in (("Left Leg", -0.5, "LeftFoot", "LeftToeBase"), ("Right Leg", 0.5, "RightFoot", "RightToeBase")):
            top = cf_mul(torso_cf, ((side, -1.0, 0.0), m.QUAT_IDENTITY))[0]
            target_y = max(0.0, (min(pw[ankle][1], pw[toe][1]) - floor) * scale)
            dy = max(-1.0, min(1.0, (target_y - top[1]) / 2.0))
            q_leg = want[part]
            aim = m.quat_rotate(q_leg, DOWN)
            h = (aim[0], 0.0, aim[2])
            hl = m.vec_length(h)
            if hl < 0.05:  # leg nearly vertical: lean it toward the torso's front
                h = m.vec_scale(m.quat_rotate(torso_q, (0.0, 0.0, -1.0)), 1.0)
                h = (h[0], 0.0, h[2]); hl = m.vec_length(h) or 1.0
            k = math.sqrt(max(0.0, 1.0 - dy * dy)) / hl
            d = (h[0] * k, dy, h[2] * k)
            want[part] = m.quat_normalize(m.quat_mul(m.quat_between(aim, d), q_leg))

        # --- solve transforms
        t = {"HumanoidRootPart": ((0.0, 0.0, 0.0), m.QUAT_IDENTITY)}
        root = R6_JOINTS[0]
        t["Torso"] = cf_mul(cf_mul(cf_inv(root[3]), cf_mul(cf_inv(HRP_REST), torso_cf)), root[4])
        for name, p0, p1, c0, c1 in R6_JOINTS[1:]:
            t[p1] = ((0.0, 0.0, 0.0), solve_rot(torso_q, c0, c1, want[p1]))
        frames.append(t)

    # vertical fix: lowest R6 foot bottom sits as high above the floor as the lowest CMU foot
    for i, (rw, pw) in enumerate(worlds):
        if root_motion == "inplace":
            continue
        cfs = fk_r6(frames[i])
        r6_low = min(foot_bottom(cfs, "Left Leg"), foot_bottom(cfs, "Right Leg"))
        cmu_low = (min(pw["LeftToeBase"][1], pw["RightToeBase"][1], pw["LeftFoot"][1], pw["RightFoot"][1]) - floor) * scale
        dy_world = cmu_low - r6_low
        p, q = frames[i]["Torso"]
        # Torso transform translation is in the RootJoint C0 frame: convert the world shift
        d_local = m.quat_rotate(m.quat_conj(R6_JOINTS[0][3][1]), (0.0, dy_world, 0.0))
        frames[i]["Torso"] = (m.vec_add(p, d_local), q)
    if root_motion == "inplace":
        for i in range(len(frames)):
            frames[i]["Torso"] = ((0.0, 0.0, 0.0), frames[i]["Torso"][1])

    return frames, {"conv": conv, "scale": scale, "worlds": worlds, "floor": floor, "start": start,
                    "desired": desired, "yaw0": yaw0}


def checks(frames, dbg):
    errs, slips, prev_b = [], {"Left Leg": 0.0, "Right Leg": 0.0}, {}
    conv = dbg["conv"]
    for i, t in enumerate(frames):
        cfs = fk_r6(t)
        _, pw = dbg["worlds"][i]
        for part, (_, _, a, b) in LIMBS.items():
            if part.endswith("Leg"):
                continue
            v_r = m.quat_rotate(cfs[part][1], DOWN)
            v_c = m.vec_normalize(m.quat_rotate(conv, m.vec_sub(pw[b], pw[a])))
            errs.append(math.degrees(math.acos(max(-1.0, min(1.0, m.vec_dot(v_r, v_c))))))
        for leg in slips:
            p, q = cfs[leg]
            bot = m.vec_add(p, m.quat_rotate(q, (0.0, -1.0, 0.0)))
            if leg in prev_b and bot[1] < 0.08 and prev_b[leg][1] < 0.08:
                slips[leg] += math.hypot(bot[0] - prev_b[leg][0], bot[2] - prev_b[leg][2])
            prev_b[leg] = bot
    errs.sort()
    low = min(min(foot_bottom(fk_r6(t), "Left Leg"), foot_bottom(fk_r6(t), "Right Leg")) for t in frames)
    return {"arm_aim_error_median_deg": round(errs[len(errs) // 2], 2), "arm_aim_error_max_deg": round(errs[-1], 2),
            "lowest_foot_studs": round(low, 3), "foot_slip_planted_studs": round(max(slips.values()), 2)}


def write_rbxmx(path, name, keyframes, loop, priority):
    refs = rbxmx._RefCounter()
    root = ET.Element("roblox", {"version": "4"})
    seq = ET.SubElement(root, "Item", {"class": "KeyframeSequence", "referent": refs.next()})
    sp = ET.SubElement(seq, "Properties")
    rbxmx._prop(sp, "string", "Name", name)
    rbxmx._prop(sp, "bool", "Loop", "true" if loop else "false")
    rbxmx._prop(sp, "token", "Priority", str(rbxmx.ANIMATION_PRIORITY[priority]))

    def pose(parent, part, t):
        it = ET.SubElement(parent, "Item", {"class": "Pose", "referent": refs.next()})
        pr = ET.SubElement(it, "Properties")
        rbxmx._prop(pr, "string", "Name", part)
        pos, q = t.get(part, ((0.0, 0.0, 0.0), m.QUAT_IDENTITY))
        rbxmx._cframe_prop(pr, "CFrame", pos, q)
        rbxmx._prop(pr, "float", "Weight", "1")
        rbxmx._prop(pr, "float", "MaskWeight", "0")
        rbxmx._prop(pr, "token", "EasingDirection", "0")
        rbxmx._prop(pr, "token", "EasingStyle", "0")
        for child in POSE_TREE.get(part, []):
            pose(it, child, t)

    for time_s, t in keyframes:
        kf = ET.SubElement(seq, "Item", {"class": "Keyframe", "referent": refs.next()})
        kp = ET.SubElement(kf, "Properties")
        rbxmx._prop(kp, "string", "Name", "Keyframe")
        rbxmx._prop(kp, "float", "Time", rbxmx._fmt(float(time_s)))
        pose(kf, "HumanoidRootPart", t)
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    with open(path, "wb") as f:
        tree.write(f, encoding="utf-8", xml_declaration=False)
        f.write(b"\n")


def viewer_json(name, fps, frames, dbg, meta):
    conv, scale = dbg["conv"], dbg["scale"]
    start, floor = dbg["start"], dbg["floor"]
    src_joints = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot",
                  "RightToeBase", "Spine", "Spine1", "Neck1", "Head", "LeftArm", "LeftForeArm", "LeftHand",
                  "RightArm", "RightForeArm", "RightHand"]
    keep = meta["root_motion"] == "keep"
    out, src = [], []
    for i, t in enumerate(frames):
        cfs = fk_r6(t)
        out.append({p: [round(v, 4) for v in pos] + [round(v, 5) for v in q] for p, (pos, q) in cfs.items() if p != "HumanoidRootPart"})
        _, pw = dbg["worlds"][i]
        hx, hz = (pw["Hips"][0], pw["Hips"][2]) if not keep else (start[0], start[2])
        row = []
        for j in src_joints:
            v = m.vec_scale(m.quat_rotate(conv, m.vec_sub(pw[j], (hx, floor, hz))), scale)
            row.append([round(v[0], 3), round(v[1], 3), round(v[2], 3)])
        src.append(row)
    bones = [["Hips", "LeftUpLeg"], ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
             ["Hips", "RightUpLeg"], ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
             ["Hips", "Spine"], ["Spine", "Spine1"], ["Spine1", "Neck1"], ["Neck1", "Head"],
             ["Spine1", "LeftArm"], ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"],
             ["Spine1", "RightArm"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"]]
    ix = {n: k for k, n in enumerate(src_joints)}
    return {"name": name, "rig": "R6", "fps": fps, "sizes": SIZES, "frames": out,
            "source": {"bones": [[ix[a], ix[b]] for a, b in bones], "frames": src}, "meta": meta}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--end", type=float, default=None)
    ap.add_argument("--fps", type=float, default=60.0)
    ap.add_argument("--name", default=None)
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--root-motion", choices=["keep", "vertical", "inplace"], default="keep")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--priority", default="Action")
    ap.add_argument("--reduce", type=float, default=0.5)
    a = ap.parse_args()
    anim = bvh_mod.Bvh.from_file(a.input)
    s0 = 1 + int(round(a.start * anim.fps))
    s1 = anim.nframes - 1 if a.end is None else min(anim.nframes - 1, 1 + int(round(a.end * anim.fps)))
    idx = resample_indices(anim.fps, s0, s1, a.fps)
    frames, dbg = retarget(anim, idx, a.root_motion)
    name = a.name or os.path.splitext(os.path.basename(a.input))[0]
    os.makedirs(a.out_dir, exist_ok=True)
    kept = reduce(frames, a.reduce)
    write_rbxmx(os.path.join(a.out_dir, name + ".R6.rbxmx"), name, [(k / a.fps, frames[k]) for k in kept], a.loop, a.priority)
    meta = {"source": os.path.basename(a.input), "start_s": a.start, "end_s": a.end, "fps": a.fps, "rig": "R6",
            "frames": len(frames), "keyframes": len(kept), "root_motion": a.root_motion,
            "studs_per_unit": round(dbg["scale"], 5), "checks": checks(frames, dbg)}
    with open(os.path.join(a.out_dir, name + ".R6.view.json"), "w") as fh:
        json.dump(viewer_json(name, a.fps, frames, dbg, meta), fh, separators=(",", ":"))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
