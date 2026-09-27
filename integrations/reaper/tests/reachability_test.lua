-- The PROJECT_STATUS reachability heartbeat narration_ui_bridge.lua's tick loop appends (Phase 7,
-- docs/prds/project-workspace-and-daw-link.prd.md, ADR 0092/W10): the mechanism spike S6
-- (docs/research/reaper-spike-s6-daw-reachability.md) proved, wired into the same command loop compare_test.lua
-- and launcher_test.lua already exercise. Uses Session:all_events() (not :events(), which filters this tag out
-- for every other test file's sake - see harness.lua).

local H = require('harness')

local function only_event(s)
  local events = s:all_events()
  H.eq(#events, 1, 'expected exactly one event')
  return events[1]
end

H.test('the first tick sends a heartbeat naming the saved project, unsaved flag 0', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s:tick()
  H.eq(only_event(s), { 'PROJECT_STATUS', '', 'C:\\Projects\\Book\\Book.rpp', '0', '0', '0', '0.000000' })
end)

H.test('an unsaved project heartbeats with an empty path and unsaved flag 1', function()
  local s = H.session({ project_path = '' })
  s:tick()
  H.eq(only_event(s), { 'PROJECT_STATUS', '', '', '1', '0', '0', '0.000000' })
end)

H.test('the heartbeat run field is always empty, the broadcast shape events.go delivers to every subscriber', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s:tick()
  local event = only_event(s)
  H.eq(event[2], '', 'the run field (Fields[1] in Go) must be empty for a broadcast heartbeat')
end)

H.test('the heartbeat is throttled: it does not fire on every single tick', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  -- The fake clock (fake_reaper.lua) advances by exactly 1 unit per reaper.time_precise() call, and the bridge
  -- calls it once per tick inside heartbeat(): with HEARTBEAT_INTERVAL_SECONDS at 1.5, the pattern is
  -- fire / skip / fire / skip / fire ... (elapsed 0, 1, 2, 3, ... crossing 1.5 every other tick).
  s:tick() -- tick 1: fires (no previous heartbeat)
  s:tick() -- tick 2: elapsed 1 < 1.5, skipped
  local after_two = s:all_events()
  H.eq(#after_two, 1, 'the second tick must not send a second heartbeat one unit later')

  s:tick() -- tick 3: elapsed 2 >= 1.5, fires again
  local after_three = s:all_events()
  H.eq(#after_three, 1, 'the third tick fires the next heartbeat')
end)

H.test('a command in the same tick as a heartbeat still gets its own reply, and the heartbeat still appends', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s:send('close')
  local events = s:all_events()
  H.eq(#events, 1, 'close has no event of its own; only the heartbeat from this tick')
  H.eq(events[1][1], 'PROJECT_STATUS')
end)

H.test('events() filters the heartbeat out so every other test file sees only its own events', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s:tick()
  H.eq(s:events(), {}, 'the plain events() reader must not surface the heartbeat')
end)

H.test('the heartbeat carries the REAPER edit counter as its fourth field, and it follows the project', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s.fake.change_count = 41
  s:tick()
  H.eq(only_event(s)[5], '41')
  s.fake.change_count = 42
  s:tick() -- throttled: no heartbeat
  s:tick()
  H.eq(only_event(s)[5], '42')
end)

H.test('the heartbeat sends an empty edit counter on a REAPER without the call, and still sends the rest', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s.fake:remove_api('GetProjectStateChangeCount')
  s:tick()
  H.eq(only_event(s), { 'PROJECT_STATUS', '', 'C:\\Projects\\Book\\Book.rpp', '0', '', '0', '0.000000' })
end)

-- DAW port PRD Phase 9 (ADR 0305): the heartbeat also carries the transport, so the host knows REAPER is playing or recording
-- without asking (the Heartbeat role reads; ReadAloudReaperState.recording was a click-refreshed read, ADR 0249).

H.test('the heartbeat carries GetPlayState and the play position as its fifth and sixth fields', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s.fake.play_state = 5
  s.fake.play_position = 12.5
  s:tick()
  local event = only_event(s)
  H.eq(event[6], '5', "playState is GetPlayState's bit field: 1 playing, 2 paused, 4 recording")
  H.eq(event[7], '12.500000', 'playPosition is GetPlayPosition, in seconds')
end)

H.test('a transport change sends a heartbeat at once, without waiting out the interval', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s:tick() -- fires (first heartbeat)
  s:all_events()
  s.fake.play_state = 5
  s:tick() -- elapsed 1 < 1.5, but the transport changed
  local events = s:all_events()
  H.eq(#events, 1, 'a record start must not wait for the next interval')
  H.eq(events[1][6], '5')
  s:tick() -- elapsed 1 since the last one, nothing changed: throttled again
  H.eq(#s:all_events(), 0, 'an unchanged transport is still throttled')
  s.fake.play_state = 0
  s:tick()
  local stopped = s:all_events()
  H.eq(#stopped, 1, 'a stop is sent at once too')
  H.eq(stopped[1][6], '0')
end)

H.test('a moving play position alone does not break the throttle', function()
  local s = H.session({ project_path = 'C:\\Projects\\Book\\Book.rpp' })
  s.fake.play_state = 1
  s:tick()
  s:all_events()
  s.fake.play_position = 3
  s:tick() -- elapsed 1 < 1.5, the state is unchanged
  H.eq(#s:all_events(), 0, 'only a change of state, not the moving position, sends early')
end)
