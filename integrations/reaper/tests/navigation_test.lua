-- Going to and looping a finding by GUID: navigate_item, loop_context, stop_loop and ping (review-dashboard PRD
-- Phase 6, Q6; docs/architecture/reaper-navigation.md). Nothing here may ever fall back to a neighbouring item or to a
-- position the finding only had when it was made.

local H = require('harness')

local ITEM = '{AAAAAAAA-0000-4000-8000-000000000001}'
local TAKE = '{AAAAAAAA-0000-4000-8000-0000000000A1}'
local OTHER = '{BBBBBBBB-0000-4000-8000-000000000002}'
local MISSING = '{FFFFFFFF-0000-4000-8000-00000000FFFF}'

-- One track, the finding's item at 100 s (30 s long, source offset 10, rate 1) and a neighbour right after it.
local function scene()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local track = s.fake:add_track('Narrator')
  local item = s.fake:add_item(track, { guid = ITEM, take_guid = TAKE, position = 100, length = 30, source = 'a.wav', startoffs = 10 })
  local neighbour = s.fake:add_item(track, { guid = OTHER, position = 130, length = 30, source = 'b.wav' })
  return s, item, neighbour
end

local function nothing_moved(s, label)
  H.eq(s.fake.cursor, 0, label .. ': the edit cursor did not move')
  H.eq(s.fake.time_selection, { 0, 0 }, label .. ': the time selection is untouched')
  H.eq(s.fake.play_state, 0, label .. ': nothing plays')
end

-- navigate_item ---------------------------------------------------------------------------------------------------

H.test('navigate_item selects only the finding item and moves the edit cursor to its source time', function()
  local s, item, neighbour = scene()
  neighbour.selected = true
  s:send('navigate_item', 'n1', ITEM, TAKE, '12.5')
  -- 100 + (12.5 - 10) / 1
  H.eq(s:events(), { { 'NAVIGATED', 'n1', ITEM, '102.500000' } })
  H.eq({ item.selected, neighbour.selected }, { true, false })
  H.eq(s.fake.cursor, 102.5)
  H.eq({ s.fake.cursor_moveview, s.fake.cursor_seekplay }, { true, false }, 'the view follows, playback is not moved')
  H.eq(#s.fake.undo, 0, 'going somewhere is not an edit: no undo point')
end)

H.test('navigate_item honours the take play rate and accepts a GUID in any case or without braces', function()
  local s = scene()
  local fast =
    s.fake:add_item(s.fake.tracks[1], { guid = '{CCCCCCCC-0000-4000-8000-000000000003}', position = 200, length = 10, source = 'c.wav', playrate = 2 })
  s:send('navigate_item', 'n1', 'cccccccc-0000-4000-8000-000000000003', '', '4')
  H.eq(s:events(), { { 'NAVIGATED', 'n1', fast.guid, '202.000000' } })
end)

H.test('navigate_item without a source time goes to the start of the item', function()
  local s = scene()
  s:send('navigate_item', 'n1', ITEM, '', '')
  H.eq(s:events(), { { 'NAVIGATED', 'n1', ITEM, '100.000000' } })
end)

H.test('navigate_item reports an item GUID that no longer resolves and never uses a neighbour', function()
  local s, item, neighbour = scene()
  s:send('navigate_item', 'n1', MISSING, '', '12.5')
  H.eq(s:events(), { { 'FINDING_STALE', 'n1', MISSING, 'item' } })
  H.eq({ item.selected, neighbour.selected }, { false, false })
  nothing_moved(s, 'stale item')
end)

H.test('navigate_item refuses an empty item GUID rather than guessing from a position', function()
  local s = scene()
  s:send('navigate_item', 'n1', '', '', '12.5')
  H.eq(s:events(), { { 'FINDING_STALE', 'n1', '', 'item' } })
  nothing_moved(s, 'no GUID')
end)

H.test('navigate_item reports a take GUID that is no longer on the item, even though the item is there', function()
  local s, item = scene()
  s:send('navigate_item', 'n1', ITEM, MISSING, '12.5')
  H.eq(s:events(), { { 'FINDING_STALE', 'n1', MISSING, 'take' } })
  H.eq(item.selected, false)
  nothing_moved(s, 'stale take')
end)

H.test('navigate_item reports a spot the item no longer covers (trimmed or re-offset since the finding was made)', function()
  local s, item = scene()
  item.length = 1 -- the item now ends at 101 s; the finding at 102.5 s is gone from it
  s:send('navigate_item', 'n1', ITEM, TAKE, '12.5')
  H.eq(s:events(), { { 'FINDING_STALE', 'n1', ITEM, 'range' } })
  nothing_moved(s, 'trimmed away')
end)

H.test('navigate_item refuses a source time that is not a number', function()
  local s = scene()
  s:send('navigate_item', 'n1', ITEM, TAKE, 'soon')
  H.eq(s:events(), { { 'ERROR', 'n1', 'The finding has no usable time.' } })
  nothing_moved(s, 'bad time')
end)

H.test('navigate_item does nothing while REAPER is recording', function()
  local s, item = scene()
  s.fake.play_state = 5 -- playing and recording
  s:send('navigate_item', 'n1', ITEM, TAKE, '12.5')
  H.eq(s:events(), { { 'ERROR', 'n1', 'REAPER is recording. Stop recording first.' } })
  H.eq(item.selected, false)
  H.eq(s.fake.cursor, 0)
end)

H.test('navigate_item twice lands on the same spot', function()
  local s = scene()
  s:send('navigate_item', 'n1', ITEM, TAKE, '12.5')
  s:send('navigate_item', 'n2', ITEM, TAKE, '12.5')
  H.eq(s:events(), { { 'NAVIGATED', 'n1', ITEM, '102.500000' }, { 'NAVIGATED', 'n2', ITEM, '102.500000' } })
end)

-- loop_context ----------------------------------------------------------------------------------------------------

H.test('loop_context sets the time selection and loop points to the window, turns repeat on and plays from its start', function()
  local s = scene()
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  H.eq(s:events(), { { 'LOOP_STARTED', 'l1', ITEM, '101.000000', '105.000000' } })
  H.eq(s.fake.time_selection, { 101, 105 })
  H.eq(s.fake.loop_points, { 101, 105 }, 'repeat follows the loop points, which may not be linked to the time selection')
  H.eq(s.fake.repeat_on, 1)
  H.eq(s.fake.cursor, 101)
  H.eq(s.fake.play_state, 1)
  H.eq(#s.fake.undo, 0, 'a loop is transport state, not an edit: no undo point')
end)

H.test('loop_context keeps the window inside the item', function()
  local s = scene()
  -- 9 s is before the item's source offset (10 s) and 45 s past its end (40 s): the window is clamped to 100..130.
  s:send('loop_context', 'l1', ITEM, TAKE, '9', '45')
  H.eq(s:events(), { { 'LOOP_STARTED', 'l1', ITEM, '100.000000', '130.000000' } })
end)

H.test('loop_context stops what was playing before it plays the window', function()
  local s = scene()
  s.fake.play_state = 1
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  H.eq(s.fake:transport_calls(), { 'OnStopButton', 'OnPlayButton' })
end)

H.test('loop_context reports a stale item, take or window and changes nothing', function()
  local s, item = scene()
  s:send('loop_context', 'l1', MISSING, '', '11', '15')
  s:send('loop_context', 'l2', ITEM, MISSING, '11', '15')
  item.length = 0.5
  s:send('loop_context', 'l3', ITEM, TAKE, '11', '15')
  H.eq(s:events(), {
    { 'FINDING_STALE', 'l1', MISSING, 'item' },
    { 'FINDING_STALE', 'l2', MISSING, 'take' },
    { 'FINDING_STALE', 'l3', ITEM, 'range' },
  })
  nothing_moved(s, 'stale loop')
  H.eq(s.fake.repeat_on, 0)
end)

H.test('loop_context refuses a window that is missing or runs backwards', function()
  local s = scene()
  s:send('loop_context', 'l1', ITEM, TAKE, '', '15')
  s:send('loop_context', 'l2', ITEM, TAKE, '15', '11')
  H.eq(s:events(), {
    { 'ERROR', 'l1', 'The finding has no usable time.' },
    { 'ERROR', 'l2', 'The finding has no usable time.' },
  })
  nothing_moved(s, 'bad window')
end)

H.test('loop_context does nothing while REAPER is recording', function()
  local s = scene()
  s.fake.play_state = 5
  s.fake.time_selection = { 1, 2 }
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  H.eq(s:events(), { { 'ERROR', 'l1', 'REAPER is recording. Stop recording first.' } })
  H.eq(s.fake.time_selection, { 1, 2 })
  H.eq(s.fake:transport_calls(), {}, 'recording is never stopped or restarted for the narrator')
end)

H.test('loop_context needs the looping API', function()
  local s = scene()
  s.fake:remove_api('GetSetRepeat')
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  H.eq(s:events(), { { 'ERROR', 'l1', 'This REAPER version cannot loop a finding.' } })
end)

-- stop_loop -------------------------------------------------------------------------------------------------------

H.test('stop_loop stops playback and restores the time selection, loop points and repeat the narrator had', function()
  local s = scene()
  s.fake.time_selection, s.fake.loop_points, s.fake.repeat_on = { 3, 7 }, { 2, 9 }, 0
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s:send('stop_loop', 's1')
  H.eq(s:events(), { { 'LOOP_STARTED', 'l1', ITEM, '101.000000', '105.000000' }, { 'LOOP_STOPPED', 's1', '3', '0' } })
  H.eq(s.fake.time_selection, { 3, 7 })
  H.eq(s.fake.loop_points, { 2, 9 })
  H.eq(s.fake.repeat_on, 0)
  H.eq(s.fake.play_state, 0)
  H.eq(#s.fake.undo, 0)
end)

H.test('with the loop points linked to the time selection (REAPER 7.80 default) stop still reports all three restored', function()
  local s = scene()
  s.fake.linked_loop = true
  s.fake.time_selection, s.fake.loop_points = { 3, 7 }, { 3, 7 }
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s:send('stop_loop', 's1')
  H.eq(s:events()[2], { 'LOOP_STOPPED', 's1', '3', '0' })
  H.eq({ s.fake.time_selection, s.fake.loop_points }, { { 3, 7 }, { 3, 7 } })
end)

H.test('with linked loop points a selection the narrator made during the loop is kept for both', function()
  local s = scene()
  s.fake.linked_loop = true
  s.fake.time_selection, s.fake.loop_points = { 3, 7 }, { 3, 7 }
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  reaper.GetSet_LoopTimeRange2(0, true, false, 50, 60, false)
  s:send('stop_loop', 's1')
  H.eq(s:events()[2], { 'LOOP_STOPPED', 's1', '1', '2' })
  H.eq({ s.fake.time_selection, s.fake.loop_points }, { { 50, 60 }, { 50, 60 } })
end)

H.test('a second loop re-targets but stop still restores what the narrator had before the first', function()
  local s = scene()
  s.fake.time_selection, s.fake.loop_points, s.fake.repeat_on = { 3, 7 }, { 3, 7 }, 1
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s:send('loop_context', 'l2', ITEM, TAKE, '20', '24')
  H.eq(s.fake.time_selection, { 110, 114 })
  s:send('stop_loop', 's1')
  H.eq(s.fake.time_selection, { 3, 7 })
  H.eq(s.fake.loop_points, { 3, 7 })
  H.eq(s.fake.repeat_on, 1)
end)

H.test('stop_loop keeps whatever the narrator changed themselves while the loop played', function()
  local s = scene()
  s.fake.time_selection, s.fake.loop_points, s.fake.repeat_on = { 3, 7 }, { 3, 7 }, 0
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s.fake.time_selection = { 50, 60 } -- the narrator selected something else
  s.fake.repeat_on = 0 -- and turned repeat off
  s:send('stop_loop', 's1')
  H.eq(s:events()[2], { 'LOOP_STOPPED', 's1', '1', '2' }, 'only the loop points were still ours to put back')
  H.eq(s.fake.time_selection, { 50, 60 })
  H.eq(s.fake.loop_points, { 3, 7 })
  H.eq(s.fake.repeat_on, 0)
end)

H.test('stop_loop with no loop running changes nothing and says so', function()
  local s = scene()
  s.fake.play_state = 1 -- the narrator is playing something of their own
  s.fake.time_selection = { 3, 7 }
  s:send('stop_loop', 's1')
  H.eq(s:events(), { { 'LOOP_STOPPED', 's1', '0', '0' } })
  H.eq(s.fake.play_state, 1, 'playback this bridge did not start is not stopped')
  H.eq(s.fake.time_selection, { 3, 7 })
end)

H.test('stop_loop twice restores once', function()
  local s = scene()
  s.fake.time_selection = { 3, 7 }
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s:send('stop_loop', 's1')
  s.fake.time_selection = { 40, 41 }
  s:send('stop_loop', 's2')
  H.eq(s:events()[3], { 'LOOP_STOPPED', 's2', '0', '0' })
  H.eq(s.fake.time_selection, { 40, 41 })
end)

H.test('stop_loop does not stop a recording the narrator started after the loop, but still restores', function()
  local s = scene()
  s.fake.time_selection = { 3, 7 }
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s.fake.play_state = 5
  s:send('stop_loop', 's1')
  H.eq(s.fake.play_state, 5)
  H.eq(s.fake:transport_calls(), { 'OnPlayButton' })
  H.eq(s.fake.time_selection, { 3, 7 })
end)

H.test('the pre-loop state is restored when the script ends with a loop still running', function()
  local s = scene()
  s.fake.time_selection, s.fake.loop_points, s.fake.repeat_on = { 3, 7 }, { 3, 7 }, 0
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s.fake:exit()
  H.eq(s.fake.time_selection, { 3, 7 })
  H.eq(s.fake.repeat_on, 0)
end)

H.test('ending the script after stop_loop restores nothing again', function()
  local s = scene()
  s.fake.time_selection = { 3, 7 }
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s:send('stop_loop', 's1')
  s.fake.time_selection = { 40, 41 }
  s.fake:exit()
  H.eq(s.fake.time_selection, { 40, 41 })
end)

-- ping ------------------------------------------------------------------------------------------------------------

H.test('ping answers with the navigation version, whether a loop is running and whether REAPER is playing', function()
  local s = scene()
  s:send('ping', 'p1')
  s:send('loop_context', 'l1', ITEM, TAKE, '11', '15')
  s:send('ping', 'p2')
  s.fake.play_state = 0 -- the narrator pressed stop in REAPER: the loop state is still held for stop_loop
  s:send('ping', 'p3')
  local events = s:events()
  H.eq(events[1], { 'PONG', 'p1', '1', '0', '0' })
  H.eq(events[3], { 'PONG', 'p2', '1', '1', '1' })
  H.eq(events[4], { 'PONG', 'p3', '1', '1', '0' })
end)

H.test('ping touches nothing', function()
  local s = scene()
  s:send('ping', 'p1')
  nothing_moved(s, 'ping')
  H.eq(s.fake:transport_calls(), {})
end)
