--!strict
-- SmoothClip: samples a clip (see references/clip-format.md) at any time.
-- Same maths as Smooth Anim Lab (tools/smooth-anim-lab.html), so previews and Studio agree.
-- Used by CutscenePlayer and PoseClipPlayer. Client-side only (pure maths, no replication).
-- STATUS: written without a Luau runtime available; test in Studio before relying on it.

local TweenService = game:GetService("TweenService")

local SmoothClip = {}

export type Ease = { style: string, direction: string }
export type Marker = { t: number, name: string }
export type Clip = {
	version: number,
	kind: string, -- "camera" | "pose"
	duration: number,
	mode: string, -- "smooth" | "segments"
	loop: boolean?,
	keys: { any },
	markers: { Marker }?,
}

-- A compiled clip: one row of numbers per key, plus tangents for smooth mode.
export type Compiled = {
	duration: number,
	mode: string,
	loop: boolean,
	times: { number },
	values: { { number } }, -- values[keyIndex][channelIndex]
	tangents: { { number } }, -- same shape as values
	eases: { Ease },
	channelCount: number,
}

local styleCache: { [string]: Enum.EasingStyle } = {}
local directionCache: { [string]: Enum.EasingDirection } = {}

local function toStyle(name: string): Enum.EasingStyle
	local cached = styleCache[name]
	if cached then
		return cached
	end
	local ok, value = pcall(function()
		return (Enum.EasingStyle :: any)[name]
	end)
	local style = if ok and value then value :: Enum.EasingStyle else Enum.EasingStyle.Linear
	styleCache[name] = style
	return style
end

local function toDirection(name: string): Enum.EasingDirection
	local cached = directionCache[name]
	if cached then
		return cached
	end
	local ok, value = pcall(function()
		return (Enum.EasingDirection :: any)[name]
	end)
	local direction = if ok and value then value :: Enum.EasingDirection else Enum.EasingDirection.InOut
	directionCache[name] = direction
	return direction
end

-- Roblox's own easing curve (TweenService), so "segments" mode matches tweens exactly.
function SmoothClip.ease(ease: Ease?, s: number): number
	if not ease then
		return s
	end
	return TweenService:GetValue(s, toStyle(ease.style), toDirection(ease.direction))
end

-- extract(key) must return the key's numbers in a fixed channel order.
function SmoothClip.compile(clip: Clip, extract: (key: any) -> { number }): Compiled
	assert(#clip.keys >= 2, "SmoothClip: a clip needs at least 2 keys")
	local loop = clip.loop == true
	local times: { number } = {}
	local values: { { number } } = {}
	local eases: { Ease } = {}
	for i, key in clip.keys do
		times[i] = key.t
		values[i] = extract(key)
		eases[i] = key.ease or { style = "Sine", direction = "InOut" }
		if i > 1 then
			assert(times[i] > times[i - 1], "SmoothClip: key times must increase")
		end
	end
	local n = #times
	local channelCount = #values[1]
	local tangents: { { number } } = {}

	for i = 1, n do
		local row: { number } = {}
		for c = 1, channelCount do
			local m = 0
			local hasNeighbours = true
			local tPrev, pPrev, tNext, pNext = 0, 0, 0, 0
			if i > 1 and i < n then
				tPrev, pPrev = times[i - 1], values[i - 1][c]
				tNext, pNext = times[i + 1], values[i + 1][c]
			elseif loop and n >= 3 then
				-- Wrap around. Keys 1 and n hold the same pose at t = 0 and t = duration.
				if i == 1 then
					tPrev, pPrev = times[n - 1] - clip.duration, values[n - 1][c]
					tNext, pNext = times[2], values[2][c]
				else
					tPrev, pPrev = times[n - 1], values[n - 1][c]
					tNext, pNext = times[2] + clip.duration, values[2][c]
				end
			else
				hasNeighbours = false -- non-looping ends ease in/out (tangent 0)
			end
			if hasNeighbours then
				local p = values[i][c]
				if (p - pPrev) * (pNext - p) > 0 then
					m = (pNext - pPrev) / (tNext - tPrev)
				end -- else: a peak, a dip or a hold -> clamp to 0 (no overshoot)
			end
			row[c] = m
		end
		tangents[i] = row
	end

	return {
		duration = clip.duration,
		mode = clip.mode,
		loop = loop,
		times = times,
		values = values,
		tangents = tangents,
		eases = eases,
		channelCount = channelCount,
	}
end

-- Wraps (loop) or clamps time into [0, duration].
function SmoothClip.localTime(compiled: Compiled, t: number): number
	if compiled.loop then
		return t % compiled.duration
	end
	return math.clamp(t, 0, compiled.duration)
end

-- Returns one number per channel at time t (seconds).
function SmoothClip.sample(compiled: Compiled, t: number, out: { number }?): { number }
	local result = out or {}
	local times = compiled.times
	local n = #times
	t = SmoothClip.localTime(compiled, t)

	local i = 1
	while i < n - 1 and t >= times[i + 1] do
		i += 1
	end
	local t0, t1 = times[i], times[i + 1]
	local dt = t1 - t0
	local s = math.clamp((t - t0) / dt, 0, 1)
	local v0, v1 = compiled.values[i], compiled.values[i + 1]

	if compiled.mode == "segments" then
		local e = SmoothClip.ease(compiled.eases[i], s)
		for c = 1, compiled.channelCount do
			result[c] = v0[c] + (v1[c] - v0[c]) * e
		end
	else
		local s2, s3 = s * s, s * s * s
		local h00 = 2 * s3 - 3 * s2 + 1
		local h10 = s3 - 2 * s2 + s
		local h01 = -2 * s3 + 3 * s2
		local h11 = s3 - s2
		local m0, m1 = compiled.tangents[i], compiled.tangents[i + 1]
		for c = 1, compiled.channelCount do
			result[c] = h00 * v0[c] + h10 * dt * m0[c] + h01 * v1[c] + h11 * dt * m1[c]
		end
	end
	return result
end

-- Calls onMarker for every marker crossed between prevT and t (handles loop wrap).
function SmoothClip.fireMarkers(clip: Clip, prevT: number, t: number, onMarker: (name: string) -> ())
	local markers = clip.markers
	if not markers then
		return
	end
	for _, marker in markers do
		local crossed
		if t >= prevT then
			crossed = marker.t > prevT and marker.t <= t
		else -- wrapped around the end of a loop
			crossed = marker.t > prevT or marker.t <= t
		end
		if crossed then
			task.spawn(onMarker, marker.name)
		end
	end
end

return SmoothClip
