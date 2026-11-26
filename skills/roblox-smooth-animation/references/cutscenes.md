# Camera cutscenes

**Goal:** camera moves that glide (no stop-and-go, no jitter, no drift out of sync with the action)
and always give control back cleanly.

## The four rules

1. **The camera is Scriptable during the cutscene, and is always restored.**
   - Save `CameraType`, `CameraSubject` and `FieldOfView` first.
   - Set `CameraType = Scriptable`.
   - Restore all of them on finish, skip, death **or** an error. Use a cleanup function and run it from every exit path.
2. **Update in `RunService:BindToRenderStep` at `Enum.RenderPriority.Camera.Value + 1`.** That runs right
   after the default camera scripts, every rendered frame. `Heartbeat` runs after rendering, so the
   picture lags a frame and jitters. `RenderStepped` without a priority can race the default camera.
   Unbind on finish.
3. **One clock drives everything.** Accumulate `elapsed += dt` (or read `os.clock()`) and *compute* the
   camera, FOV, markers and letterbox from `elapsed`. Never sequence shots with chains of `task.wait`
   or `tween.Completed:Wait()`: each step adds a frame of slack, so audio, VFX and camera drift apart
   and every shot boundary eases to a stop.
4. **The path is one spline, not a tween per point.** Use `smooth` mode from `clip-format.md` (cubic
   Hermite, auto-clamped tangents, played by `luau/CutscenePlayer.luau`). Spline the **look-at target
   separately** from the position. Then `CFrame.lookAt(pos, look)` gives smooth rotation with no
   quaternion flips.

## Using CutscenePlayer

```luau
--!strict
-- LocalScript
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local CutscenePlayer = require(ReplicatedStorage.Shared.CutscenePlayer)
local clips = require(ReplicatedStorage.Shared.CutsceneClips) -- tables pasted from Smooth Anim Lab

local handle = CutscenePlayer.play(clips.BossIntro, {
	origin = workspace.BossArena:GetPivot(), -- clip positions are relative to this
	onMarker = function(name: string)
		if name == "Roar" then
			-- play sound + VFX here, on the same frame as the camera beat
		end
	end,
})
-- handle.stop() for a skip button; handle.finished:Wait() to continue afterwards
```

Author clips **relative to an origin** (the arena pivot) so the same clip works wherever the map is placed.

## Shot types (durations are starting points)

| Shot | Duration | How |
|---|---|---|
| Establishing / wide reveal | 3–5 s | High and far, a slow drift (keys 10–30 studs apart), FOV 60–70 |
| Dolly push-in | 1.5–3 s | 2–3 keys in a near-straight line toward the subject. Optional FOV narrowing of 5–10° |
| Orbit | 3–6 s | 5–8 keys on a circle around the subject, look-at fixed on it. A loop keeps speed constant |
| Fly-by | 1–2 s | Fast and low past the subject. Key spacing ×2–3 in the middle, eased only at the ends |
| Over-the-shoulder | 2–4 s hold | Behind and beside the head, look at the target. A moving hold drifts 0.2–0.5 studs |
| Boss reveal | 4–7 s | Low angle, push up and in, FOV punch on the roar (marker), then a hold |
| Impact punch-in | 0.15–0.3 s | Hard cut close + shake, then back. Pairs with hit-stop |

- **Cuts versus moves.** A hard cut (jump to a new shot) is fine and often better. A *jerky move* is not.
  To cut inside a clip, place two keys 0.001 s apart. In `segments` mode give the cut segment `Linear`.
  A separate clip per shot, switched on the same clock, also works.
- **Speed.** Key times set the speed. If the middle of a path looks slow, it usually means keys are
  bunched: spread them evenly by distance. The Lab's speed graph shows this.
- **FOV.** Keep it between 50 and 80 for most shots. A narrow FOV (30–45) gives a tele look for boss
  close-ups. Change it slowly (over 1+ s) except for punches.

## Letterbox, skip and controls

- **Letterbox:** two black `Frame`s at the top and bottom, `Size` Y 0 → 0.12 scale. Tween in over 0.4 s
  (`Quad Out`) and out over 0.3 s (`Quad In`). This is UI, so a tween is fine.
- **Skip button:** call `handle.stop()`. It must jump straight to restoring the camera and controls, and
  fire any "after" logic exactly once. Make the end logic idempotent.
- **Disabling movement (details unverified):**
  ```luau
  local PlayerModule = require(player:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule"))
  local controls = PlayerModule:GetControls()
  controls:Disable() -- and controls:Enable() in cleanup
  ```
  If that fails, a fallback is to anchor the `HumanoidRootPart` or set WalkSpeed and JumpHeight to 0 on
  the client, and restore them in cleanup.
- Hide the HUD (`ScreenGui.Enabled = false` for your HUD) and restore it in cleanup.

## Cutscene actors

- Clone the actors on the **client** (`Clone()` from ReplicatedStorage). Anchor their
  `HumanoidRootPart`, parent them to the workspace, and destroy them in cleanup.
- Play their animations **locally** with `Animator:LoadAnimation`, timed from the cutscene clock or
  markers.
- Server-side actors replicate their movement and stutter. They also show up for players who aren't
  watching.
- `luau/PoseClipPlayer.luau` can pose an actor from a Lab pose clip (experimental, see
  `character-animation.md`).

## Sync VFX and sound with markers

Put markers in the clip (`{ t = 2.4, name = "Roar" }`). CutscenePlayer fires `onMarker` on the frame
the clock passes that time. If a frame skips past several markers, all of them fire, in order. Sound
should start on the marker, not a pre-calculated `task.wait`.

## Camera shake on top of the path

Compute the path CFrame first, then multiply a shake offset onto it:
`camera.CFrame = pathCFrame * CFrame.Angles(rx, ry, 0)` with angles of 0.2–1.5° that decay over
0.2–0.5 s. Never shake by moving keys. Shake is an extra layer added on top of the camera path, not part of it.

## Low-end PCs and phones

- Do only maths in the render-step function: no `FindFirstChild`, no instance creation, no
  `table.insert` per frame. Precompute everything when the cutscene starts.
- Preload the cutscene's animations, sounds and textures (`ContentProvider:PreloadAsync`) behind the
  letterbox fade-in.
- Cap VFX during cutscenes (see the VFX skill: `Emit(n)` bursts, not high `Rate`).
- Test on the weakest device. If the frame rate dips, the one-clock design keeps the timing correct;
  only smoothness suffers.
