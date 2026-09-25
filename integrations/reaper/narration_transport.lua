-- Recording in REAPER for the Read Aloud control bar, over the bridge: arm_only, record_start and record_stop
-- (read-aloud-control-bar PRD Phase 7, owner decision D28; the calls are in
-- docs/research/reaper-api-for-planned-commands.md). Loaded by narration_ui_bridge.lua, which passes the shared helpers
-- as the chunk argument. The read side (which tracks are armed, whether REAPER records) is chapter_track_state in
-- narration_track_state.lua; this file holds only the commands that change the transport or the arms.
--
-- arm_only arms one track and disarms every other, remembering the arms the narrator had before the first arm_only.
-- They are put back when a recording this bridge started stops, whether record_stop stops it or the narrator stops it
-- in REAPER (a short defer watch notices), and only where an arm is still what arm_only left it: an arm the narrator
-- changed meanwhile is theirs and is kept. A track arm is not in REAPER's undo history, so arm_only opens no undo block.
--
-- record_start records only when REAPER is stopped and exactly one track is armed, the named one. record_stop stops
-- only the recording this bridge started (RECORD_NOT_OURS otherwise). Neither calls Main_OnCommand: recording starts
-- with CSurf_OnRecord, pressed once after REAPER was seen stopped, since it is a toggle; RECORD_STARTED follows once
-- GetPlayState reports recording, which may be a few defer cycles later.

local core = ...
local event = core.event

local function normalize_guid(guid)
  local bare = tostring(guid or ''):gsub('[{}%s]', ''):upper()
  if bare == '' then
    return ''
  end
  return '{' .. bare .. '}'
end
local function track_guid(track)
  return normalize_guid(reaper.GetTrackGUID(track))
end
local function tracks()
  local out = {}
  for index = 0, reaper.CountTracks(0) - 1 do
    out[#out + 1] = reaper.GetTrack(0, index)
  end
  return out
end
local function find_track(guid_text)
  local wanted = normalize_guid(guid_text)
  if wanted == '' then
    return nil
  end
  for _, track in ipairs(tracks()) do
    if track_guid(track) == wanted then
      return track
    end
  end
  return nil
end
local function armed(track)
  return reaper.GetMediaTrackInfo_Value(track, 'I_RECARM') ~= 0
end
local function set_armed(track, value)
  reaper.SetMediaTrackInfo_Value(track, 'I_RECARM', value and 1 or 0)
end
-- GetPlayState is a bit field (1 playing, 2 paused, 4 recording), read with arithmetic as narration_navigation.lua does.
local function recording()
  return math.floor(reaper.GetPlayState() / 4) % 2 == 1
end

-- Puts back the arms remembered by the first arm_only. A track still armed as arm_only left it goes back to what the
-- narrator had; a track whose arm changed since is kept; a track that is gone, or was added since, is left alone.
-- Answers how many were put back and how many kept, and forgets the remembered arms.
local function restore_arms(state)
  local saved = state.saved_arms
  state.saved_arms = nil
  if not saved then
    return 0, 0
  end
  local restored, kept = 0, 0
  for _, track in ipairs(tracks()) do
    local guid = track_guid(track)
    local before = saved.arms[guid]
    if before ~= nil then
      local now, left = armed(track), guid == saved.target
      if now ~= before then
        if now == left then
          set_armed(track, before)
          restored = restored + 1
        else
          kept = kept + 1
        end
      end
    end
  end
  return restored, kept
end

-- Ends the recording this bridge started: forgets it and puts the arms back.
local function finish(state)
  state.recording = nil
  return restore_arms(state)
end

local function arm_only(session_dir, state, run_id, guid_text)
  if not reaper.APIExists('CountTracks') or not reaper.APIExists('SetMediaTrackInfo_Value') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot arm tracks.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local target = find_track(guid_text)
  if not target then
    event(session_dir, 'TRACK_STALE', run_id, guid_text)
    return
  end
  if not state.saved_arms then
    local arms = {}
    for _, track in ipairs(tracks()) do
      arms[track_guid(track)] = armed(track)
    end
    state.saved_arms = { arms = arms }
  end
  state.saved_arms.target = track_guid(target)
  local disarmed, changed = 0, false
  for _, track in ipairs(tracks()) do
    if track == target then
      if not armed(track) then
        set_armed(track, true)
        changed = true
      end
    elseif armed(track) then
      set_armed(track, false)
      disarmed, changed = disarmed + 1, true
    end
  end
  event(session_dir, 'ARMED', run_id, state.saved_arms.target, disarmed, changed and 1 or 0)
end

-- How many defer cycles record_start waits for GetPlayState to report recording after pressing record (about a second
-- at REAPER's usual defer rate). The reference does not say the state changes within the same cycle; the verification
-- pass (row B2) records whether it does.
local START_WAIT_CYCLES = 30

local function started(session_dir, record)
  record.started = true
  event(session_dir, 'RECORD_STARTED', record.run_id, record.track, string.format('%.6f', record.position))
end

-- Watches a recording this bridge started, one defer cycle at a time: first until REAPER reports it (or the wait runs
-- out), then until it stops or record_stop ends it first. A start record_stop cancelled while REAPER was still starting
-- is stopped if it begins after all, so a late start is never left running.
local function watch(session_dir, state, record)
  local function tick()
    if record.cancelled then
      if recording() then
        reaper.OnStopButton()
      elseif record.waited < START_WAIT_CYCLES then
        record.waited = record.waited + 1
        reaper.defer(tick)
      end
      return
    end
    if state.recording ~= record then
      return
    end
    if not record.started then
      if recording() then
        started(session_dir, record)
      else
        record.waited = record.waited + 1
        if record.waited >= START_WAIT_CYCLES then
          state.recording = nil
          event(session_dir, 'ERROR', record.run_id, 'REAPER did not start recording.')
          return
        end
      end
      reaper.defer(tick)
      return
    end
    if recording() then
      reaper.defer(tick)
      return
    end
    local restored, kept = finish(state)
    event(session_dir, 'RECORD_ENDED', record.run_id, restored, kept)
  end
  reaper.defer(tick)
end

local function record_start(session_dir, state, run_id, guid_text)
  if not reaper.APIExists('CSurf_OnRecord') or not reaper.APIExists('CountTracks') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot start recording.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is already recording.')
    return
  end
  if reaper.GetPlayState() ~= 0 then
    event(session_dir, 'ERROR', run_id, 'REAPER is playing. Stop it first.')
    return
  end
  local target = find_track(guid_text)
  if not target then
    event(session_dir, 'TRACK_STALE', run_id, guid_text)
    return
  end
  local armed_tracks = {}
  for _, track in ipairs(tracks()) do
    if armed(track) then
      armed_tracks[#armed_tracks + 1] = track
    end
  end
  if #armed_tracks == 0 then
    event(session_dir, 'ERROR', run_id, 'No track is armed.')
    return
  elseif #armed_tracks > 1 then
    event(session_dir, 'ERROR', run_id, 'More than one track is armed.')
    return
  elseif armed_tracks[1] ~= target then
    event(session_dir, 'ERROR', run_id, 'Another track is armed.')
    return
  end
  local record = { run_id = run_id, track = track_guid(target), position = reaper.GetCursorPosition(), waited = 0 }
  reaper.CSurf_OnRecord()
  state.recording = record
  if recording() then
    started(session_dir, record)
  end
  watch(session_dir, state, record)
end

local function record_stop(session_dir, state, run_id)
  if not state.recording then
    event(session_dir, 'RECORD_NOT_OURS', run_id)
    return
  end
  local record = state.recording
  if not record.started then
    record.cancelled = true
    event(session_dir, 'ERROR', record.run_id, 'Recording was stopped before REAPER started it.')
  end
  if recording() then
    reaper.OnStopButton()
  end
  local restored, kept = finish(state)
  event(session_dir, 'RECORD_STOPPED', run_id, restored, kept)
end

return function(registry)
  local state = {}
  registry.register('arm_only', function(ctx, args)
    arm_only(ctx.session_dir, state, args[1] or '', args[2] or '')
  end)
  registry.register('record_start', function(ctx, args)
    record_start(ctx.session_dir, state, args[1] or '', args[2] or '')
  end)
  registry.register('record_stop', function(ctx, args)
    record_stop(ctx.session_dir, state, args[1] or '')
  end)
end
