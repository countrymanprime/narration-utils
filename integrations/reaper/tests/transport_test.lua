-- Recording in REAPER for the Read Aloud control bar (read-aloud-control-bar PRD Phase 7, owner decision D28):
-- arm_only, record_start and record_stop (narration_transport.lua). Arming the chapter's track disarms every other
-- track and remembers the arms the narrator had; they come back when a recording the app started stops, whoever
-- stops it. The app only ever stops a recording it started.

local H = require('harness')

local function new_session()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local chapter = s.fake:add_track('Chapter 1')
  local other = s.fake:add_track('Chapter 2')
  local pickups = s.fake:add_track('Pickups')
  return s, chapter, other, pickups
end

local function arms(s)
  local out = {}
  for _, track in ipairs(s.fake.tracks) do
    out[#out + 1] = track.armed and 1 or 0
  end
  return out
end

local function calls_named(s, name)
  local count = 0
  for _, call in ipairs(s.fake.calls) do
    if call.name == name then
      count = count + 1
    end
  end
  return count
end

-- arm_only -------------------------------------------------------------------------------------------------------

H.test('arm_only arms the named track, disarms every other one and makes no undo point', function()
  local s, chapter, other, pickups = new_session()
  other.armed, pickups.armed = true, true
  s:send('arm_only', 'a1', chapter.guid)
  H.eq(s:events(), { { 'ARMED', 'a1', chapter.guid, '2', '1' } })
  H.eq(arms(s), { 1, 0, 0 })
  H.eq(#s.fake.undo, 0, 'a track arm is not in REAPER undo history, so no empty undo point either')
end)

H.test('arm_only changes nothing when only the named track is armed already', function()
  local s, chapter = new_session()
  chapter.armed = true
  s:send('arm_only', 'a1', chapter.guid)
  H.eq(s:events(), { { 'ARMED', 'a1', chapter.guid, '0', '0' } })
  H.eq(calls_named(s, 'SetMediaTrackInfo_Value'), 0)
end)

H.test('arm_only is refused while REAPER is recording, and nothing changes', function()
  local s, chapter, other = new_session()
  other.armed = true
  s.fake.play_state = 5
  s:send('arm_only', 'a1', chapter.guid)
  H.eq(s:events(), { { 'ERROR', 'a1', 'REAPER is recording. Stop recording first.' } })
  H.eq(arms(s), { 0, 1, 0 })
end)

H.test('arm_only reports a track that is gone and arms nothing in its place', function()
  local s, _, other = new_session()
  other.armed = true
  s:send('arm_only', 'a1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}')
  H.eq(s:events(), { { 'TRACK_STALE', 'a1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}' } })
  H.eq(arms(s), { 0, 1, 0 })
end)

H.test('arm_only needs the track APIs', function()
  local s, chapter = new_session()
  s.fake:remove_api('SetMediaTrackInfo_Value')
  s:send('arm_only', 'a1', chapter.guid)
  H.eq(s:events(), { { 'ERROR', 'a1', 'This REAPER version cannot arm tracks.' } })
end)

-- record_start ---------------------------------------------------------------------------------------------------

H.test('record_start records when the one armed track is the named one, and says where', function()
  local s, chapter = new_session()
  chapter.armed = true
  s.fake.cursor = 42.5
  s:send('record_start', 'r1', chapter.guid)
  H.eq(s:events(), { { 'RECORD_STARTED', 'r1', chapter.guid, '42.500000' } })
  H.eq(calls_named(s, 'CSurf_OnRecord'), 1)
  H.eq(s.fake.play_state, 5)
end)

H.test('record_start refuses unless exactly the named track is armed', function()
  local cases = {
    { armed = {}, message = 'No track is armed.' },
    { armed = { 1, 2 }, message = 'More than one track is armed.' },
    { armed = { 2 }, message = 'Another track is armed.' },
  }
  for _, case in ipairs(cases) do
    local s = new_session()
    for _, index in ipairs(case.armed) do
      s.fake.tracks[index].armed = true
    end
    s:send('record_start', 'r1', s.fake.tracks[1].guid)
    H.eq(s:events(), { { 'ERROR', 'r1', case.message } }, case.message)
    H.eq(calls_named(s, 'CSurf_OnRecord'), 0, case.message)
  end
end)

H.test('record_start refuses while REAPER plays, is paused or records', function()
  for _, state in ipairs({ { 1, 'REAPER is playing. Stop it first.' }, { 2, 'REAPER is playing. Stop it first.' }, { 5, 'REAPER is already recording.' } }) do
    local s, chapter = new_session()
    chapter.armed = true
    s.fake.play_state = state[1]
    s:send('record_start', 'r1', chapter.guid)
    H.eq(s:events(), { { 'ERROR', 'r1', state[2] } })
    H.eq(calls_named(s, 'CSurf_OnRecord'), 0)
  end
end)

H.test('record_start reports a track that is gone', function()
  local s, chapter = new_session()
  chapter.armed = true
  s:send('record_start', 'r1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}')
  H.eq(s:events(), { { 'TRACK_STALE', 'r1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}' } })
  H.eq(calls_named(s, 'CSurf_OnRecord'), 0)
end)

H.test('record_start waits a few defer cycles for REAPER to report recording, then answers', function()
  local s, chapter = new_session()
  chapter.armed = true
  s.fake.record_delay_ticks = 3
  s:send('record_start', 'r1', chapter.guid)
  H.eq(s:events(), {}, 'no answer before REAPER says it records')
  for _ = 1, 3 do
    s:tick()
  end
  H.eq(s:events(), { { 'RECORD_STARTED', 'r1', chapter.guid, '0.000000' } })
  H.eq(calls_named(s, 'CSurf_OnRecord'), 1)
end)

H.test('record_start says so when REAPER does not start recording, and claims no recording', function()
  local s, chapter = new_session()
  chapter.armed = true
  s.fake.record_fails = true
  s:send('record_start', 'r1', chapter.guid)
  for _ = 1, 40 do
    s:tick()
  end
  H.eq(s:events(), { { 'ERROR', 'r1', 'REAPER did not start recording.' } })
  H.eq(calls_named(s, 'CSurf_OnRecord'), 1, 'the toggle is pressed once and never again to "fix" it')
  s:send('record_stop', 's1')
  H.eq(s:events(), { { 'RECORD_NOT_OURS', 's1' } })
end)

H.test('record_start needs the record API', function()
  local s, chapter = new_session()
  chapter.armed = true
  s.fake:remove_api('CSurf_OnRecord')
  s:send('record_start', 'r1', chapter.guid)
  H.eq(s:events(), { { 'ERROR', 'r1', 'This REAPER version cannot start recording.' } })
end)

-- record_stop ----------------------------------------------------------------------------------------------------

H.test('record_stop stops the recording the app started and puts back the arms the narrator had', function()
  local s, chapter, other, pickups = new_session()
  other.armed, pickups.armed = true, true
  s:send('arm_only', 'a1', chapter.guid)
  s:send('record_start', 'r1', chapter.guid)
  s:events()
  s:send('record_stop', 's1')
  H.eq(s:events(), { { 'RECORD_STOPPED', 's1', '3', '0' } })
  H.eq(s.fake.play_state, 0)
  H.eq(calls_named(s, 'OnStopButton'), 1)
  H.eq(arms(s), { 0, 1, 1 })
  s:tick()
  H.eq(s:events(), {}, 'the watch ends with the recording, so no second end is reported')
end)

H.test('record_stop never stops a recording the app did not start', function()
  local s, chapter = new_session()
  chapter.armed = true
  s.fake.play_state = 5
  s:send('record_stop', 's1')
  H.eq(s:events(), { { 'RECORD_NOT_OURS', 's1' } })
  H.eq(s.fake.play_state, 5)
  H.eq(calls_named(s, 'OnStopButton'), 0)
end)

H.test('record_stop without arm_only stops the recording and has no arms to put back', function()
  local s, chapter = new_session()
  chapter.armed = true
  s:send('record_start', 'r1', chapter.guid)
  s:events()
  s:send('record_stop', 's1')
  H.eq(s:events(), { { 'RECORD_STOPPED', 's1', '0', '0' } })
  H.eq(arms(s), { 1, 0, 0 })
end)

H.test('a recording the narrator stops in REAPER ends the app one, puts the arms back, and is not stopped again', function()
  local s, chapter, other = new_session()
  other.armed = true
  s:send('arm_only', 'a1', chapter.guid)
  s:send('record_start', 'r1', chapter.guid)
  s:events()
  s:tick()
  H.eq(s:events(), {}, 'still recording: nothing to report')
  s.fake.play_state = 0 -- the narrator pressed Stop in REAPER
  s:tick()
  H.eq(s:events(), { { 'RECORD_ENDED', 'r1', '2', '0' } })
  H.eq(arms(s), { 0, 1, 0 })
  s.fake.play_state = 5 -- and then started a recording of their own
  s:send('record_stop', 's1')
  H.eq(s:events(), { { 'RECORD_NOT_OURS', 's1' } })
  H.eq(s.fake.play_state, 5)
end)

H.test('an arm the narrator changes during the take is theirs: it is kept, the rest is put back', function()
  local s, chapter, other, pickups = new_session()
  other.armed = true
  s:send('arm_only', 'a1', chapter.guid)
  s:send('record_start', 'r1', chapter.guid)
  pickups.armed = true -- armed by hand during the take; it was not armed before
  s:events()
  s:send('record_stop', 's1')
  H.eq(s:events(), { { 'RECORD_STOPPED', 's1', '2', '1' } })
  H.eq(arms(s), { 0, 1, 1 })
end)

H.test('a second arm_only keeps the arms the narrator had before the first one', function()
  local s, chapter, other, pickups = new_session()
  pickups.armed = true
  s:send('arm_only', 'a1', other.guid)
  s:send('arm_only', 'a2', chapter.guid)
  s:send('record_start', 'r1', chapter.guid)
  s:send('record_stop', 's1')
  H.eq(arms(s), { 0, 0, 1 })
end)

H.test('arms are put back once: a later recording without arm_only leaves them alone', function()
  local s, chapter, other = new_session()
  other.armed = true
  s:send('arm_only', 'a1', chapter.guid)
  s:send('record_start', 'r1', chapter.guid)
  s:send('record_stop', 's1')
  H.eq(arms(s), { 0, 1, 0 })
  other.armed = false
  chapter.armed = true
  s:send('record_start', 'r2', chapter.guid)
  s:send('record_stop', 's2')
  s:events()
  H.eq(arms(s), { 1, 0, 0 })
end)

H.test('a track deleted during the take is skipped when the arms are put back', function()
  local s, chapter, other, pickups = new_session()
  other.armed, pickups.armed = true, true
  s:send('arm_only', 'a1', chapter.guid)
  s:send('record_start', 'r1', chapter.guid)
  table.remove(s.fake.tracks, 2)
  s:events()
  s:send('record_stop', 's1')
  H.eq(s:events(), { { 'RECORD_STOPPED', 's1', '2', '0' } })
  H.eq(arms(s), { 0, 1 })
end)

H.test('record_stop while REAPER is still starting the app recording stops it and ends the start', function()
  local s, chapter = new_session()
  chapter.armed = true
  s.fake.record_delay_ticks = 5
  s:send('record_start', 'r1', chapter.guid)
  s:send('record_stop', 's1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'Recording was stopped before REAPER started it.' }, { 'RECORD_STOPPED', 's1', '0', '0' } })
  for _ = 1, 10 do
    s:tick()
  end
  H.eq(s.fake.play_state, 0, 'a late start is stopped, never left running')
  H.eq(s:events(), {})
end)

H.test('the transport commands make no undo point and never call Main_OnCommand', function()
  local s, chapter, other = new_session()
  other.armed = true
  s:send('arm_only', 'a1', chapter.guid)
  s:send('record_start', 'r1', chapter.guid)
  s:send('record_stop', 's1')
  H.eq(#s.fake.undo, 0)
  H.eq(calls_named(s, 'Main_OnCommand'), 0)
end)
