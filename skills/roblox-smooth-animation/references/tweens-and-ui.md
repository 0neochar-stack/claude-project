# TweenService, UI and object motion

Tweens are right for **one motion from A to B**: a door opening, a panel sliding in, a button press.
They are wrong for multi-point paths and anything that should carry speed through a point.

## Rules

1. **One tween per motion.** For a path through 3+ points, don't chain tweens with
   `Completed:Wait()`. Each tween eases to a stop at its end, which is stop-and-go. Instead, use a
   spline (`clip-format.md` `smooth` mode), or drive an alpha 0→1 with one tween and evaluate the path
   yourself.
2. **Cancel before replacing.** Two tweens on the same property fight, so the object jitters or snaps.
   Keep a reference and `:Cancel()` it before starting the next.
3. **Tween on the client.** A server tween replicates every frame and stutters for players. The server
   sets the final state or an attribute; clients tween to it.
4. **Anchored parts and UI only.** For unanchored or physics parts, use constraints (`AlignPosition`,
   `AlignOrientation`).
5. **Models:** tween a `CFrameValue` and `PivotTo` in its `Changed` handler. Or tween a primary part
   that the rest of the model is welded to.

```luau
--!strict
local TweenService = game:GetService("TweenService")

local active: { [Instance]: Tween } = {}

local function tweenTo(object: Instance, info: TweenInfo, goal: { [string]: any }): Tween
	local previous = active[object]
	if previous then
		previous:Cancel() -- never let two tweens fight over the same object
	end
	local tween = TweenService:Create(object, info, goal)
	active[object] = tween
	tween.Completed:Once(function()
		if active[object] == tween then
			active[object] = nil
		end
	end)
	tween:Play()
	return tween
end

-- Models: tween a CFrameValue, apply with PivotTo
local function tweenModel(model: Model, info: TweenInfo, target: CFrame): Tween
	local value = Instance.new("CFrameValue")
	value.Value = model:GetPivot()
	value.Changed:Connect(function(cf)
		model:PivotTo(cf)
	end)
	local tween = tweenTo(value, info, { Value = target })
	tween.Completed:Once(function()
		value:Destroy()
	end)
	return tween
end

return { tweenTo = tweenTo, tweenModel = tweenModel }
```

## Picking the easing

| Motion | Style and direction |
|---|---|
| UI **entering** (panel, popup, toast) | `Quad`/`Cubic` **Out**: fast start, gentle landing |
| UI **leaving** | `Quad` **In**: gentle start, fast exit. Shorter than the entrance |
| Pop-in (reward, button appear) | `Back` **Out**: small overshoot. Only for playful elements |
| Moving between two resting places | `Sine`/`Quad` **InOut** |
| Mechanical or looping (spinner, conveyor, shimmer) | `Linear` |
| Bouncy collectible landing | `Bounce` **Out**, sparingly |
| Elastic wobble | `Elastic` **Out**: rarely. It reads as cartoonish fast |

## Durations

| Element | Duration |
|---|---|
| Button press (scale 1 → 0.92 → 1) | 0.08–0.12 s down, 0.12–0.18 s up |
| Hover highlight | 0.1–0.15 s |
| Toast / notification in | 0.2–0.25 s |
| Panel / shop window | 0.2–0.3 s in, 0.15–0.2 s out |
| Full page / menu switch | 0.3–0.45 s |
| Door / gate | 0.5–1.2 s |
| Collectible float (looping) | 1.5–2.5 s per cycle, `Sine InOut`, `reverses = true` |

- **Stagger lists:** start each item 0.03–0.05 s after the previous one. Cap the total stagger at
  about 0.3 s, so long lists don't feel slow.
- Fade with `GroupTransparency` on a **CanvasGroup** so a whole panel fades together. Fading every
  child separately causes see-through overlaps.

## Springs for follow and hover motion

Use a spring when the target keeps changing: a UI element that follows the cursor, a camera follow,
a pet trailing the player, hover tilt. A tween restarts from zero velocity every time the target
moves, which causes hitching. A spring keeps its velocity.

```luau
--!strict
-- Critically damped spring: reaches the target as fast as possible without overshoot.
-- omega ~ 10-20 = snappy, 4-8 = floaty. Call every frame with dt.
local function springStep(x: number, v: number, target: number, omega: number, dt: number): (number, number)
	local f = 1 + 2 * dt * omega
	local oo = omega * omega
	local hoo = dt * oo
	local hhoo = dt * hoo
	local detInv = 1 / (f + hhoo)
	local newX = (f * x + dt * v + hhoo * target) * detInv
	local newV = (v + hoo * (target - x)) * detInv
	return newX, newV
end

return springStep
```

This is a stable implicit-Euler form. It won't explode at low frame rates. Run one spring per number
(x, y, rotation), or apply the same maths to `Vector3` and `Vector2` values. Update it in `RenderStepped` for UI and camera, and in
`Heartbeat` for world objects.

## Common UI mistakes

- Tweening `Position` with Offset values: it breaks on other screen sizes. Use Scale.
- Changing `AnchorPoint` mid-tween, which jumps.
- Animating the same element from two scripts.
- Very long UI tweens (over 0.5 s) make the game feel slow. Players notice wait time more than smoothness.
