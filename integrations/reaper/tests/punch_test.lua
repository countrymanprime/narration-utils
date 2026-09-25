-- Punch and roll over the bridge (teleprompter-manuscript-integration PRD Phase 12): play_position, the read-only
-- position the host polls during a live reading to anchor words in project time, and punch_to, which moves only the
-- edit cursor to a word's time minus the pre-roll (see narration_punch.lua).

local H = require('harness')

local function new_session()
  return H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
end

-- play_position -------------------------------------------------------------------------------------------------

H.test('play_position needs GetPlayPosition2', function()
  local s = new_session()
  s.fake:remove_api('GetPlayPosition2')
  s:send('play_position', 'p1')
  H.eq(s:events(), { { 'ERROR', 'p1', 'This REAPER version cannot report the play position.' } })
end)

H.test('play_position reports the play state, both play positions and the edit cursor', function()
  local s = new_session()
  s.fake.play_state = 5
  s.fake.play_position, s.fake.play_position2, s.fake.cursor = 12.5, 12.375, 3
  s:send('play_position', 'p1')
  H.eq(s:events(), { { 'PLAY_POSITION', 'p1', '5', '12.500000', '12.375000', '3.000000' } })
end)

H.test('play_position changes nothing: no undo block, no cursor move', function()
  local s = new_session()
  s.fake.cursor = 7
  s:send('play_position', 'p1')
  H.eq(#s.fake.undo, 0)
  H.eq(s.fake.open_undo_blocks, 0)
  H.eq(s.fake.cursor, 7)
end)

-- punch_to ------------------------------------------------------------------------------------------------------

H.test('punch_to moves the edit cursor to the word time minus the pre-roll and scrolls the view to it', function()
  local s = new_session()
  s:send('punch_to', 'u1', '42.5', '3')
  H.eq(s:events(), { { 'PUNCHED', 'u1', '39.500000' } })
  H.eq(s.fake.cursor, 39.5)
  H.eq(s.fake.cursor_moveview, true)
  H.eq(s.fake.cursor_seekplay, false, 'the cursor moves; playback is never started or moved')
end)

H.test('punch_to never goes before the project start', function()
  local s = new_session()
  s:send('punch_to', 'u1', '1.25', '3')
  H.eq(s:events()[1], { 'PUNCHED', 'u1', '0.000000' })
  H.eq(s.fake.cursor, 0)
end)

H.test('punch_to is a cursor move only: no undo block, nothing else changed', function()
  local s = new_session()
  local track = s.fake:add_track('Chapter 1')
  s.fake:add_item(track, { position = 0, length = 60 })
  s:send('punch_to', 'u1', '10', '2')
  H.eq(#s.fake.undo, 0)
  H.eq(s.fake.open_undo_blocks, 0)
  H.eq(s.fake.play_state, 0)
end)

H.test('punch_to refuses while REAPER records, and moves nothing', function()
  local s = new_session()
  s.fake.play_state, s.fake.cursor = 5, 8
  s:send('punch_to', 'u1', '42', '3')
  H.eq(s:events(), { { 'ERROR', 'u1', 'REAPER is recording. Stop it before moving to a word.' } })
  H.eq(s.fake.cursor, 8)
end)

H.test('punch_to refuses a time or pre-roll it cannot read, and moves nothing', function()
  for _, args in ipairs({ { 'x', '3' }, { '-1', '3' }, { '10', '-1' }, { '10', '11' }, { 'nan', '3' }, { '10', '' } }) do
    local s = new_session()
    s.fake.cursor = 8
    s:send('punch_to', 'u1', args[1], args[2])
    H.eq(s:events(), { { 'ERROR', 'u1', 'The word time or pre-roll is not a usable number of seconds.' } }, args[1] .. ' ' .. args[2])
    H.eq(s.fake.cursor, 8)
  end
end)
