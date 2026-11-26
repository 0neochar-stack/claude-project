--!strict
-- PoseClipPlayer (EXPERIMENTAL): plays a pose clip (references/clip-format.md, kind = "pose")
-- exported from Smooth Anim Lab directly on an R15 rig's Motor6D joints.
--
-- Use it for: cutscene actors and NPC clones on the CLIENT, quick blocking tests.
-- Don't use it for: the player's real gameplay animations. Author those in the Animation Editor or
-- Moon Animator and play them through Animator:LoadAnimation. That replicates, blends and handles
-- priorities properly.
--
--   local handle = PoseClipPlayer.play(actorModel, clip, { onMarker = function(name) end })
--   handle.Completed:Wait()   -- never fires for looping clips; call handle:Stop()
--
-- Limits (all UNVERIFIED in Studio):
--   * Angles are a swing about each joint's X axis (side view). If a limb swings the wrong way,
--     pass flipSign = true.
--   * Motor6D.Transform is also written by the Animator. Disable the actor's Animate script or stop
--     its tracks first, or the two will fight. Writes happen in RunService.PreSimulation.
-- STATUS: written without a Luau runtime available; test in Studio before relying on it.

local RunService = game:GetService("RunService")

local SmoothClip = require(script.Parent.SmoothClip)

local PoseClipPlayer = {}

local JOINTS = {
	"Root",
	"RootY", -- not a joint: vertical body offset in studs, applied to the Root joint
	"Waist",
	"Neck",
	"RightShoulder",
	"RightElbow",
	"LeftShoulder",
	"LeftElbow",
	"RightHip",
	"RightKnee",
	"LeftHip",
	"LeftKnee",
}

local ROOT_INDEX = 1
local ROOT_Y_INDEX = 2

export type Options = {
	onMarker: ((name: string) -> ())?,
	speed: number?,
	flipSign: boolean?,
}

export type Handle = {
	Completed: RBXScriptSignal,
	Stop: (self: Handle) -> (),
	SetSpeed: (self: Handle, speed: number) -> (),
}

local function extractPose(key: any): { number }
	local row: { number } = {}
	for i, joint in JOINTS do
		row[i] = (key.pose and key.pose[joint]) or 0
	end
	return row
end

function PoseClipPlayer.play(model: Model, clip: SmoothClip.Clip, options: Options?): Handle
	local opts: Options = options or {}
	local compiled = SmoothClip.compile(clip, extractPose)
	local sign = if opts.flipSign then -1 else 1

	local motors: { [number]: Motor6D } = {}
	for _, descendant in model:GetDescendants() do
		if descendant:IsA("Motor6D") then
			local index = table.find(JOINTS, descendant.Name)
			if index and index ~= ROOT_Y_INDEX then
				motors[index] = descendant
			end
		end
	end

	local completedEvent = Instance.new("BindableEvent")
	local elapsed = 0
	local speed = opts.speed or 1
	local finished = false
	local sample: { number } = {}

	local function apply(t: number)
		SmoothClip.sample(compiled, t, sample)
		for index, motor in motors do
			local rotation = CFrame.Angles(math.rad(sample[index]) * sign, 0, 0)
			if index == ROOT_INDEX then
				motor.Transform = CFrame.new(0, sample[ROOT_Y_INDEX], 0) * rotation
			else
				motor.Transform = rotation
			end
		end
	end

	local connection: RBXScriptConnection
	local function finish()
		if finished then
			return
		end
		finished = true
		connection:Disconnect()
		for _, motor in motors do
			motor.Transform = CFrame.identity
		end
		completedEvent:Fire()
		task.defer(function()
			completedEvent:Destroy()
		end)
	end

	apply(0)
	connection = RunService.PreSimulation:Connect(function(dt: number)
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
		if opts.onMarker then
			SmoothClip.fireMarkers(clip, prevLocal, SmoothClip.localTime(compiled, elapsed), opts.onMarker)
		end
		apply(elapsed)
	end)

	local handle = {} :: any
	handle.Completed = completedEvent.Event
	function handle:Stop()
		finish()
	end
	function handle:SetSpeed(newSpeed: number)
		speed = newSpeed
	end
	return handle :: Handle
end

return PoseClipPlayer
