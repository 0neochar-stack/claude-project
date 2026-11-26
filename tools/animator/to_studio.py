#!/usr/bin/env python3
"""Animator page data -> Studio files.

Input: a JSON file holding one animation document, or a list of them (e.g. saved from ArtifactData
`list` on the animator's `animations` collection). Each doc: {name, loop, keys:[{t, feel, pose}]}.
Output per animation, in --out-dir:
  <name>.R6.rbxmx      KeyframeSequence (Insert From File / ClaudeKit import), poses baked at --fps, Linear
  <name>.R6.clip.json  ClaudeKit clip (tools/studio-toolkit) for import + round-trip checks

  python3 -I tools/animator/to_studio.py animations.json --out-dir tools/animator/out [--fps 30]
"""

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import r6core  # noqa: E402
from cmu_to_r6 import write_rbxmx, clip_json  # noqa: E402  (path set up by r6core)


def safe_name(s):
    return re.sub(r"[^A-Za-z0-9_-]+", "_", s or "Animation").strip("_")[:60] or "Animation"


def convert(doc, out_dir, fps):
    keys = sorted(doc.get("keys") or [], key=lambda k: k["t"])
    if len(keys) < 2:
        return None
    anim = {"keys": keys, "loop": bool(doc.get("loop"))}
    frames = [(t, r6core.transforms(pose)) for t, pose in r6core.bake(anim, fps)]
    name = safe_name(doc.get("name"))
    priority = doc.get("priority") or "Action"
    write_rbxmx(os.path.join(out_dir, name + ".R6.rbxmx"), name, frames, anim["loop"], priority)
    meta = {"source": "animator", "keys": len(keys), "frames": len(frames), "fps": fps,
            "duration": keys[-1]["t"], "feels": sorted({k.get("feel", "smooth") for k in keys})}
    with open(os.path.join(out_dir, name + ".R6.clip.json"), "w") as fh:
        json.dump(clip_json(name, frames, anim["loop"], priority, meta), fh, separators=(",", ":"))
    return name, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("--out-dir", default=os.path.join(HERE, "out"))
    ap.add_argument("--fps", type=float, default=30.0)
    a = ap.parse_args()
    data = json.load(open(a.input, encoding="utf-8"))
    docs = data if isinstance(data, list) else data.get("documents") or data.get("docs") or [data]
    os.makedirs(a.out_dir, exist_ok=True)
    for d in docs:
        d = d.get("data", d) if isinstance(d, dict) else d
        r = convert(d, a.out_dir, a.fps)
        print(r if r else f"skipped {d.get('name')!r}: needs at least 2 keys")


if __name__ == "__main__":
    main()
