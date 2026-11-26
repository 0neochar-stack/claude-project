---
name: roblox-studio-toolkit
description: Claude's own Studio toolkit (ClaudeKit) plus the motion-capture animation pipeline for Jay's R6 Roblox games. Use when importing, checking or previewing animations in Studio, reading a rig's real joints, taking screenshots of a pose from set camera angles, converting CMU motion capture to R6 or R15, or running the first-PC-session self-test. Works through Roblox's built-in Studio MCP (execute_luau + screen_capture); nothing is placed by hand.
---

# ClaudeKit + mocap pipeline

Jay doesn't place things by hand. Claude does the work through the built-in Studio MCP. ClaudeKit is a
ModuleScript of helper functions that return JSON, so Claude can read rigs, import animations, check
they play correctly, and point the camera for screenshots.

## Hard rules
- Don't touch Studio until Jay says go. Back up / save a version of the place before the first import.
- Every ClaudeKit write is undoable (ChangeHistoryService). Never publish, never spend Robux.
- ClaudeKit and its data are `Archivable = false`: never saved or published with the place.
- Never open or use anything in "Roblox Games (OLD COPY - do not use)".
- About one playtest per request (the N95 is slow). ClaudeKit works in Edit mode, so most checks
  need no playtest.

## Where things are (repo)
| Path | What |
|---|---|
| `tools/mocap/cmu_to_r6.py` | CMU BVH → R6 `.rbxmx` + `.view.json` (viewer) + `.clip.json` (ClaudeKit). Standard library Python only. |
| `tools/mocap/cmu_to_r15.py` | Same for R15 |
| `tools/mocap/out/` | Converted clips |
| `tools/mocap-viewer/` | Phone 3D viewer (published: https://claude.ai/artifact/RFFi2Hk4Dmb9G3bte2i4S4) |
| `tools/studio-toolkit/ClaudeKit.luau` | The Studio module |
| `tools/studio-toolkit/make_payloads.py` | Builds `payloads/*.luau`: each file is one execute_luau call |

Conversions run in a cloud session (it has Python). The PC session only sends payloads, so Jay's PC
needs no Python.

## First PC session: run in this order, report each result to Jay
1. Confirm the built-in Studio MCP is connected (Studio → Assistant → MCP settings). Read its tool list.
   Use the exact tool names it gives; don't assume them.
2. Send `payloads/00_install.luau` with execute_luau. It installs ClaudeKit and prints `selftest()` JSON:
   - `transform_moves_parts_in_edit_mode`: needed for posing in Edit mode
   - `register_keyframe_sequence`: needed for Animator playback without publishing
   - `animator_step_in_edit_mode`: needed for the Animator round trip. If false, run the round trip
     in one playtest instead.
   - `scriptable_camera`: needed for screenshots
3. Send `01/02/03_probe_*.luau`. The largest one that succeeds sets the safe `--chunk` size.
4. Send `clip_Jump360_*.luau` in order. The last chunk prints "complete".
5. `print(Kit.roundTrip("Jump360"))` uses a throwaway standard R6 rig. Read the verdict:
   - `joint_table_err` > 1°: the rig differs from classic R6. Run `Kit.inspectRig(<Jay's rig path>)` and
     put its C0/C1 values into `R6_JOINTS` in `cmu_to_r6.py`, then re-convert.
   - `animator_err` > 2°: an import or sign problem. Compare one Pose CFrame with the clip, and fix
     `buildKfs` or the converter.
   - `solver_err` > 1°: Studio didn't move the parts in Edit mode. Use a playtest for checks.
6. Ask Jay which rig to use, then `Kit.importClip("<rig path>", "Jump360")`. It lands in
   `<rig>.AnimSaves`, ready for the Animation Editor or Moon Animator. Publishing the animation is Jay's
   click.
7. Look at it: `Kit.filmstripPlan("Jump360", 6)`, then for each time `Kit.poseAt` → `Kit.frame(rig,
   "side")` → screen_capture. Finish with `Kit.reset(rig)` and `Kit.restoreCamera()`.
8. Write what passed or failed into this file (Status section) so the next session knows.

## Function contract (all return JSON strings)
```luau
local Kit = require(game:GetService("ServerStorage"):WaitForChild("ClaudeKit"))
Kit.selftest()                              -- capability report (makes and removes a throwaway R6 rig)
Kit.inspectRig("Workspace.MyRig")           -- parts, sizes, Motor6D names/C0/C1, AnimSaves
Kit.put(name, i, chunk) / Kit.get(name)     -- chunked data transfer (StringValues, not saved)
Kit.importClip("Workspace.MyRig", "Jump360")-- KeyframeSequence into <rig>.AnimSaves (undoable)
Kit.poseAt("Workspace.MyRig", "Jump360", t) -- pose the rig at time t (Edit mode, no Animator)
Kit.reset("Workspace.MyRig")                -- clear poses, stop tracks
Kit.roundTrip("Jump360" [, rigPath, samples]) -- PASS/CHECK: joint table, Animator, solver errors
Kit.frame(rigPath, "front|side|back|top|three_quarter" [, dist]) -- aim the camera; then screen_capture
Kit.restoreCamera()
Kit.filmstripPlan("Jump360", 6)             -- times to capture
Kit.cleanup()                               -- remove ClaudeKitData + the test rig
```
Paths are dot paths from `game` ("Workspace.Rigs.Dummy"). Names containing dots aren't supported.

## Making a new animation (cloud session)
1. Find the move in the CMU index (`cmu-mocap-index-text.txt` in una-dinosauria/cmu-mocap, fetched
   from raw GitHub). The CMU licence allows commercial use.
2. `python3 -I tools/mocap/cmu_to_r6.py X.bvh --analyze` finds the moment (hips height and spin over time).
3. Convert with `--start/--end`. Read the checks: planted-foot slide under about 0.8 studs, feet on the floor.
4. Copy `.view.json` into the viewer's `clips/`, republish, and have Jay judge it on his phone.
5. `make_payloads.py --clip ...clip.json`, then commit. The PC session imports it.

## Status
- Never run in Studio yet (written 2026-11-26 without Studio or a Luau runtime; syntax checked with
  luaparse only).
- Unverified: whether `AnimSaves` should be an ObjectValue or a Model; `Animator:StepAnimations` in
  Edit mode; whether Motor6D.Transform moves parts in Edit mode; the execute_luau payload size limit.
