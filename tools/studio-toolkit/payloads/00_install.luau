-- ClaudeKit install: Archivable=false, so it is never saved or published with the place
local SS = game:GetService("ServerStorage")
local old = SS:FindFirstChild("ClaudeKit")
if old then old:Destroy() end
local m = Instance.new("ModuleScript")
m.Name = "ClaudeKit"
m.Archivable = false
m.Source = [=[
--[[
ClaudeKit: Studio-side helper functions for Claude, called through Roblox's built-in Studio MCP
(execute_luau). Not a UI plugin: every function returns a compact JSON string for Claude to read.

Install (Claude does this via execute_luau; see install.luau): a ModuleScript named "ClaudeKit" in
ServerStorage with Archivable = false, so it is never saved into the place or published.
Use:   local Kit = require(game:GetService("ServerStorage").ClaudeKit)   print(Kit.selftest())

Design rules
  * State lives in Instances (ServerStorage.ClaudeKitData, Archivable = false), not Lua tables,
    because each execute_luau call may run in a fresh VM.
  * Every change to the place is wrapped in a ChangeHistoryService recording (undoable with Ctrl+Z).
  * Nothing here publishes, saves, or spends anything.
  * Written in a Lua-compatible subset of Luau (no type annotations or compound operators) so the
    syntax can be checked outside Studio. STATUS: never run in Studio yet; run selftest() first.
]]

local HttpService = game:GetService("HttpService")
local ServerStorage = game:GetService("ServerStorage")
local RunService = game:GetService("RunService")

local Kit = {}
Kit.VERSION = "0.1.0"

---------------------------------------------------------------- helpers
local function json(t)
	return HttpService:JSONEncode(t)
end

local function round(x, n)
	local m = 10 ^ (n or 4)
	return math.floor(x * m + 0.5) / m
end

local function cfToArray(cf)
	-- [x, y, z, qw, qx, qy, qz]
	local axis, angle = cf:ToAxisAngle()
	local s = math.sin(angle / 2)
	local p = cf.Position
	return { round(p.X), round(p.Y), round(p.Z), round(math.cos(angle / 2), 5),
		round(axis.X * s, 5), round(axis.Y * s, 5), round(axis.Z * s, 5) }
end

local function arrayToCF(a)
	-- quaternion w-first -> CFrame.new(x, y, z, qx, qy, qz, qw)
	return CFrame.new(a[1], a[2], a[3], a[5], a[6], a[7], a[4])
end

local function angleBetween(a, b)
	local _, ang = (a:Inverse() * b):ToAxisAngle()
	ang = math.abs(ang)
	if ang > math.pi then
		ang = 2 * math.pi - ang
	end
	return math.deg(ang)
end

local function dataFolder()
	local f = ServerStorage:FindFirstChild("ClaudeKitData")
	if not f then
		f = Instance.new("Folder")
		f.Name = "ClaudeKitData"
		f.Archivable = false
		f.Parent = ServerStorage
	end
	return f
end

local function resolve(path)
	-- "Workspace.Rigs.Dummy" -> Instance (dots only; names with dots are not supported)
	if typeof(path) == "Instance" then
		return path
	end
	local node = game
	for name in string.gmatch(path, "[^%.]+") do
		local child = node:FindFirstChild(name)
		if not child and node == game then
			local ok, svc = pcall(function()
				return game:GetService(name)
			end)
			child = ok and svc or nil
		end
		if not child then
			return nil
		end
		node = child
	end
	return node
end

local function record(name, fn)
	-- Undoable change: ChangeHistoryService recording, falling back to waypoints.
	local CHS = game:GetService("ChangeHistoryService")
	local okBegin, rec = pcall(function()
		return CHS:TryBeginRecording("ClaudeKit: " .. name)
	end)
	local ok, result = pcall(fn)
	if okBegin and rec then
		pcall(function()
			CHS:FinishRecording(rec, ok and Enum.FinishRecordingOperation.Commit or Enum.FinishRecordingOperation.Cancel)
		end)
	else
		pcall(function()
			CHS:SetWaypoint("ClaudeKit: " .. name)
		end)
	end
	if not ok then
		error(result, 0)
	end
	return result
end

local function motorsOf(rig)
	-- part name -> Motor6D whose Part1 is that part
	local motors = {}
	for _, d in ipairs(rig:GetDescendants()) do
		if d:IsA("Motor6D") and d.Part1 then
			motors[d.Part1.Name] = d
		end
	end
	return motors
end

local function rootOf(rig)
	return rig:FindFirstChild("HumanoidRootPart") or rig.PrimaryPart
end

local function animatorOf(rig)
	local hum = rig:FindFirstChildOfClass("Humanoid")
	local holder = hum or rig:FindFirstChildOfClass("AnimationController")
	if not holder then
		return nil
	end
	local animator = holder:FindFirstChildOfClass("Animator")
	if not animator then
		animator = Instance.new("Animator")
		animator.Parent = holder
	end
	return animator
end

-- Forward kinematics from the rig's own joints: Part1 = Part0 * C0 * Transform * C1^-1 (relative to root)
local function fk(rig, transforms)
	local root = rootOf(rig)
	local motors = motorsOf(rig)
	local out = { [root.Name] = CFrame.new() }
	for _ = 1, 8 do
		for partName, m in pairs(motors) do
			if not out[partName] and m.Part0 and out[m.Part0.Name] then
				local t = (transforms and transforms[partName]) or m.Transform
				out[partName] = out[m.Part0.Name] * m.C0 * t * m.C1:Inverse()
			end
		end
	end
	return out
end

---------------------------------------------------------------- chunked data transfer
-- Claude sends big JSON (clips) in pieces:  Kit.put(name, i, chunk) ... then Kit.get(name)
function Kit.put(name, index, chunk)
	local folder = dataFolder():FindFirstChild(name)
	if index == 1 or not folder then
		if folder then
			folder:Destroy()
		end
		folder = Instance.new("Folder")
		folder.Name = name
		folder.Archivable = false
		folder.Parent = dataFolder()
	end
	local v = Instance.new("StringValue")
	v.Name = string.format("%05d", index)
	v.Value = chunk
	v.Archivable = false
	v.Parent = folder
	return json({ ok = true, name = name, chunks = #folder:GetChildren(), bytes = #chunk })
end

function Kit.get(name)
	local folder = dataFolder():FindFirstChild(name)
	if not folder then
		error("ClaudeKit: no data named " .. tostring(name), 0)
	end
	local parts = folder:GetChildren()
	table.sort(parts, function(a, b)
		return a.Name < b.Name
	end)
	local buf = {}
	for i, v in ipairs(parts) do
		buf[i] = v.Value
	end
	return table.concat(buf)
end

local function loadClip(name)
	local clip = HttpService:JSONDecode(Kit.get(name))
	if clip.format ~= "claudekit-clip-1" then
		error("ClaudeKit: unknown clip format " .. tostring(clip.format), 0)
	end
	return clip
end

---------------------------------------------------------------- selftest
function Kit.selftest()
	local report = { kit = Kit.VERSION, checks = {} }
	local function check(name, fn)
		local ok, res = pcall(fn)
		report.checks[name] = { ok = ok, info = ok and res or tostring(res) }
	end
	check("environment", function()
		return { studio = version(), edit = RunService:IsEdit(), running = RunService:IsRunning() }
	end)
	check("change_history", function()
		local CHS = game:GetService("ChangeHistoryService")
		local rec = CHS:TryBeginRecording("ClaudeKit selftest")
		if rec then
			CHS:FinishRecording(rec, Enum.FinishRecordingOperation.Cancel)
		end
		return rec ~= nil
	end)
	-- A disposable standard R6 rig, so the test never touches Jay's own models.
	local rig
	check("make_test_rig_r6", function()
		local old = workspace:FindFirstChild("ClaudeKit_TestRig")
		if old then
			old:Destroy()
		end
		rig = game:GetService("Players"):CreateHumanoidModelFromDescription(Instance.new("HumanoidDescription"), Enum.HumanoidRigType.R6)
		rig.Name = "ClaudeKit_TestRig"
		rig.Archivable = false
		rig:PivotTo(CFrame.new(0, 200, 0))
		rig.Parent = workspace
		local root = rootOf(rig)
		root.Anchored = true
		return rig:GetFullName()
	end)
	if rig then
		check("rig_joints_match_classic_r6", function()
			local info = HttpService:JSONDecode(Kit.inspectRig(rig))
			return info.joints
		end)
		check("transform_moves_parts_in_edit_mode", function()
			local m = motorsOf(rig)["Right Arm"]
			local arm = rig["Right Arm"]
			local before = arm.CFrame
			m.Transform = CFrame.Angles(0, 0, math.rad(90))
			task.wait()
			local moved = (arm.CFrame.Position - before.Position).Magnitude
			m.Transform = CFrame.new()
			return { moved_studs = round(moved, 3), works = moved > 0.1 }
		end)
		check("register_keyframe_sequence", function()
			local kfs = Instance.new("KeyframeSequence")
			local kf = Instance.new("Keyframe")
			kf.Time = 0
			kf.Parent = kfs
			local id = game:GetService("KeyframeSequenceProvider"):RegisterKeyframeSequence(kfs)
			return id
		end)
		check("animator_step_in_edit_mode", function()
			local animator = animatorOf(rig)
			return { has_step = pcall(function()
				animator:StepAnimations(0)
			end) }
		end)
		check("scriptable_camera", function()
			local cam = workspace.CurrentCamera
			local oldType, oldCF = cam.CameraType, cam.CFrame
			cam.CameraType = Enum.CameraType.Scriptable
			cam.CFrame = CFrame.lookAt(Vector3.new(0, 203, -10), Vector3.new(0, 203, 0))
			local ok = (cam.CFrame.Position - Vector3.new(0, 203, -10)).Magnitude < 0.01
			cam.CameraType, cam.CFrame = oldType, oldCF
			return ok
		end)
		rig:Destroy()
	end
	report.next = "Also probe execute_luau payload size: send Kit.put('probe',1,string.rep('x',N)) for N = 10k, 50k, 200k."
	return json(report)
end

---------------------------------------------------------------- rig inspection
function Kit.inspectRig(path)
	local rig = resolve(path)
	if not rig then
		error("ClaudeKit: rig not found: " .. tostring(path), 0)
	end
	local hum = rig:FindFirstChildOfClass("Humanoid")
	local out = {
		name = rig:GetFullName(),
		rigType = hum and hum.RigType.Name or "none",
		hasAnimator = animatorOf(rig) ~= nil,
		parts = {},
		joints = {},
		animSaves = {},
	}
	for _, d in ipairs(rig:GetDescendants()) do
		if d:IsA("BasePart") then
			out.parts[d.Name] = { size = { round(d.Size.X), round(d.Size.Y), round(d.Size.Z) }, anchored = d.Anchored }
		elseif d:IsA("Motor6D") then
			table.insert(out.joints, {
				name = d.Name,
				part0 = d.Part0 and d.Part0.Name or nil,
				part1 = d.Part1 and d.Part1.Name or nil,
				C0 = { d.C0:GetComponents() },
				C1 = { d.C1:GetComponents() },
			})
		end
	end
	local saves = rig:FindFirstChild("AnimSaves")
	if saves then
		for _, k in ipairs(saves:GetChildren()) do
			table.insert(out.animSaves, k.Name)
		end
	end
	return json(out)
end

---------------------------------------------------------------- import
local function buildKfs(clip)
	local kfs = Instance.new("KeyframeSequence")
	kfs.Name = clip.name
	kfs.Loop = clip.loop == true
	pcall(function()
		kfs.Priority = Enum.AnimationPriority[clip.priority or "Action"]
	end)
	for _, key in ipairs(clip.keys) do
		local kf = Instance.new("Keyframe")
		kf.Time = key[1]
		local function addPose(parentPose, partName)
			local pose = Instance.new("Pose")
			pose.Name = partName
			local a = key[2][partName]
			pose.CFrame = a and arrayToCF(a) or CFrame.new()
			pose.Weight = 1
			pose.EasingStyle = Enum.PoseEasingStyle.Linear
			if parentPose then
				parentPose:AddSubPose(pose)
			else
				kf:AddPose(pose)
			end
			for _, child in ipairs(clip.tree[partName] or {}) do
				addPose(pose, child)
			end
		end
		addPose(nil, "HumanoidRootPart")
		kf.Parent = kfs
	end
	return kfs
end

-- Creates <rig>.AnimSaves.<clip name> (KeyframeSequence) so the Animation Editor / Moon can open it.
function Kit.importClip(rigPath, dataName)
	local rig = resolve(rigPath)
	if not rig then
		error("ClaudeKit: rig not found: " .. tostring(rigPath), 0)
	end
	local clip = loadClip(dataName)
	return record("import " .. clip.name, function()
		local saves = rig:FindFirstChild("AnimSaves")
		if not saves then
			saves = Instance.new("ObjectValue") -- the Animation Editor's AnimSaves container is an ObjectValue
			saves.Name = "AnimSaves"
			saves.Parent = rig
		end
		local old = saves:FindFirstChild(clip.name)
		if old then
			old:Destroy()
		end
		local kfs = buildKfs(clip)
		kfs.Parent = saves
		return json({ ok = true, saved = kfs:GetFullName(), keyframes = #clip.keys })
	end)
end

---------------------------------------------------------------- posing + round trip
local function clipTransformsAt(clip, t)
	local keys = clip.keys
	local i = 1
	while i < #keys - 1 and t >= keys[i + 1][1] do
		i = i + 1
	end
	local a, b = keys[i], keys[math.min(i + 1, #keys)]
	local span = b[1] - a[1]
	local u = span > 0 and math.clamp((t - a[1]) / span, 0, 1) or 0
	local out = {}
	for part, arr in pairs(a[2]) do
		local nb = b[2][part] or arr
		out[part] = arrayToCF(arr):Lerp(arrayToCF(nb), u)
	end
	return out, i, u
end

-- Poses a rig at time t straight from the clip data (no Animator). Undo with Kit.reset(rig).
function Kit.poseAt(rigPath, dataName, t)
	local rig = resolve(rigPath)
	local clip = loadClip(dataName)
	local tr = clipTransformsAt(clip, t)
	local motors = motorsOf(rig)
	for part, cf in pairs(tr) do
		if motors[part] then
			motors[part].Transform = cf
		end
	end
	return json({ ok = true, t = t })
end

function Kit.reset(rigPath)
	local rig = resolve(rigPath)
	for _, m in pairs(motorsOf(rig)) do
		m.Transform = CFrame.new()
	end
	local animator = animatorOf(rig)
	if animator then
		for _, track in ipairs(animator:GetPlayingAnimationTracks()) do
			track:Stop(0)
		end
	end
	return json({ ok = true })
end

--[[ Round trip: proves an imported clip plays the way the converter intended, on THIS rig.
  joint_table_err : rig's own C0/C1 vs the converter's classic R6 table (non-zero = custom rig; re-convert)
  animator_err    : Transform the Animator produced from the KeyframeSequence vs the clip data
                    (non-zero = import/sign/easing problem)
  solver_err      : where Studio actually put the parts vs forward kinematics (non-zero = joints not applied)
  Uses the standard R6 test rig if rigPath is nil, so Jay's models are untouched. ]]
function Kit.roundTrip(dataName, rigPath, samples)
	local clip = loadClip(dataName)
	samples = samples or 12
	local ownRig = rigPath == nil
	local rig
	if ownRig then
		rig = game:GetService("Players"):CreateHumanoidModelFromDescription(Instance.new("HumanoidDescription"), Enum.HumanoidRigType.R6)
		rig.Name = "ClaudeKit_TestRig"
		rig.Archivable = false
		rig:PivotTo(CFrame.new(0, 200, 0))
		rig.Parent = workspace
		rootOf(rig).Anchored = true
	else
		rig = resolve(rigPath)
	end
	local duration = clip.keys[#clip.keys][1]
	local motors = motorsOf(rig)
	local result = { samples = samples, joint_table_err = { pos = 0, deg = 0 }, animator_err = { deg = 0 },
		solver_err = { pos = 0, deg = 0 }, animator = "not run" }

	-- 1a) joint table: this rig's C0/C1 vs the converter's, at every keyframe (expect[k] matches keys[k])
	local root = rootOf(rig)
	for k, key in ipairs(clip.keys) do
		local trK = {}
		for part, arr in pairs(key[2]) do
			trK[part] = arrayToCF(arr)
		end
		local mineK = fk(rig, trK)
		for part, arr in pairs(clip.expect[k] or {}) do
			if mineK[part] then
				local e = arrayToCF(arr)
				result.joint_table_err.pos = math.max(result.joint_table_err.pos, (mineK[part].Position - e.Position).Magnitude)
				result.joint_table_err.deg = math.max(result.joint_table_err.deg, angleBetween(mineK[part], e))
			end
		end
	end
	-- 1b) solver: pose directly, then check Studio really moved the parts where FK says
	for s = 0, samples - 1 do
		local t = duration * s / math.max(1, samples - 1)
		local tr = clipTransformsAt(clip, t)
		local mine = fk(rig, tr)
		for part, cf in pairs(tr) do
			if motors[part] then
				motors[part].Transform = cf
			end
		end
		task.wait()
		for part, cf in pairs(mine) do
			local p = rig:FindFirstChild(part)
			if p and p:IsA("BasePart") and p ~= root then
				local actual = root.CFrame:ToObjectSpace(p.CFrame)
				result.solver_err.pos = math.max(result.solver_err.pos, (actual.Position - cf.Position).Magnitude)
				result.solver_err.deg = math.max(result.solver_err.deg, angleBetween(actual, cf))
			end
		end
	end
	Kit.reset(rig)

	-- 2) through the Animator (edit-mode stepping)
	local okAnim, err = pcall(function()
		local kfs = buildKfs(clip)
		local id = game:GetService("KeyframeSequenceProvider"):RegisterKeyframeSequence(kfs)
		local anim = Instance.new("Animation")
		anim.AnimationId = id
		local animator = animatorOf(rig)
		local track = animator:LoadAnimation(anim)
		track:Play(0, 1, 0)
		for s = 0, samples - 1 do
			local t = duration * s / math.max(1, samples - 1)
			track.TimePosition = math.min(t, duration - 1e-3)
			animator:StepAnimations(0)
			local want = clipTransformsAt(clip, t)
			for part, cf in pairs(want) do
				if motors[part] then
					result.animator_err.deg = math.max(result.animator_err.deg, angleBetween(motors[part].Transform, cf))
				end
			end
		end
		track:Stop(0)
	end)
	result.animator = okAnim and "ran" or ("failed: " .. tostring(err))
	Kit.reset(rig)
	if ownRig then
		rig:Destroy()
	end
	for _, k in ipairs({ "joint_table_err", "animator_err", "solver_err" }) do
		for f, v in pairs(result[k]) do
			result[k][f] = round(v, 3)
		end
	end
	result.verdict = (result.joint_table_err.deg < 1 and result.animator_err.deg < 2 and result.solver_err.deg < 1)
		and "PASS" or "CHECK"
	return json(result)
end

---------------------------------------------------------------- eyes: camera for screen_capture
-- Points the edit camera at a rig from a named angle. Claude then calls the MCP's screen_capture.
-- view: "front" | "side" | "back" | "top" | "three_quarter";  restore with Kit.restoreCamera()
function Kit.frame(rigPath, view, distance)
	local rig = resolve(rigPath)
	local cam = workspace.CurrentCamera
	local data = dataFolder()
	if not data:FindFirstChild("SavedCamera") then
		local v = Instance.new("CFrameValue")
		v.Name = "SavedCamera"
		v.Value = cam.CFrame
		v:SetAttribute("CameraType", cam.CameraType.Name)
		v.Archivable = false
		v.Parent = data
	end
	local pivot = rig:GetPivot()
	local _, size = rig:GetBoundingBox()
	local d = distance or math.max(size.X, size.Y, size.Z) * 2.2
	local focus = pivot.Position + Vector3.new(0, size.Y * 0.1, 0)
	local dirs = {
		front = -pivot.LookVector,
		back = pivot.LookVector,
		side = pivot.RightVector,
		top = Vector3.new(0, 1, 0) + (-pivot.LookVector) * 0.15,
		three_quarter = ((-pivot.LookVector) + pivot.RightVector * 0.8 + Vector3.new(0, 0.35, 0)),
	}
	local dir = (dirs[view or "front"] or dirs.front).Unit
	cam.CameraType = Enum.CameraType.Scriptable
	cam.CFrame = CFrame.lookAt(focus + dir * d, focus)
	return json({ ok = true, view = view or "front", camera = cfToArray(cam.CFrame) })
end

function Kit.restoreCamera()
	local v = dataFolder():FindFirstChild("SavedCamera")
	local cam = workspace.CurrentCamera
	if v then
		cam.CFrame = v.Value
		pcall(function()
			cam.CameraType = Enum.CameraType[v:GetAttribute("CameraType")]
		end)
		v:Destroy()
	end
	return json({ ok = true })
end

-- Filmstrip plan: returns the steps; Claude runs Kit.poseAt + Kit.frame + screen_capture for each.
function Kit.filmstripPlan(dataName, count)
	local clip = loadClip(dataName)
	local duration = clip.keys[#clip.keys][1]
	count = count or 6
	local times = {}
	for i = 0, count - 1 do
		times[#times + 1] = round(duration * i / math.max(1, count - 1), 3)
	end
	return json({ clip = clip.name, duration = duration, times = times,
		steps = "for each t: Kit.poseAt(rig, data, t); Kit.frame(rig, view); screen_capture; then Kit.reset(rig); Kit.restoreCamera()" })
end

function Kit.cleanup()
	local d = ServerStorage:FindFirstChild("ClaudeKitData")
	if d then
		d:Destroy()
	end
	local r = workspace:FindFirstChild("ClaudeKit_TestRig")
	if r then
		r:Destroy()
	end
	return json({ ok = true })
end

return Kit
]=]
m.Parent = SS
local Kit = require(m)
print(Kit.selftest())
