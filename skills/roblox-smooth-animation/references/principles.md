# Animation principles for Roblox (with numbers)

Frame counts are given at **60 fps** (Roblox renders up to 60 by default) with the **30 fps** equivalent in
brackets. 1 frame @60 = 0.0167 s. 1 frame @30 = 0.033 s.

## 1. Spacing and easing: where stop-and-go comes from

Spacing is how far a part moves between frames. Close spacing reads as slow, wide spacing as fast.

- **Ease on every key = stop-and-go.** If every key is `InOut` (or each segment is its own tween), the
  speed drops to zero at *every* key. The motion reads as robotic: move, stop, move, stop.
- **Fix:** use **one continuous curve through the middle keys** (`smooth` mode in `clip-format.md`,
  "auto-clamped" or "cubic" tangents in a curve editor). Only ease where the motion should really slow down:
  - the very start (out of rest),
  - the very end (into rest),
  - a real peak (the top of a jump, the end of a wind-up),
  - a deliberate hold.
- **Linear is not smooth either.** It has constant speed, then snaps to a new speed at each key, which
  reads as mechanical. Use Linear only for things that should look mechanical: spinning wheels,
  conveyors, a looping UI shimmer.
- **Rule of thumb:** fast actions are mostly *one big spacing jump* with easing on the landing. Slow
  actions are gentle easing on both ends.

## 2. Anticipation

A small move *opposite* to the main action, so the player reads what's coming.

| Action | Anticipation |
|---|---|
| Light attack / jab | 3–4 frames (2) |
| Heavy attack | 6–12 frames (3–6) |
| Ultimate / special | 15–30 frames (8–15), often with a VFX charge |
| Jump | 3–5 frames (2–3) crouch |
| Dash | 2–4 frames (1–2) lean back |

- Players need responsiveness, so keep the time between the button press and the hit short.
  **Light attacks: total input-to-hit ≤ 6–8 frames (0.1–0.13 s).**
- Put the "drama" in the recovery, not the wind-up.

## 3. The contact (hit) frame

- Hold the strongest pose for **2–4 frames (1–2)**, or use **hit-stop**: freeze the attacker's and victim's
  tracks for **0.05–0.1 s** (`track:AdjustSpeed(0)`, then restore). Hit-stop makes hits feel heavy.
- Fire the VFX, sound and camera shake **on the same frame** via an animation marker (`Impact` / `Hit`).
  Never use a guessed `task.wait`.

## 4. Follow-through and overlapping action

Parts don't all stop at once.

- **Offset child joints 1–3 frames (1–2) behind their parent.** For example:
  - shoulder → elbow lags 1–2 frames → wrist/weapon lags 1–2 more
  - hips → torso → head
- After a swing, the weapon **overshoots 5–15°** past the end pose, then settles over **6–12 frames (3–6)**.
- Loose parts (hair, cape, scarf, tail, weapon trail) lag the most. Use `Trail`/`Beam`, spring-driven
  bones, or simple delayed keys.
- In a curve editor: copy the parent's keys onto the child, then shift them later by 1–3 frames.

## 5. Arcs

Wrists, feet, weapon tips and the head travel on **arcs**, not straight lines.

- Interpolating rotation on joints naturally makes arcs. Check that the tip doesn't cut a straight
  diagonal between keys.
- If it does, add a breakdown key at the middle of the arc.
- Camera paths should be arcs too. A straight dolly is fine. A path with corners is not.

## 6. Moving holds

- A pose that freezes completely looks dead. A "hold" should still drift **2–5%** (a couple of degrees,
  slight breathing).
- Do this with two keys a few degrees apart and smooth interpolation between them, instead of two identical keys.

## 7. Squash and stretch on rigid R15 rigs

R15 parts can't deform. Fake the effect with:

- **pose exaggeration:** deeper crouch before a jump, longer reach on the frame before impact,
- **camera:** a quick FOV punch of **+3–8°** over 0.08 s, back over 0.25 s, and small shake,
- **VFX:** smear frames, speed lines, a trail on the weapon, a stretched flash particle,
- **mesh scale** (only on custom meshes or accessories you control, not the body).

## 8. Timing table (starting points; tune by feel)

| Action | Duration | Notes |
|---|---|---|
| Idle loop | 2–4 s | Breathing: torso ±1–2°, head ±1°. Loops seamlessly. |
| Walk cycle (WalkSpeed 16) | 0.8–1.0 s per full cycle (2 steps) | Match foot travel to speed or the feet slide. |
| Run cycle (WalkSpeed 24–30) | 0.5–0.7 s | More lean (8–15°), bigger arm swing. |
| Light attack | 0.25–0.4 s total | 3–4 frames anticipation, 2 frames contact, rest recovery. |
| Heavy attack | 0.6–1.0 s | 6–12 frames anticipation, hit-stop 0.08–0.1 s. |
| Dash | 0.2–0.35 s | Lean into the move, trail VFX, short ease-out at the end. |
| Jump (take-off) | 0.15–0.25 s | Crouch, then extend. Air pose loops or holds with drift. |
| Landing | 0.15–0.3 s | Absorb: knees bend 20–40° then recover. |
| Hit-react (light) | 0.2–0.35 s | Snap away on contact, ease back. |
| Hit-react (heavy) / knockback | 0.4–0.8 s | Use physics or ragdoll for big knockbacks. |
| Death | 0.8–1.5 s | Or ragdoll (`BreakJointsOnDeath = false` + constraints). |
| Emote / taunt | 1.5–4 s | Readable silhouette; holds with drift. |

## 9. Workflow: block → spline → polish

This is the workflow pro animators and Moon-Animator-style editors use.

1. **Block.** Key only the main poses (contact, extremes, passing). Use stepped or constant
   interpolation so you judge the poses and timing alone. Check the silhouette from the player's camera
   angle.
2. **Spline.** Switch the whole clip to smooth interpolation (`smooth` mode, auto-clamped tangents).
   Now remove stop-and-go: delete easing on middle keys, keep it only at real peaks and holds.
3. **Polish.**
   - offset child joints (overlap)
   - add overshoot and settle
   - turn dead holds into moving holds
   - check arcs on the hands and weapon
   - add markers for VFX and sound
4. **Test in context.** Check it at real game speed, from the real camera, alongside the walk and run
   blend, on a low-end device.

Check the speed graph in Smooth Anim Lab (`assets/smooth-anim-lab.html`, or https://claude.ai/artifact/95q4KqEYKx476hrD6PtSaU). The **speed of a limb tip should only touch
zero where you meant it to stop.**
