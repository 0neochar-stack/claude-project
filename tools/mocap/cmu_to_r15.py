#!/usr/bin/env python3
"""CMU mocap BVH -> Roblox R15 KeyframeSequence (.rbxmx) + viewer JSON.

Built on the vendored, MIT-licensed retarget maths from Chrrxs/kimodo-r15-retarget
(see vendor/README.md), with a mapping for the CMU skeleton (cgspeed BVH release,
Motionbuilder-style joint names).

Usage:
  python3 -I tools/mocap/cmu_to_r15.py IN.bvh --start 1.2 --end 2.9 --name Jump360 \
      --out-dir out/ [--fps 30] [--root-motion keep|inplace|vertical] [--loop]
  python3 -I tools/mocap/cmu_to_r15.py IN.bvh --analyze      # find the move: hips height + spin over time

Retarget formula (see vendor/r15.py docstring):
  T_part = D_parent^-1 * (C * L_src * C^-1) * D_part,   D = quat_between(tgt_dir, C(src_dir))
Here src_dir is read from the BVH OFFSETs (the CMU rest pose has angled legs and T-pose arms),
and C also cancels the actor's starting heading so every clip starts facing Roblox -Z.

Checks printed after each run (no Studio needed):
  bone direction error (median / p95, degrees), lowest foot height, max frame-to-frame jump.
"""

import argparse
import json
import math
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))

import bvh as bvh_mod  # noqa: E402
import math3d as m  # noqa: E402
import r15  # noqa: E402
import rbxmx  # noqa: E402

GEOMETRY = json.load(open(os.path.join(HERE, "vendor", "r15_rig_geometry.json")))

# R15 part -> (CMU joints composed in order, CMU joint whose OFFSET gives the bone direction)
CMU_MAP = {
    "LowerTorso": (["Hips"], None),
    "UpperTorso": (["LowerBack", "Spine", "Spine1"], "Neck1"),
    "Head": (["Neck", "Neck1", "Head"], "Head"),  # End Sites aren't parsed; Neck1->Head is near-vertical
    "LeftUpperArm": (["LeftShoulder", "LeftArm"], "LeftForeArm"),
    "LeftLowerArm": (["LeftForeArm"], "LeftHand"),
    "LeftHand": (["LeftHand"], "LeftHandIndex1"),
    "RightUpperArm": (["RightShoulder", "RightArm"], "RightForeArm"),
    "RightLowerArm": (["RightForeArm"], "RightHand"),
    "RightHand": (["RightHand"], "RightHandIndex1"),
    "LeftUpperLeg": (["LHipJoint", "LeftUpLeg"], "LeftLeg"),
    "LeftLowerLeg": (["LeftLeg"], "LeftFoot"),
    "LeftFoot": (["LeftFoot"], "LeftToeBase"),
    "RightUpperLeg": (["RHipJoint", "RightUpLeg"], "RightLeg"),
    "RightLowerLeg": (["RightLeg"], "RightFoot"),
    "RightFoot": (["RightFoot"], "RightToeBase"),
}
UP, DOWN, FWD = (0.0, 1.0, 0.0), (0.0, -1.0, 0.0), (0.0, 0.0, -1.0)
TGT_DIR = {p: (FWD if p.endswith("Foot") else UP if p in ("LowerTorso", "UpperTorso", "Head") else DOWN)
           for p in CMU_MAP}
# Accuracy check: each R15 part's long axis (-Y for limbs, +Y for the torso) vs the CMU bone it copies.
# (Joint-to-joint lines are no good here: R15 shoulder joints sit at the arm's top inner corner.)
CHECK_PARTS = [
    ("LeftUpperArm", -1, "LeftArm", "LeftForeArm"), ("LeftLowerArm", -1, "LeftForeArm", "LeftHand"),
    ("RightUpperArm", -1, "RightArm", "RightForeArm"), ("RightLowerArm", -1, "RightForeArm", "RightHand"),
    ("LeftUpperLeg", -1, "LeftUpLeg", "LeftLeg"), ("LeftLowerLeg", -1, "LeftLeg", "LeftFoot"),
    ("RightUpperLeg", -1, "RightUpLeg", "RightLeg"), ("RightLowerLeg", -1, "RightLeg", "RightFoot"),
    ("UpperTorso", 1, "Spine", "Neck1"),
]


# ---------------------------------------------------------------- BVH helpers
def end_site_offset(joint):
    """OFFSET of a joint's End Site if the vendored parser kept it (else None)."""
    return getattr(joint, "end_site", None) or getattr(joint, "end_offset", None)


def bone_offset(anim, child_name):
    if child_name.endswith("_End"):
        j = anim.joint_map[child_name[:-4]]
        off = end_site_offset(j)
        return off if off else (0.0, 1.0, 0.0)
    return anim.joint_map[child_name].offset


def bvh_world(anim, frame):
    """World rotation (quat) and position for every BVH joint at a frame (file units)."""
    rot, pos = {}, {}
    for j in anim.joints:
        name = j.name
        local_q = anim.joint_rotation_quat(name, frame)
        local_p = anim.joint_translation(name, frame)
        if j.parent is None:
            rot[name], pos[name] = local_q, local_p
        else:
            pq, pp = rot[j.parent.name], pos[j.parent.name]
            pos[name] = m.vec_add(pp, m.quat_rotate(pq, local_p))
            rot[name] = m.quat_mul(pq, local_q)
    return rot, pos


def heading_deg(q):
    """Yaw of the hips' forward (+Z in CMU rest) projected on the floor."""
    f = m.quat_rotate(q, (0.0, 0.0, 1.0))
    return math.degrees(math.atan2(f[0], f[2]))


# ---------------------------------------------------------------- R15 FK (Animator formula)
def cf_mul(a, b):
    (pa, qa), (pb, qb) = a, b
    return (m.vec_add(pa, m.quat_rotate(qa, pb)), m.quat_normalize(m.quat_mul(qa, qb)))


def fk_r15(transforms, root_cf=((0.0, 0.0, 0.0), m.QUAT_IDENTITY)):
    """Part CFrames + joint world positions: Part1 = Part0 * C0 * Transform * C1^-1."""
    cfs, joints = {"HumanoidRootPart": root_cf}, {}
    for j in GEOMETRY["joints"]:
        t = transforms.get(j["part1"], ((0.0, 0.0, 0.0), m.QUAT_IDENTITY))
        at_joint = cf_mul(cfs[j["part0"]], (tuple(j["a0"]), m.QUAT_IDENTITY))
        joints[j["name"]] = at_joint[0]
        cf = cf_mul(at_joint, t)
        cfs[j["part1"]] = cf_mul(cf, (tuple(-v for v in j["a1"]), m.QUAT_IDENTITY))
    return cfs, joints


def r15_rest_metrics():
    cfs, joints = fk_r15({})
    foot_bottom = min(cfs[p][0][1] - GEOMETRY["parts"][p][1] / 2 for p in ("LeftFoot", "RightFoot"))
    leg = (m.vec_length(m.vec_sub(joints["LeftHip"], joints["LeftKnee"]))
           + m.vec_length(m.vec_sub(joints["LeftKnee"], joints["LeftAnkle"])))
    return foot_bottom, leg


# ---------------------------------------------------------------- retarget
def retarget(anim, frames, root_motion):
    """frames: list of BVH frame indices. Returns (transforms per frame, debug dict)."""
    # Units: match leg length (hip -> ankle) to R15.
    cmu_leg = m.vec_length(anim.joint_map["LeftLeg"].offset) + m.vec_length(anim.joint_map["LeftFoot"].offset)
    r15_foot_bottom, r15_leg = r15_rest_metrics()
    scale = r15_leg / cmu_leg

    # Facing: cancel the actor's heading at the first frame, then CMU +Z -> Roblox -Z.
    rot0, pos0 = bvh_world(anim, frames[0])
    yaw0 = heading_deg(rot0["Hips"])
    conv = m.quat_mul(m.quat_from_axis_angle(UP, math.pi), m.quat_from_axis_angle(UP, math.radians(-yaw0)))
    conv_inv = m.quat_conj(conv)

    D = {"HumanoidRootPart": m.QUAT_IDENTITY}
    for part, (chain, child) in CMU_MAP.items():
        src = UP if child is None else m.vec_normalize(bone_offset(anim, child))
        D[part] = m.quat_between(TGT_DIR[part], m.quat_rotate(conv, src))

    # Floor: lowest toe over the clip; standing hips height measured in the same clip.
    toe_heights, hips_heights = [], []
    worlds = []
    for f in frames:
        rw, pw = bvh_world(anim, f)
        worlds.append((rw, pw))
        toe_heights.append(min(pw["LeftToeBase"][1], pw["RightToeBase"][1], pw["LeftFoot"][1], pw["RightFoot"][1]))
    floor = min(toe_heights)
    start_xz = (pos0["Hips"][0], pos0["Hips"][2])

    out = []
    for (rw, pw) in worlds:
        frame_t = {"HumanoidRootPart": ((0.0, 0.0, 0.0), m.QUAT_IDENTITY)}
        for part in r15.PART_ORDER[1:]:
            chain, _ = CMU_MAP[part]
            l_src = m.QUAT_IDENTITY
            for jn in chain:
                l_src = m.quat_mul(l_src, local_rot(anim, rw, jn))
            l_rbx = m.quat_mul(m.quat_mul(conv, l_src), conv_inv)
            q = m.quat_mul(m.quat_mul(m.quat_conj(D[r15.POSE_PARENT[part]]), l_rbx), D[part])
            frame_t[part] = ((0.0, 0.0, 0.0), m.quat_normalize(q))
        out.append(frame_t)

    # Root motion on the LowerTorso pose. First pass with zero offset to find where R15 feet land.
    for i, (rw, pw) in enumerate(worlds):
        hips = pw["Hips"]
        d = (hips[0] - start_xz[0], 0.0, hips[2] - start_xz[1])
        d = m.vec_scale(m.quat_rotate(conv, d), scale)
        if root_motion == "inplace":
            d = (0.0, 0.0, 0.0)
        elif root_motion == "vertical":
            d = (0.0, 0.0, 0.0)
        out[i]["LowerTorso"] = (d, out[i]["LowerTorso"][1])
    # Vertical: put the lowest R15 foot of each frame where the CMU lowest foot is (relative to floor).
    for i, (rw, pw) in enumerate(worlds):
        if root_motion == "inplace":
            continue
        cfs, _ = fk_r15(out[i])
        r15_low = min(cfs[p][0][1] - GEOMETRY["parts"][p][1] / 2 for p in ("LeftFoot", "RightFoot"))
        cmu_low = (toe_heights[i] - floor) * scale
        dy = (r15_foot_bottom + cmu_low) - r15_low
        p, q = out[i]["LowerTorso"]
        out[i]["LowerTorso"] = ((p[0], p[1] + dy, p[2]), q)

    return out, {"scale": scale, "yaw0": yaw0, "conv": conv, "worlds": worlds, "floor": floor,
                 "foot_bottom": r15_foot_bottom}


def local_rot(anim, world_rot, name):
    j = anim.joint_map[name]
    if j.parent is None:
        return world_rot[name]
    return m.quat_mul(m.quat_conj(world_rot[j.parent.name]), world_rot[name])


# ---------------------------------------------------------------- checks
def run_checks(frames_t, dbg):
    conv = dbg["conv"]
    errs, low_feet, jumps = [], [], []
    prev = None
    for i, t in enumerate(frames_t):
        cfs, joints = fk_r15(t)
        rw, pw = dbg["worlds"][i]
        for part, sign, ca, cb in CHECK_PARTS:
            v_r = m.quat_rotate(cfs[part][1], (0.0, float(sign), 0.0))
            v_c = m.vec_normalize(m.quat_rotate(conv, m.vec_sub(pw[cb], pw[ca])))
            errs.append(math.degrees(math.acos(max(-1.0, min(1.0, m.vec_dot(v_r, v_c))))))
        low_feet.append(min(cfs[p][0][1] - GEOMETRY["parts"][p][1] / 2 for p in ("LeftFoot", "RightFoot"))
                        - dbg["foot_bottom"])
        if prev is not None:
            jumps.append(max(math.degrees(m.quat_angle_between(t[p][1], prev[p][1])) for p in t))
        prev = t
    errs.sort()
    return {
        "bone_dir_error_median_deg": round(statistics.median(errs), 2),
        "bone_dir_error_p95_deg": round(errs[int(len(errs) * 0.95)], 2),
        "lowest_foot_studs": round(min(low_feet), 3),
        "max_frame_jump_deg": round(max(jumps) if jumps else 0.0, 1),
    }


# ---------------------------------------------------------------- outputs
def resample_indices(src_fps, start_f, end_f, dst_fps):
    n = max(2, int(round((end_f - start_f) / src_fps * dst_fps)) + 1)
    return [start_f + round(k * src_fps / dst_fps) for k in range(n) if start_f + round(k * src_fps / dst_fps) <= end_f]


def viewer_json(name, fps, frames_t, dbg, source_meta):
    conv, scale = dbg["conv"], dbg["scale"]
    parts_out, src_out = [], []
    rw0, pw0 = dbg["worlds"][0]
    origin = (pw0["Hips"][0], dbg["floor"], pw0["Hips"][2])
    src_joints = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot",
                  "RightToeBase", "Spine", "Spine1", "Neck1", "Head", "LeftArm", "LeftForeArm", "LeftHand",
                  "RightArm", "RightForeArm", "RightHand"]
    for i, t in enumerate(frames_t):
        cfs, _ = fk_r15(t)
        row = {}
        for p, (pos, q) in cfs.items():
            if p == "HumanoidRootPart":
                continue
            row[p] = [round(pos[0], 4), round(pos[1] - dbg["foot_bottom"], 4), round(pos[2], 4)] + [round(v, 5) for v in q]
        parts_out.append(row)
        _, pw = dbg["worlds"][i]
        srow = []
        for jn in src_joints:
            v = m.vec_scale(m.quat_rotate(conv, m.vec_sub(pw[jn], origin)), scale)
            srow.append([round(v[0], 3), round(v[1], 3), round(v[2], 3)])
        src_out.append(srow)
    bones = [["Hips", "LeftUpLeg"], ["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["LeftFoot", "LeftToeBase"],
             ["Hips", "RightUpLeg"], ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"], ["RightFoot", "RightToeBase"],
             ["Hips", "Spine"], ["Spine", "Spine1"], ["Spine1", "Neck1"], ["Neck1", "Head"],
             ["Spine1", "LeftArm"], ["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"],
             ["Spine1", "RightArm"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"]]
    idx = {n: k for k, n in enumerate(src_joints)}
    return {"name": name, "fps": fps, "sizes": {p: s for p, s in GEOMETRY["parts"].items() if p != "HumanoidRootPart"},
            "frames": parts_out, "source": {"bones": [[idx[a], idx[b]] for a, b in bones], "frames": src_out},
            "meta": source_meta}


def analyze(anim, step_s=0.25):
    fps = anim.fps
    print("time   hipsY   heading  (cumulative spin)")
    prev_h, spin = None, 0.0
    f = 1
    while f < anim.nframes:
        rw, pw = bvh_world(anim, f)
        h = heading_deg(rw["Hips"])
        if prev_h is not None:
            d = (h - prev_h + 540) % 360 - 180
            spin += d
        prev_h = h
        print(f"{(f - 1) / fps:5.2f}  {pw['Hips'][1]:6.2f}  {h:7.1f}  {spin:8.1f}")
        f += max(1, int(round(step_s * fps)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--analyze", action="store_true")
    ap.add_argument("--step", type=float, default=0.1)
    ap.add_argument("--start", type=float, default=0.0, help="seconds after the T-pose frame")
    ap.add_argument("--end", type=float, default=None)
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--name", default=None)
    ap.add_argument("--out-dir", default=".")
    ap.add_argument("--root-motion", choices=["keep", "inplace", "vertical"], default="vertical",
                    help="keep: travel included; vertical: jumps up/down only (gameplay default); inplace: none")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--priority", default="Action")
    ap.add_argument("--reduce", type=float, default=0.5, help="keyframe reduction epsilon in degrees (0 = off)")
    args = ap.parse_args()

    anim = bvh_mod.Bvh.from_file(args.input)
    if args.analyze:
        analyze(anim, args.step)
        return
    fps_src = anim.fps
    start_f = 1 + int(round(args.start * fps_src))  # frame 0 is the added T-pose
    end_f = anim.nframes - 1 if args.end is None else min(anim.nframes - 1, 1 + int(round(args.end * fps_src)))
    idx = resample_indices(fps_src, start_f, end_f, args.fps)
    frames_t, dbg = retarget(anim, idx, args.root_motion)
    checks = run_checks(frames_t, dbg)

    name = args.name or os.path.splitext(os.path.basename(args.input))[0]
    os.makedirs(args.out_dir, exist_ok=True)
    # keyframe reduction reuses the vendored greedy reducer idea: keep frames whose slerp error exceeds epsilon
    kept = reduce(frames_t, args.reduce)
    keyframes = [(k / args.fps, frames_t[k]) for k in kept]
    rbxmx.write_rbxmx(os.path.join(args.out_dir, name + ".rbxmx"), name, keyframes, loop=args.loop, priority=args.priority)
    meta = {"source": os.path.basename(args.input), "start_s": args.start, "end_s": args.end, "fps": args.fps,
            "frames": len(frames_t), "keyframes": len(kept), "root_motion": args.root_motion,
            "studs_per_unit": round(dbg["scale"], 5), "start_heading_deg": round(dbg["yaw0"], 1), "checks": checks}
    with open(os.path.join(args.out_dir, name + ".view.json"), "w") as fh:
        json.dump(viewer_json(name, args.fps, frames_t, dbg, meta), fh, separators=(",", ":"))
    print(json.dumps(meta, indent=1))


def reduce(frames, eps_deg, pos_eps=0.01):
    if eps_deg <= 0 or len(frames) < 3:
        return list(range(len(frames)))
    kept, a = [0], 0
    while a < len(frames) - 1:
        b = a + 2
        while b < len(frames):
            ok = True
            for k in range(a + 1, b):
                u = (k - a) / (b - a)
                for p in frames[k]:
                    (p0, q0), (p1, q1), (pk, qk) = frames[a][p], frames[b][p], frames[k][p]
                    if math.degrees(m.quat_angle_between(m.quat_slerp(q0, q1, u), qk)) > eps_deg or \
                            m.vec_length(m.vec_sub(m.lerp_vec(p0, p1, u), pk)) > pos_eps:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                break
            b += 1
        a = b - 1
        kept.append(a)
    return kept


if __name__ == "__main__":
    main()
