#!/usr/bin/env python3
"""Checks r6core.js and r6core.py agree (bake times, sampled poses, Motor6D transforms, part positions).
Also checks the joint maths against plain sanity facts (rest pose, arm raise direction, mirror).
Run: python3 -I tools/animator/test_parity.py   (needs node on PATH)"""

import json
import math
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import r6core as py  # noqa: E402

random.seed(7)
FEELS = ["smooth", "snap", "hold"]


def rand_anim(nkeys, loop):
    t, keys = 0.0, []
    for i in range(nkeys):
        pose = {p: {c: round(random.uniform(-120, 120), 2) for c in ("x", "y", "z")} for p in py.PARTS}
        pose["Torso"]["h"] = round(random.uniform(-1.2, 2.5), 3)
        keys.append({"t": round(t, 3), "feel": random.choice(FEELS), "pose": pose})
        t += random.uniform(0.07, 0.6)
    if loop:
        keys[-1]["pose"] = json.loads(json.dumps(keys[0]["pose"]))
    return {"name": "test", "loop": loop, "keys": keys}


def main():
    anims = [rand_anim(n, loop) for n, loop in ((2, False), (3, True), (6, False), (9, True), (12, False))]
    js = r"""
const R6 = require(process.argv[1]);
const anims = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const out = anims.map(a => R6.bake(a, 30).map(([t, pose]) => {
  const T = R6.transforms(pose), W = R6.fk(pose);
  return [t, pose, Object.fromEntries(Object.entries(T).map(([k, v]) => [k, [...v[0], ...v[1]]])),
             Object.fromEntries(Object.entries(W).map(([k, v]) => [k, [...v[0], ...v[1]]]))];
}));
process.stdout.write(JSON.stringify(out));
"""
    res = subprocess.run(["node", "-e", js, os.path.join(HERE, "r6core.js")], input=json.dumps(anims),
                         capture_output=True, text=True, check=True)
    js_out = json.loads(res.stdout)
    worst = {"time": 0.0, "pose_deg": 0.0, "transform_q": 0.0, "transform_p": 0.0, "world_p": 0.0}
    for a, jframes in zip(anims, js_out):
        pframes = py.bake(a, 30)
        assert len(pframes) == len(jframes), ("frame count", len(pframes), len(jframes))
        for (pt, ppose), (jt, jpose, jT, jW) in zip(pframes, jframes):
            worst["time"] = max(worst["time"], abs(pt - jt))
            for p in py.PARTS:
                for c, v in ppose.get(p, {}).items():
                    worst["pose_deg"] = max(worst["pose_deg"], abs(v - jpose[p][c]))
            pT, pW = py.transforms(ppose), py.fk(ppose)
            for part, (pos, q) in pT.items():
                if part == "HumanoidRootPart":
                    continue
                jv = jT[part]
                sign = 1 if sum(a * b for a, b in zip(q, jv[3:])) >= 0 else -1
                worst["transform_q"] = max(worst["transform_q"], max(abs(a - sign * b) for a, b in zip(q, jv[3:])))
                worst["transform_p"] = max(worst["transform_p"], max(abs(a - b) for a, b in zip(pos, jv[:3])))
            for part, (pos, q) in pW.items():
                worst["world_p"] = max(worst["world_p"], max(abs(a - b) for a, b in zip(pos, jW[part][:3])))
    print("parity worst differences:", {k: f"{v:.2e}" for k, v in worst.items()})
    ok = worst["time"] < 1e-9 and worst["pose_deg"] < 1e-6 and worst["transform_q"] < 1e-6 and worst["world_p"] < 1e-3

    # sanity: rest pose = classic R6 layout; raising the right arm 90 deg points it to the character's right (+X)
    rest = py.fk({})
    sane = all(abs(a - b) < 1e-6 for a, b in zip(rest["Right Arm"][0], (1.5, 3.0, 0.0)))
    arm = py.fk({"Right Arm": {"z": 90}})["Right Arm"]
    down = m_rot(arm[1], (0, -1, 0))
    sane = sane and down[0] > 0.99
    fwd = m_rot(py.fk({"Right Arm": {"x": 90}})["Right Arm"][1], (0, -1, 0))
    sane = sane and fwd[2] < -0.99  # swing +90 points the arm forward (-Z)
    print("sanity (rest layout, raise -> +X, swing -> forward):", sane)
    print("PASS" if ok and sane else "FAIL")
    sys.exit(0 if ok and sane else 1)


def m_rot(q, v):
    return py.m.quat_rotate(q, v)


if __name__ == "__main__":
    main()
