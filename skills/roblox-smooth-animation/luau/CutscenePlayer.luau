--!strict
-- CutscenePlayer: plays a camera clip (references/clip-format.md, kind = "camera") smoothly.
-- LocalScript use only (the camera is per player).
--
--   local CutscenePlayer = require(path.to.CutscenePlayer)
--   local handle = CutscenePlayer.play(clip, {
--       origin = workspace.BossArena.CutsceneOrigin.CFrame, -- optional: clip coords are relative to this
--       onMarker = function(name) if name == "Impact" then playBoom() end end,
--   })
--   handle.Completed:Wait()
--
-- Why it's smooth:
--   * One clock: elapsed time from the render step drives position, look target, FOV and markers.
--     No task.wait chains that drift.
--   * Runs in BindToRenderStep just after Roblox's camera (RenderPriority.Camera + 1), once per frame.
--   * "smooth" clips are one continuous curve, so the camera never stops at middle keys.
-- STATUS: written without a Luau runtime available; test in Studio before relying on it.

local RunService = game:GetService("RunService")

local SmoothClip = require(script.Parent.SmoothClip)

local CutscenePlayer = {}

export type Options = {
	camera: Camera?,
	origin: CFrame?, -- clip positions are local to this CFrame (default: world origin)
	onMarker: ((name: string) -> ())?,
	-- Optional extra offset applied after the path each frame, e.g. camera shake.
	offset: ((elapsed: number) -> CFrame)?,
	speed: number?, -- 1 = normal
	restoreCamera: boolean?, -- default true: put the camera back to how it was when done
}

export type Handle = {
	Completed: RBXScriptSignal,
	Stop: (self: Handle) -> (),
	Pause: (self: Handle) -> (),
	Resume: (self: Handle) -> (),
	SetSpeed: (self: Handle, speed: number) -> (),
}

local bindCounter = 0

local function extractCamera(key: any): { number }
	local pos, look = key.pos, key.look
	return { pos[1], pos[2], pos[3], look[1], look[2], look[3], key.fov or 70 }
end

function CutscenePlayer.play(clip: SmoothClip.Clip, options: Options?): Handle
	assert(RunService:IsClient(), "CutscenePlayer must run in a LocalScript")
	local opts: Options = options or {}
	local camera = opts.camera or workspace.CurrentCamera
	local origin = opts.origin or CFrame.identity
	local compiled = SmoothClip.compile(clip, extractCamera)

	local completedEvent = Instance.new("BindableEvent")
	local savedType = camera.CameraType
	local savedFov = camera.FieldOfView

	bindCounter += 1
	local bindName = `SmoothCutscene{bindCounter}`
	local elapsed = 0
	local speed = opts.speed or 1
	local paused = false
	local finished = false
	local sample: { number } = {}

	local function apply(t: number)
		SmoothClip.sample(compiled, t, sample)
		local pos = origin:PointToWorldSpace(Vector3.new(sample[1], sample[2], sample[3]))
		local look = origin:PointToWorldSpace(Vector3.new(sample[4], sample[5], sample[6]))
		local frame = if (look - pos).Magnitude > 1e-3 then CFrame.lookAt(pos, look) else CFrame.new(pos)
		if opts.offset then
			frame *= opts.offset(t)
		end
		camera.CFrame = frame
		camera.FieldOfView = math.clamp(sample[7], 1, 120)
	end

	local function finish()
		if finished then
			return
		end
		finished = true
		RunService:UnbindFromRenderStep(bindName)
		if opts.restoreCamera ~= false then
			camera.FieldOfView = savedFov
			camera.CameraType = savedType
		end
		completedEvent:Fire()
		task.defer(function()
			completedEvent:Destroy()
		end)
	end

	camera.CameraType = Enum.CameraType.Scriptable
	apply(0)

	RunService:BindToRenderStep(bindName, Enum.RenderPriority.Camera.Value + 1, function(dt: number)
		if paused or finished then
			return
		end
		local prevLocal = SmoothClip.localTime(compiled, elapsed)
		elapsed += dt * speed
		if not compiled.loop and elapsed >= compiled.duration then
			if opts.onMarker then
				SmoothClip.fireMarkers(clip, prevLocal, compiled.duration, opts.onMarker)
			end
			apply(compiled.duration)
			finish()
			return
		end
		local nowLocal = SmoothClip.localTime(compiled, elapsed)
		if opts.onMarker then
			SmoothClip.fireMarkers(clip, prevLocal, nowLocal, opts.onMarker)
		end
		apply(elapsed)
	end)

	local handle = {} :: any
	handle.Completed = completedEvent.Event
	function handle:Stop()
		finish()
	end
	function handle:Pause()
		paused = true
	end
	function handle:Resume()
		paused = false
	end
	function handle:SetSpeed(newSpeed: number)
		speed = newSpeed
	end
	return handle :: Handle
end

return CutscenePlayer
