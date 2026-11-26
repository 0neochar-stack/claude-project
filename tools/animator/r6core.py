"""Python twin of r6core.js (same pose format, interpolation and R6 maths). Keep them identical:
tools/animator/test_parity.py runs both on the same animations and compares the results."""

import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "mocap"))
sys.path.insert(0, os.path.join(HERE, "..", "mocap", "vendor"))

import math3d as m  # noqa: E402
from cmu_to_r6 import R6_JOINTS, HRP_REST, cf_mul, cf_inv, POSE_TREE, write_rbxmx  # noqa: E402

PARTS = ["Torso", "Head", "Right Arm", "Left Arm", "Right Leg", "Left Leg"]
CHANNELS = [(p, c) for p in PARTS for c in ("x", "y", "z")] + [("Torso", "h")]


def part_rot(p):
    q = m.quat_mul(m.quat_mul(m.quat_from_axis_angle((0, 0, 1), math.radians(p.get("z", 0) or 0)),
                              m.quat_from_axis_angle((1, 0, 0), math.radians(p.get("x", 0) or 0))),
                   m.quat_from_axis_angle((0, 1, 0), math.radians(p.get("y", 0) or 0)))
    return m.quat_normalize(q)


def transforms(pose):
    out = {"HumanoidRootPart": ((0.0, 0.0, 0.0), m.QUAT_IDENTITY)}
    for _, p0, p1, c0, c1 in R6_JOINTS:
        pp = pose.get(p1, {}) or {}
        R = part_rot(pp)
        if p1 == "Torso":
            out[p1] = cf_mul(cf_mul(cf_inv(c0), ((0.0, pp.get("h", 0) or 0, 0.0), R)), c1)
        else:
            out[p1] = ((0.0, 0.0, 0.0), m.quat_normalize(m.quat_mul(m.quat_mul(m.quat_conj(c0[1]), R), c1[1])))
    return out


def fk(pose):
    T = transforms(pose)
    cfs = {"HumanoidRootPart": HRP_REST}
    for _, p0, p1, c0, c1 in R6_JOINTS:
        cfs[p1] = cf_mul(cf_mul(cf_mul(cfs[p0], c0), T[p1]), cf_inv(c1))
    return cfs


def _val(key, ch):
    return ((key["pose"].get(ch[0]) or {}).get(ch[1]) or 0)


def tangents(keys, loop, duration):
    n, T = len(keys), []
    for i in range(n):
        row = []
        for ch in CHANNELS:
            mm, ok = 0.0, True
            if 0 < i < n - 1:
                tp, pp, tn, pn = keys[i - 1]["t"], _val(keys[i - 1], ch), keys[i + 1]["t"], _val(keys[i + 1], ch)
            elif loop and n >= 3:
                if i == 0:
                    tp, pp, tn, pn = keys[n - 2]["t"] - duration, _val(keys[n - 2], ch), keys[1]["t"], _val(keys[1], ch)
                else:
                    tp, pp, tn, pn = keys[n - 2]["t"], _val(keys[n - 2], ch), keys[1]["t"] + duration, _val(keys[1], ch)
            else:
                ok = False
            if ok:
                p = _val(keys[i], ch)
                if (p - pp) * (pn - p) > 0:
                    mm = (pn - pp) / (tn - tp)
            row.append(mm)
        T.append(row)
    return T


def sample(anim, t, T=None):
    keys = anim["keys"]
    n = len(keys)
    if n == 0:
        return {}
    if n == 1 or t <= keys[0]["t"]:
        return json.loads(json.dumps(keys[0]["pose"]))
    if t >= keys[-1]["t"]:
        return json.loads(json.dumps(keys[-1]["pose"]))
    i = 0
    while i < n - 2 and t >= keys[i + 1]["t"]:
        i += 1
    a, b = keys[i], keys[i + 1]
    dt = b["t"] - a["t"]
    s = min(1.0, max(0.0, (t - a["t"]) / dt))
    feel = a.get("feel") or "smooth"
    T = T or tangents(keys, bool(anim.get("loop")), keys[-1]["t"])
    out = {}
    for c, ch in enumerate(CHANNELS):
        v0, v1 = _val(a, ch), _val(b, ch)
        if feel == "hold":
            v = v0 if s < 1 else v1
        elif feel == "snap":
            v = v0 + (v1 - v0) * (1 - (1 - s) ** 3)
        else:
            s2, s3 = s * s, s * s * s
            v = (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * dt * T[i][c] + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * dt * T[i + 1][c]
        out.setdefault(ch[0], {})[ch[1]] = v
    return out


def bake(anim, fps):
    keys = anim["keys"]
    end = keys[-1]["t"] if keys else 0.0
    T = tangents(keys, bool(anim.get("loop")), end)
    times = set()
    k = 0
    while k * (1.0 / fps) < end - 1e-6:
        times.add(round(k / fps, 4))
        k += 1
    times.add(round(end, 4))
    for i, key in enumerate(keys):
        times.add(round(key["t"], 4))
        if key.get("feel") == "hold" and i < len(keys) - 1:
            times.add(round(keys[i + 1]["t"] - 1 / 240, 4))
    return [(t, sample(anim, t, T)) for t in sorted(times)]
