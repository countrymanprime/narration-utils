-- Retakes on fixed lanes: pick_retake_lane (narration_retake_lanes.lua, docs/prds/reaper-automation-follow-through.prd.md
-- Phase 25, ADR 0147). The narrator's pick of a retake makes its lane the only one playing: one track value
-- (C_LANEPLAYS:<lane>=1) in one undo block, and nothing else. The load-bearing tests: exactly one value is set, on
-- the retake's own track; the lane mode, lane count, items, takes and every other track stay as they were; a track
-- not in fixed-lane mode is refused rather than converted; and a retake is named by line id plus item GUID, so a
-- stale GUID or an item that no longer carries the line changes nothing.

local H = require('harness')

local LINE = 'line-000004'

-- Three retakes of one line on lanes 0 to 2 of a lane track, every lane playing, plus another line's item on lane 0
-- and a second lane track holding a comp copy of the same line (a line id names several items on lane tracks).
local function new_session()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  s.track = s.fake:add_track('Narration')
  s.fake:set_fixed_lanes(s.track, 3)
  s.retakes = {}
  for lane = 0, 2 do
    local item = s.fake:add_item(s.track, {
      source = 'retake' .. lane .. '.wav',
      position = 0,
      length = 3,
      lane = lane,
      take_name = 'retake ' .. (lane + 1),
    })
    item.ext.narration_utils_line_id = LINE
    s.retakes[lane] = item
  end
  s.other = s.fake:add_item(s.track, { source = 'next.wav', position = 4, length = 3, lane = 0 })
  s.other.ext.narration_utils_line_id = 'line-000005'
  s.second_track = s.fake:add_track('Comp')
  s.fake:set_fixed_lanes(s.second_track, 2)
  s.copy = s.fake:add_item(s.second_track, { source = 'retake2.wav', position = 0, length = 3, lane = 1 })
  s.copy.ext.narration_utils_line_id = LINE
  return s
end

-- Every call that could change the project: the lane setters, the item setter and Main_OnCommand.
local function setter_calls(s)
  local out = {}
  for _, call in ipairs(s.fake.calls) do
    if call.name:match('^Set') or call.name == 'Main_OnCommand' then
      out[#out + 1] = { call.name, call.key or call.command_id, call.value }
    end
  end
  return out
end

local function plays(track)
  local out = {}
  for lane = 0, track.lane_count - 1 do
    out[#out + 1] = track.lane_plays[lane]
  end
  return out
end

-- Everything in the fake project except the lane play state of the picked track.
local function project_snapshot(s)
  local items = {}
  for _, item in ipairs(s.fake:ordered_items()) do
    local takes = {}
    for _, take in ipairs(item.takes) do
      takes[#takes + 1] = { take.guid, take.source.file, take.startoffs }
    end
    items[#items + 1] = {
      item.guid,
      item.position,
      item.length,
      item.lane,
      item.selected,
      item.ext.narration_utils_line_id or '',
      item.active_index or 1,
      takes,
    }
  end
  local tracks = {}
  for _, track in ipairs(s.fake.tracks) do
    tracks[#tracks + 1] = { track.name, track.free_mode or 0, track.lane_count or 1 }
  end
  return { items = items, tracks = tracks, second = plays(s.second_track), markers = #s.fake.markers, cursor = s.fake.cursor }
end

H.test('pick_retake_lane makes the retake lane the only one playing and names the line, item and lane', function()
  local s = new_session()
  s:send('pick_retake_lane', 't1', LINE, s.retakes[1].guid)
  H.eq(s:events(), { { 'RETAKE_LANE_PICKED', 't1', LINE, s.retakes[1].guid, '1' } })
  H.eq(plays(s.track), { 0, 1, 0 })
end)

H.test('pick_retake_lane sets exactly one value, in one undo block, and nothing else', function()
  local s = new_session()
  s:send('pick_retake_lane', 't1', LINE, s.retakes[2].guid)
  H.eq(setter_calls(s), { { 'SetMediaTrackInfo_Value', 'C_LANEPLAYS:2', 1 } })
  H.eq(#s.fake.undo, 1, 'one undo step, so one Undo in REAPER restores the previous play state')
  H.eq(s.fake.undo[1].label, 'Narration Utils: play retake lane 3')
  H.eq(s.fake.open_undo_blocks, 0)
end)

H.test('pick_retake_lane changes no item, take, lane mode, lane count, other track, marker or cursor', function()
  local s = new_session()
  local before = project_snapshot(s)
  s:send('pick_retake_lane', 't1', LINE, s.retakes[0].guid)
  H.eq(project_snapshot(s), before)
  H.eq(plays(s.second_track), { 2, 2 }, 'the comp copy of the same line on another track is left alone')
end)

H.test('pick_retake_lane plays the lane of the named item on its own track, when another track shares the line', function()
  local s = new_session()
  s:send('pick_retake_lane', 't1', LINE, s.copy.guid)
  H.eq(s:events(), { { 'RETAKE_LANE_PICKED', 't1', LINE, s.copy.guid, '1' } })
  H.eq(plays(s.second_track), { 0, 1 })
  H.eq(plays(s.track), { 2, 2, 2 })
end)

H.test('pick_retake_lane reads the lane REAPER has now, not one the host sends', function()
  local s = new_session()
  s.retakes[0].lane = 2 -- The narrator moved the retake since the project was saved.
  s:send('pick_retake_lane', 't1', LINE, s.retakes[0].guid)
  H.eq(s:events(), { { 'RETAKE_LANE_PICKED', 't1', LINE, s.retakes[0].guid, '2' } })
  H.eq(plays(s.track), { 0, 0, 1 })
end)

H.test('pick_retake_lane is safe to send twice: the same lane plays and each pick is its own undo step', function()
  local s = new_session()
  s:send('pick_retake_lane', 't1', LINE, s.retakes[1].guid)
  s:send('pick_retake_lane', 't2', LINE, s.retakes[1].guid)
  H.eq(plays(s.track), { 0, 1, 0 })
  H.eq(#s.fake.undo, 2)
end)

H.test('pick_retake_lane accepts the item GUID in any case, with or without braces', function()
  local s = new_session()
  local bare = s.retakes[1].guid:gsub('[{}]', ''):lower()
  s:send('pick_retake_lane', 't1', LINE, bare)
  H.eq(s:events(), { { 'RETAKE_LANE_PICKED', 't1', LINE, s.retakes[1].guid, '1' } })
end)

H.test('pick_retake_lane refuses a track that is not in fixed-lane mode, and never turns lanes on', function()
  local s = new_session()
  local plain = s.fake:add_track('Takes')
  local item = s.fake:add_item(plain, { source = 'a.wav' })
  item.ext.narration_utils_line_id = LINE
  local before = project_snapshot(s)
  s:send('pick_retake_lane', 't1', LINE, item.guid)
  H.eq(s:events(), {
    {
      'ERROR',
      't1',
      'The track "Takes" is not in fixed item lane mode, so it has no lanes to choose from. Narration Utils never turns lanes on or converts takes to lanes: do that in REAPER if you want to.',
    },
  })
  H.eq(setter_calls(s), {})
  H.eq(#s.fake.undo, 0)
  H.eq(project_snapshot(s), before)
end)

H.test('pick_retake_lane changes nothing when the item GUID is no longer in the project', function()
  local s = new_session()
  s:send('pick_retake_lane', 't1', LINE, '{DEADBEEF-0000-4000-8000-000000000000}')
  H.eq(s:events(), {
    { 'ERROR', 't1', 'That retake is no longer in the REAPER project. Save the project in REAPER and open the list again.' },
  })
  H.eq(setter_calls(s), {})
  H.eq(#s.fake.undo, 0)
end)

H.test('pick_retake_lane changes nothing when the item no longer carries the line', function()
  local s = new_session()
  local stale = 'That retake no longer belongs to this line. Save the project in REAPER and open the list again.'
  s.retakes[1].ext.narration_utils_line_id = 'line-000009'
  s:send('pick_retake_lane', 't1', LINE, s.retakes[1].guid)
  H.eq(s:events(), { { 'ERROR', 't1', stale } })
  s.retakes[1].ext.narration_utils_line_id = nil
  s:send('pick_retake_lane', 't2', LINE, s.retakes[1].guid)
  H.eq(s:events(), { { 'ERROR', 't2', stale } })
  H.eq(setter_calls(s), {})
  H.eq(plays(s.track), { 2, 2, 2 })
end)

H.test('pick_retake_lane needs both a line id and an item GUID', function()
  for _, missing in ipairs({ 'line', 'guid' }) do
    local s = new_session()
    s:send('pick_retake_lane', 't1', missing == 'line' and '' or LINE, missing == 'guid' and '' or s.retakes[0].guid)
    H.eq(s:events(), { { 'ERROR', 't1', 'Choose a retake to play.' } }, missing)
    H.eq(setter_calls(s), {}, missing)
  end
end)

H.test('pick_retake_lane needs the fixed-lane API', function()
  local s = new_session()
  s.fake:remove_api('SetMediaTrackInfo_Value')
  s:send('pick_retake_lane', 't1', LINE, s.retakes[1].guid)
  H.eq(s:events(), { { 'ERROR', 't1', 'This REAPER version has no fixed item lanes. They need REAPER 7 or later.' } })
  H.eq(plays(s.track), { 2, 2, 2 })
end)

H.test('pick_retake_lane writes a debug bridge.jsonl record for the received command and the lane picked', function()
  local s = new_session()
  s:send('pick_retake_lane', 't1', LINE, s.retakes[1].guid, 'host-run-1', 'debug')
  local lines = H.lines(H.read_text(s:path('bridge.jsonl')) or '')
  H.eq(#lines, 2)
  H.contains(lines[1], '"event":"pick_retake_lane.received"')
  H.contains(lines[1], '"run":"host-run-1"')
  H.contains(lines[2], '"event":"pick_retake_lane.picked"')
  H.contains(lines[2], '"lane":"1"')
end)

H.test('pick_retake_lane writes no bridge.jsonl record when the host did not ask for debug', function()
  local s = new_session()
  s:send('pick_retake_lane', 't1', LINE, s.retakes[1].guid, 'host-run-1', 'info')
  H.eq(H.read_text(s:path('bridge.jsonl')), nil)
end)

H.test('pick_retake_lane records a refusal reason at debug level, never the item GUID as project content', function()
  local s = new_session()
  s:send('pick_retake_lane', 't1', LINE, 'not-a-real-guid', 'host-run-1', 'debug')
  local lines = H.lines(H.read_text(s:path('bridge.jsonl')) or '')
  H.eq(#lines, 2)
  H.contains(lines[2], '"event":"pick_retake_lane.refused"')
  H.contains(lines[2], '"reason":"retake_not_found"')
end)
