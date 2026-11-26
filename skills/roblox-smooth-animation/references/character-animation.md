# Character animation in Roblox

Covers authoring in the Animation Editor or Moon Animator 2, and playing animations cleanly in game.
For the principles and timings, see `principles.md`. For fixes, see `troubleshooting.md`.

## Authoring workflow (Animation Editor or Moon Animator 2)

Both editors use the same ideas: a rig, a timeline, key poses per joint, an easing or interpolation
choice per key, and a curve or tangent view. Use whichever you have. Moon Animator 2 is a third-party
plugin with a faster keying and easing workflow, so check its current licence and price in the Creator
Store. The steps here are generic.

1. **Set the frame rate first:** 60 fps for combat, 30 is fine for idles and emotes. Pick one per project.
2. **Block key poses** (see `principles.md` §9). Use constant or stepped keys while blocking.
3. **Switch to smooth interpolation.**
   - In the **curve editor** (Animation Editor), use cubic keys with auto or clamped tangents. Flat
     tangents at every key cause stop-and-go.
   - With **per-pose easing**, use `Cubic`/`Sine` on the start and end keys only, and `Linear` or curve
     tangents through the middle keys.
4. **Unverified:** the Animation Editor's pose easing direction (`Enum.PoseEasingDirection`) is reported
   to be **reversed** compared with TweenService's `In`/`Out`. If a pose eases the wrong way, flip it.
   The clip format here always uses TweenService's meaning.
5. **Polish:** overlap (child joints 1–3 frames late), overshoot and settle, moving holds, arcs.
6. **Add markers** at gameplay moments, such as `Impact`, `Footstep`, `SpawnVFX` or `CanCancel`.
7. **Publish** the animation to the **same owner as the experience** (user or group). Animations owned
   by someone else silently fail to play in live servers unless asset permissions allow it.

## Seamless loops (idle, walk, run)

- **The first and last pose must be identical, with matching tangents.** Copy key 0 to the end frame.
- The loop length is from the first key to the last key. An extra empty frame after the last key
  causes a hitch.
- In a walk or run, the foot-contact keys should land on even frame numbers so the two halves of the cycle are symmetric.
- **In-place locomotion.** The `HumanoidRootPart` must not drift forward in the clip; the Humanoid
  moves the character. Root drift makes the character snap back at the end of every loop.

## Root motion versus in-place

- Locomotion, idle and most attacks: **in place**.
- Attacks that lunge: keep the animation in place, and move the character separately with physics or a
  CFrame push on the server, timed by a marker.
- Cutscene performances can move the root, as long as the actor is an anchored client-side clone.

## Playback that doesn't pop or fight

```luau
--!strict
local ContentProvider = game:GetService("ContentProvider")

local AnimationLibrary = {}
local cache: { [Animator]: { [string]: AnimationTrack } } = {}

-- Preload once (for example in a loading screen) so the first play doesn't pop or stall.
function AnimationLibrary.preload(animations: { Animation })
	ContentProvider:PreloadAsync(animations)
end

-- Load each animation ONCE per Animator and reuse the track.
function AnimationLibrary.get(animator: Animator, animation: Animation, priority: Enum.AnimationPriority): AnimationTrack
	local byId = cache[animator]
	if not byId then
		byId = {}
		cache[animator] = byId
		animator.AncestryChanged:Connect(function(_, parent)
			if parent == nil then
				cache[animator] = nil -- character died or was removed: drop its tracks
			end
		end)
	end
	local track = byId[animation.AnimationId]
	if not track then
		track = animator:LoadAnimation(animation) -- Humanoid:LoadAnimation is deprecated
		track.Priority = priority
		byId[animation.AnimationId] = track
	end
	return track
end

return AnimationLibrary
```

- **Fade times:** `track:Play(0.1)` and `track:Stop(0.15)`.
  - 0.08–0.12 s for attacks.
  - 0.15–0.25 s for locomotion and idle changes.
  - **`0` pops**: use it only for a deliberate hard cut.
- **Priorities:** `Core < Idle < Movement < Action < Action2 < Action3 < Action4`.
  - The default `Animate` script plays idle, walk and run at Core, Idle or Movement.
  - Attacks and emotes go at **Action** or higher, or the walk animation keeps moving the legs or arms underneath.
  - If an attack should only drive the upper body, leave the leg joints unkeyed in that animation.
    Unkeyed joints fall through to lower priorities.
- **Weight and speed:**
  - `track:Play(fade, weight, speed)` sets them at the start.
  - `track:AdjustWeight(w, fade)` blends two tracks, for example aim versus idle.
  - `track:AdjustSpeed(s)` matches walk speed or creates hit-stop (`AdjustSpeed(0)` for 0.05–0.1 s, then back to 1).
  - Weight and speed are read-only properties. Change them only through these methods.
- **Matching walk speed:** if a walk cycle is authored for WalkSpeed 16, set
  `track:AdjustSpeed(humanoid.WalkSpeed / 16)` on `Running`. Mismatched speed makes the feet slide.

## Markers drive gameplay timing

```luau
--!strict
local function playSlash(track: AnimationTrack, onImpact: () -> ())
	local conn: RBXScriptConnection
	conn = track:GetMarkerReachedSignal("Impact"):Connect(function()
		onImpact() -- VFX, sound, camera shake, hitbox window
	end)
	track.Stopped:Once(function()
		conn:Disconnect()
	end)
	track:Play(0.08)
end
```

Never time effects with `task.wait(0.23)`. When the speed changes, frames drop, or someone re-times the
animation, a hard-coded wait falls out of sync. Markers stay correct.

## Where to play animations

| Who | Play on |
|---|---|
| The local player's own character | **Client**: it replicates through the Animator automatically |
| NPCs that matter to gameplay | **Server** |
| Many cosmetic NPCs, crowds, cutscene actors | **Each client**, locally |
| Hit validation | **Server**, by checking times and state, not by trusting client animation events |

- Always load through the `Animator` (under `Humanoid`, or an `AnimationController` for non-humanoid rigs).
- If you replace the default animations, edit the `Animate` script's values on `CharacterAdded`, or ship
  your own `Animate` in `StarterCharacterScripts`.

## Animation Graphs / State Machines (option)

The Animation Graph Editor can blend tracks from parameters (`track:SetParameter`) and run **State
Machine** nodes for combos and locomotion, without a state-tracking script. The EL4CTEO reference says
it was fully released in Nov 2026; check the current docs. It's worth it for brawler combo chains. For
simple games, a small Luau state machine plus `AnimationLibrary` is easier to debug.

## Cutscene actors with PoseClipPlayer (experimental)

`luau/PoseClipPlayer.luau` plays a pose clip from Smooth Anim Lab by writing `Motor6D.Transform` on an
R15 rig every frame. It is meant for **client-side cutscene actors** (an anchored clone with no other
tracks playing).

- Channels: `Root`, `RootY` (body up/down in studs, applied to the Root joint), `Waist`, `Neck`, both
  shoulders, elbows, hips and knees. See `clip-format.md`.
- It is a **side-view, single-axis** approximation. Twists and side raises still need a real animation.
- The sign convention is **unverified**: if limbs swing the wrong way, pass `flipSign = true`.
- For anything players see in gameplay, export a real Animation from the Animation Editor or Moon Animator.
- Use PoseClipPlayer for quick blocking, previews and simple cutscene gestures.
