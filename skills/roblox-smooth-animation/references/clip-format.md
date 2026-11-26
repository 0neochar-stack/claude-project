# Clip format (shared by Smooth Anim Lab and the Luau players)

One format describes both **camera cutscenes** and **pose clips**. The HTML previewer
(`tools/smooth-anim-lab.html`) exports it with "Copy as Luau". The Luau players in `luau/` read it
unchanged. Same data and same interpolation maths on both sides, so what the previewer shows is close
to what Studio plays. It isn't identical: the previewer is 2D, and its Back, Elastic and Bounce curves
are approximations.

## Shape

```luau
local clip = {
	version = 1,
	kind = "camera",          -- "camera" or "pose"
	duration = 4.0,           -- seconds
	mode = "smooth",          -- "smooth" or "segments" (see below)
	loop = false,
	keys = {
		-- camera key
		{ t = 0.0, pos = { 0, 8, 30 }, look = { 0, 4, 0 }, fov = 70,
		  ease = { style = "Sine", direction = "InOut" } },
		-- pose key (kind = "pose"): angles in degrees, swing about the joint's X axis
		-- { t = 0.0, pose = { Waist = 0, Neck = 0, RightShoulder = -20, ... }, ease = { ... } },
	},
	markers = {
		{ t = 1.2, name = "Impact" },  -- fires a callback at that time (sound, VFX, shake)
	},
}
```

- `t` values ascend, start at 0, and the last key's `t` equals `duration`.
- For a looping clip, the last key's values equal the first key's (the previewer enforces this).
- `ease` on a key only matters in `segments` mode. It shapes the segment that *starts* at that key.

## Modes

| Mode | How it moves | Looks like |
|---|---|---|
| `segments` | Each key-to-key segment gets its own easing curve, the same as chaining one tween per segment. | With `InOut` easing it **slows to a stop at every key**: the "stop and go" look. Use it only when you *want* a stop, such as a pose hit or a camera hold. |
| `smooth` | One continuous curve through all keys (cubic Hermite with auto-clamped Catmull-Rom tangents, using the key times). | Speed carries through the middle keys. It only slows at the start, the end, and keys that are a real peak or hold. This is the "made in a proper animation editor" look. |

### Smooth mode maths (exact, so both sides match)

For keys `i` with time `t_i` and value `p_i` (each number is handled separately: x, y, z, FOV,
each joint angle):

```
tangent m_i = (p_{i+1} - p_{i-1}) / (t_{i+1} - t_{i-1})      -- Catmull-Rom with uneven key times
auto-clamp: if p_i >= both neighbours or p_i <= both neighbours, m_i = 0   (peaks and holds don't overshoot)
ends:       m_0 = m_last = 0 when not looping (the clip eases in and out)
loop:       neighbours wrap around (key 0's left neighbour is the second-to-last key, shifted by -duration)

within a segment, s = (t - t_i) / (t_{i+1} - t_i), dt = t_{i+1} - t_i
h00 = 2s³ - 3s² + 1     h10 = s³ - 2s² + s
h01 = -2s³ + 3s²        h11 = s³ - s²
value = h00*p_i + h10*dt*m_i + h01*p_{i+1} + h11*dt*m_{i+1}
```

Auto-clamped tangents are what curve editors call "auto clamped": smooth, but no overshoot past a key.

### Segments mode maths

```
s = (t - t_i) / (t_{i+1} - t_i)
value = lerp(p_i, p_{i+1}, Ease(style, direction, s))
```

In Luau, `Ease` is `TweenService:GetValue(s, Enum.EasingStyle[style], Enum.EasingDirection[direction])`, which is Roblox's own curve.

## Easing names

Styles: `Linear`, `Sine`, `Quad`, `Cubic`, `Quart`, `Quint`, `Exponential`, `Circular`, `Back`,
`Elastic`, `Bounce`. Directions: `In`, `Out`, `InOut`. These match `Enum.EasingStyle` and
`Enum.EasingDirection` (TweenService).

**Unverified warning:** the Animation Editor's *pose* easing (`Enum.PoseEasingDirection`) is reported
to label In and Out the opposite way to TweenService. I couldn't confirm this. If a pose eases the wrong
way in the Animation Editor, flip the direction. This file's directions always mean the TweenService
meaning.

## Pose joints (R15 Motor6D names)

`Root` (whole-body lean, applied to the root joint), `RootY` (not a joint: the body moves up or down by this many studs, applied to the root joint; used for bobbing, crouching and jumps), `Waist`, `Neck`, `RightShoulder`, `RightElbow`,
`LeftShoulder`, `LeftElbow`, `RightHip`, `RightKnee`, `LeftHip`, `LeftKnee`.

The previewer is a **side view**, so every angle is a swing in one plane (about the joint's X axis).
That covers most attacks, walks, jumps and idles. Twists and side raises are authored in Moon Animator
or the Animation Editor instead. Whether a positive angle swings forward or backward on your rig is
**unverified**: if a limb swings the wrong way in Studio, set `flipSign = true` in `PoseClipPlayer`.
