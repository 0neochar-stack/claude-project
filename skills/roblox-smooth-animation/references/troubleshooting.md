# Troubleshooting: symptom → cause → fix

Find the symptom, check the cause, apply the fix. Details live in the file named in the last column.

| # | Symptom | Likely cause | Fix | See |
|---|---|---|---|---|
| 1 | **Stop-and-go / robotic**: motion slows to a stop at every key | `InOut` easing on every key, or one tween per path segment chained with `Completed:Wait()` | Use one continuous curve (`smooth` mode / auto-clamped tangents). Keep easing only at the start, end, real peaks and holds | principles §1, clip-format |
| 2 | **Pop or stall the first time** an animation plays | Asset not loaded yet | `ContentProvider:PreloadAsync` the Animations during loading. Load tracks once and cache them | character-animation |
| 3 | **Snap** when an animation starts or stops | Fade time 0 (`Play()` defaults may be too short for the move) | `Play(0.1)`, `Stop(0.15)`. 0.15–0.25 for locomotion | character-animation |
| 4 | **Limbs fighting / half-blended pose**: legs still walking during an attack | Priority too low, so the `Animate` script's tracks blend in. Or two tracks at the same priority and weight | Attacks at `Action`+. Leave unwanted joints unkeyed or key them deliberately. Stop tracks you don't need | character-animation |
| 5 | **Animation plays for me but not for others** | Played on the server for your own character, or via something other than the Animator, or a non-replicating clone | Own character: play on the client through `Humanoid.Animator`. NPCs: server | character-animation |
| 6 | **Animation doesn't play in the live game** (works in Studio) | Animation asset owned by a different user or group than the experience, and not shared | Publish or re-upload under the experience owner, or grant asset permissions | character-animation |
| 7 | **Hitch at the loop point** | Last pose ≠ first pose, mismatched tangents, or an extra frame after the last key | Copy key 0 to the end, smooth tangents on both, no trailing frame | character-animation |
| 8 | **Character snaps back each loop** | Root part moves forward in an in-place locomotion clip | Remove root translation; let the Humanoid move the character | character-animation |
| 9 | **Feet slide** | Cycle authored for one WalkSpeed, played at another | `track:AdjustSpeed(humanoid.WalkSpeed / authoredSpeed)` on `Running` | principles §8 |
| 10 | **Camera jitters during a cutscene** | Updating in `Heartbeat` or a `while` loop, or the default camera still running, or following a physics part | `CameraType = Scriptable`; `BindToRenderStep` at `Camera.Value + 1`. Follow a smoothed value (spring), not the raw physics part | cutscenes |
| 11 | **Cutscene drifts out of sync** with sound and VFX | Shots sequenced with `task.wait` / `Completed:Wait()` chains | One clock (`elapsed += dt`) drives the camera, markers and UI | cutscenes |
| 12 | **Camera stops at every shot point** | A tween per camera point | One spline through all points (`CutscenePlayer`, `smooth` mode) | cutscenes |
| 13 | **Camera doesn't come back** after a cutscene (stuck, or no controls) | Restore only on the "happy path"; skip, death or an error skipped it | One cleanup function called from finish, skip, death and `pcall` failure; save and restore the type, subject, FOV and controls | cutscenes |
| 14 | **Tween stutters for players** | Tween running on the server | Tween on clients; the server sets the final state or an attribute | tweens-and-ui |
| 15 | **Object jitters / snaps between two targets** | Two tweens on the same property | `:Cancel()` the previous tween before creating the next (`tweenTo` helper) | tweens-and-ui |
| 16 | **Overshoot or wobble at a hold** | Non-clamped spline tangents (plain Catmull-Rom) past equal keys | Auto-clamped tangents (the Lab's and the players' default) or flat tangents on the hold keys | clip-format |
| 17 | **Jerky or doubled animation after respawn** | Old tracks or connections from the dead character still referenced or connected | Rebind on `CharacterAdded`; clear the track cache when the Animator is removed; disconnect marker connections on `Stopped` | character-animation |
| 18 | **VFX or sound fires at the wrong time** | Timed with `task.wait(x)` instead of the animation | Animation markers (`GetMarkerReachedSignal`) or clip markers | character-animation, cutscenes |
| 19 | **Low FPS on a weak PC** during animations or cutscenes | Too many tracks, too many particle emitters on `Rate`, heavy work in `RenderStepped` | Cache tracks; `Emit(n)` bursts; only maths per frame; precompute at start | cutscenes |
| 20 | **Pose eases the wrong way** in the Animation Editor | Pose easing direction possibly reversed vs TweenService (**unverified**) | Flip the In and Out on that pose | clip-format |
| 21 | **Lab looks smooth, Studio doesn't** | Back, Elastic and Bounce are approximations in the Lab; the 2D rig is a side view; Studio is playing at a low frame rate | Use Sine/Quad/Cubic for anything that must match; check the frame rate in Studio (Shift+F5) | clip-format |
| 22 | **Limb swings the wrong way** with PoseClipPlayer | Sign convention differs on the rig (**unverified**) | `flipSign = true`; for gameplay, use a real exported Animation | character-animation |

## Quick diagnostic routine

1. **Is it timing or easing?** Open the clip in Smooth Anim Lab. The speed graph shows red dips where the
   motion stops. Unintended dips mean easing problems.
2. **Is it playback?** Check the priority, fade times, preload, and which side (client or server) is playing it.
3. **Is it the frame rate?** Check the FPS in Studio (Shift+F5). A smooth clip at 15 FPS still looks
   choppy, so fix performance first.
4. **Is it sync?** If the effects are late or early, look for any `task.wait` used for timing and replace
   it with markers or the single clock.
