#!/usr/bin/env python3
"""Turn ClaudeKit + clips into ready-to-send execute_luau payloads (so nothing is placed by hand).

  python3 -I tools/studio-toolkit/make_payloads.py [--clip path/to/X.R6.clip.json ...] [--chunk 40000]

Writes tools/studio-toolkit/payloads/:
  00_install.luau          creates ServerStorage.ClaudeKit (ModuleScript, Archivable=false) and runs selftest
  01_probe_10k.luau ...    payload-size probes (10 KB, 50 KB, 200 KB)
  clip_<name>_NN.luau      Kit.put chunks for each clip; the last chunk prints a summary
Each file is one execute_luau call. Send them in name order.
"""

import argparse
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "payloads")
KIT_LINE = 'local Kit = require(game:GetService("ServerStorage"):WaitForChild("ClaudeKit"))\n'


def long_string(text):
    level = 0
    while ("]" + "=" * level + "]") in text:
        level += 1
    eq = "=" * level
    return "[" + eq + "[\n" + text + "]" + eq + "]"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", action="append", default=[])
    ap.add_argument("--chunk", type=int, default=40000)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".luau"):
            os.remove(os.path.join(OUT, f))

    src = open(os.path.join(HERE, "ClaudeKit.luau"), encoding="utf-8").read()
    install = (
        "-- ClaudeKit install: Archivable=false, so it is never saved or published with the place\n"
        'local SS = game:GetService("ServerStorage")\n'
        'local old = SS:FindFirstChild("ClaudeKit")\n'
        "if old then old:Destroy() end\n"
        'local m = Instance.new("ModuleScript")\n'
        'm.Name = "ClaudeKit"\n'
        "m.Archivable = false\n"
        "m.Source = " + long_string(src) + "\n"
        "m.Parent = SS\n"
        "local Kit = require(m)\n"
        "print(Kit.selftest())\n"
    )
    open(os.path.join(OUT, "00_install.luau"), "w").write(install)

    for i, n in enumerate((10_000, 50_000, 200_000), start=1):
        open(os.path.join(OUT, f"0{i}_probe_{n // 1000}k.luau"), "w").write(
            KIT_LINE + f'print(Kit.put("probe", 1, string.rep("x", 1) .. {long_string("x" * (n - 1))}))\n'
        )

    for path in a.clip:
        data = open(path, encoding="utf-8").read()
        clip = json.loads(data)
        name = clip["name"]
        chunks = [data[i:i + a.chunk] for i in range(0, len(data), a.chunk)]
        for k, c in enumerate(chunks, start=1):
            body = KIT_LINE + f'print(Kit.put("{name}", {k}, {long_string(c)}))\n'
            if k == len(chunks):
                body += f'print(#Kit.get("{name}") == {len(data)} and "clip {name} complete ({len(data)} bytes)" or "SIZE MISMATCH")\n'
            open(os.path.join(OUT, f"clip_{name}_{k:02d}.luau"), "w").write(body)
        print(f"{name}: {len(chunks)} chunk(s), {len(data)} bytes")
    print("payloads in", OUT, "->", sorted(os.listdir(OUT)))


if __name__ == "__main__":
    main()
