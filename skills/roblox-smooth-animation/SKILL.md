---
name: roblox-smooth-animation
description: Make Roblox animations smooth and clean, with no stop-and-go, pops, snapping or jitter. Covers character animations (attacks, walks, idles, jumps, emotes), camera cutscenes, NPC cutscene actors, and UI/object tweens. Use when making, fixing or reviewing any animation, cutscene, camera move or tween in Jay's games, or when something "looks robotic", "stops and starts", "snaps" or "stutters". Comes with Smooth Anim Lab (an HTML previewer) and Luau players that share one clip format.
---

# Smooth Roblox animation

The goal is the look of a pro animation editor: motion that keeps flowing through the keys, slows
only where it should (a wind-up, a hit, a landing, the end), and never pops or snaps.

## Hard rules
- **Never put InOut easing on every key of one continuous move.** That is the #1 cause of
  stop-and-go: each key-to-key segment slows to zero and speeds up again. Use one continuous curve
  (`smooth` mode / auto-clamped tangents). Use In→Out pairs only where the motion really changes.
- **One clock drives a cutscene.** Never chain `task.wait()` or `tween.Completed:Wait()` for a
  multi-step camera move. Use `luau/CutscenePlayer.luau`.
- **Camera code runs in `BindToRenderStep` at `Enum.RenderPriority.Camera.Value + 1`**, with
  `CameraType = Scriptable`, and always restores the camera afterwards.
- **Cosmetic motion runs on the client.** Server-side tweens replicate in steps and stutter.
- **Load each animation once, preload it, play with a fade.** `Play(0.1–0.2)` / `Stop(0.1–0.2)`.
  A fade of 0 pops.
- **Loops: last pose = first pose**, and no root drift. Otherwise every loop hitches.
- **Hits and effects fire from animation markers or clip markers**, not from guessed timings.
- **Back up the place before editing in Studio. Never publish without asking Jay. Explain changes in
  plain words. Low-end PC: about one playtest per request.**

## Workflow
1. **Reference.** Get a clip or stills from Jay. Note the timing in frames (60 fps) of the wind-up,
   the hit and the settle.
2. **Block.** Key poses only: start, anticipation, contact, follow-through, settle.
   Timing table: `references/principles.md` §8.
3. **Preview in Smooth Anim Lab** (open https://claude.ai/artifact/95q4KqEYKx476hrD6PtSaU, or the offline copy `assets/smooth-anim-lab.html`). Paste a clip,
   compare **Stop-and-go** with **Smooth**, and read the speed graph:
   - a **red dot** is a stutter: the motion stops and then carries on the same way. That's a bug.
   - a **grey dot** is a turn-around (wind-up into a swing). That's natural.
   - Fix stutters before going to Studio.
4. **Spline and polish.** Switch to smooth interpolation, then add overlap: child joints 1–3 frames
   behind their parents, arcs on wrists and feet, and moving holds instead of dead freezes.
5. **Build in Studio.**
   - **Character animations** that players see in gameplay: author them in the Animation Editor or
     Moon Animator, using the Lab clip as the timing and pose plan. Play them through
     `Animator:LoadAnimation`. See `references/character-animation.md`.
   - **Camera cutscenes:** "Copy as Luau" from the Lab, then play it with `luau/CutscenePlayer.luau`.
     See `references/cutscenes.md`.
   - **Cutscene NPC actors** (client-side clones): `luau/PoseClipPlayer.luau` *(experimental)*.
   - **UI and objects:** TweenService, one tween per motion, springs for follow motion. See
     `references/tweens-and-ui.md`.
6. **Check.** Take stills at anticipation, contact and settle. If anything snaps or stutters, go
   through `references/troubleshooting.md` from top to bottom.

## Files
| File | What's in it |
|---|---|
| `references/clip-format.md` | The shared clip format, the exact `smooth`/`segments` maths, easing names, joint names |
| `references/principles.md` | Spacing, anticipation, hit frames, overlap, arcs, holds, timing table, block → spline → polish |
| `references/character-animation.md` | Editor workflow, loops, root motion, fades, priorities, preloading, markers, where to play |
| `references/cutscenes.md` | Camera rules, shot types, letterbox, skip, actors, markers, shake, low-end tips |
| `references/tweens-and-ui.md` | Tween rules, easing and duration tables, springs |
| `references/troubleshooting.md` | Symptom → cause → fix |
| `assets/smooth-anim-lab.html` | Smooth Anim Lab, offline copy (live: https://claude.ai/artifact/95q4KqEYKx476hrD6PtSaU) |
| `luau/SmoothClip.luau` | Samples a clip (the same maths as the Lab) |
| `luau/CutscenePlayer.luau` | Plays camera clips: one clock, render step, markers, restore |
| `luau/PoseClipPlayer.luau` | Experimental: plays pose clips on R15 Motor6Ds for cutscene actors |

## Status (tell Jay when it matters)
- The Luau modules were written without a Luau runtime, so they're **untested until run in Studio**.
  Test `CutscenePlayer` on a blank baseplate first.
- Smooth Anim Lab is a **2D approximation**: timing and smoothness carry over, looks don't. Its Back,
  Elastic and Bounce curves are close to Roblox's but not exact.
- Items marked "unverified" in the references (such as `PoseEasingDirection` labels and the
  `PoseClipPlayer` sign convention) need checking in Studio before relying on them.
