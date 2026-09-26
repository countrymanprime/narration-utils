-- The live state of REAPER and one track: chapter_track_state (narration_track_state.lua; read-aloud-resume PRD Phase 4,
-- read-aloud-control-bar PRD Phase 6, teleprompter-manuscript-integration PRD Phase 11). Read-only: it reports the
-- transport, the edit counter, which tracks are armed, the named track's record input, REAPER's input device and the
-- track's items, and changes nothing.

local H = require('harness')

local CH1 = '{00000001-0000-4000-8000-000000000001}'

local function new_session(path)
  local s = H.session({ project_path = path == nil and H.join(host.tmpdir(), 'Book.rpp') or path })
  local chapter = s.fake:add_track('Chapter 1')
  local pickups = s.fake:add_track('Pickups')
  return s, chapter, pickups
end

local function tags(events)
  local out = {}
  for _, event in ipairs(events) do
    out[#out + 1] = event[1]
  end
  return out
end

H.test('chapter_track_state needs the transport and track APIs', function()
  for _, name in ipairs({ 'GetPlayPosition', 'CountTracks', 'GetProjectStateChangeCount' }) do
    local s, chapter = new_session()
    s.fake:remove_api(name)
    s:send('chapter_track_state', 't1', chapter.guid)
    H.eq(s:events(), { { 'ERROR', 't1', 'This REAPER version cannot report its transport and tracks.' } }, name)
  end
end)

H.test('chapter_track_state reports the transport, the project, the arms and the named track with no items', function()
  local path = H.join(host.tmpdir(), 'Book.rpp')
  local s, chapter, pickups = new_session(path)
  s.fake.cursor = 2.5
  s.fake.play_position = 1.25
  s.fake.change_count = 7
  chapter.armed = true
  pickups.armed = true
  chapter.rec_input = 1024
  s:send('chapter_track_state', 't1', chapter.guid)
  H.eq(s:events(), {
    { 'TRACK_STATE', 't1', CH1, '0', '2.500000', '1.250000', path, '0', '7', '1', '2', '1024', '' },
    { 'TRACK_STATE_END', 't1', '0', '0' },
  })
end)

H.test('chapter_track_state matches the track GUID without braces or case, and answers it normalised', function()
  local s, chapter = new_session()
  s:send('chapter_track_state', 't1', (chapter.guid:lower():gsub('[{}]', '')))
  H.eq(s:events()[1][3], CH1)
end)

-- The arm counts the Read Aloud bar reads (read-aloud-control-bar PRD Phase 6): nothing armed, and the named track the
-- only one armed (several armed and another track armed are the tests above and below).
H.test('chapter_track_state reports nothing armed, and the named track as the only armed track', function()
  local s, chapter = new_session()
  s:send('chapter_track_state', 't1', chapter.guid)
  local none = s:events()[1]
  H.eq({ none[10], none[11] }, { '0', '0' }, 'nothing armed')
  chapter.armed = true
  s:send('chapter_track_state', 't2', chapter.guid)
  local only = s:events()[1]
  H.eq({ only[2], only[10], only[11] }, { 't2', '1', '1' }, 'the named track the only one armed')
end)

H.test('chapter_track_state reports an unsaved project, the named track not armed and REAPER input device', function()
  local s, chapter, pickups = new_session('')
  pickups.armed = true
  s.fake.audio_input = 'Focusrite USB ASIO'
  s:send('chapter_track_state', 't1', chapter.guid)
  local state = s:events()[1]
  H.eq({ state[7], state[8], state[10], state[11], state[13] }, { '', '1', '0', '1', 'Focusrite USB ASIO' })
end)

H.test('chapter_track_state reports the play state bits and the play position while recording', function()
  local s, chapter = new_session()
  s.fake.play_state = 5
  s.fake.play_position = 12.345678
  s:send('chapter_track_state', 't1', chapter.guid)
  local state = s:events()[1]
  H.eq({ state[4], state[6] }, { '5', '12.345678' })
end)

H.test('chapter_track_state lists every item on the named track with its active take, and no other track', function()
  local s, chapter, pickups = new_session()
  local first = s.fake:add_item(chapter, { position = 0, length = 4, source = 'C:\\Audio\\ch1|take 1.wav', guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  local trimmed = s.fake:add_item(
    chapter,
    { position = 10, length = 3, source = 'ch1-b.wav', startoffs = 1.5, playrate = 1.25, guid = '{AAAAAAAA-0000-4000-8000-000000000002}' }
  )
  s.fake:add_item(pickups, { position = 1, length = 1, source = 'pickup.wav' })
  s:send('chapter_track_state', 't1', chapter.guid)
  H.eq(s:events(), {
    { 'TRACK_STATE', 't1', CH1, '0', '0.000000', '0.000000', s.fake.project_path, '0', '0', '0', '0', '0', '' },
    { 'TRACK_ITEM', 't1', first.guid, first.takes[1].guid, '0.000000', '4.000000', '0.000000', '1.000000', 'C:\\Audio\\ch1|take 1.wav' },
    { 'TRACK_ITEM', 't1', trimmed.guid, trimmed.takes[1].guid, '10.000000', '3.000000', '1.500000', '1.250000', 'ch1-b.wav' },
    { 'TRACK_STATE_END', 't1', '2', '2' },
  })
end)

H.test('chapter_track_state reports the take that is active, not the first one', function()
  local s, chapter = new_session()
  local item = s.fake:add_item(chapter, { position = 0, length = 2, source = 'one.wav' })
  local second = s.fake.reaper.AddTakeToMediaItem(item)
  second.source = { file = 'two.wav' }
  item.active_index = 2
  s:send('chapter_track_state', 't1', chapter.guid)
  local row = s:events()[2]
  H.eq({ row[4], row[9] }, { second.guid, 'two.wav' })
end)

H.test('chapter_track_state reports an item without a take with an empty take and source', function()
  local s, chapter = new_session()
  local item = s.fake:add_item(chapter, { position = 3, length = 1 })
  s:send('chapter_track_state', 't1', chapter.guid)
  H.eq(s:events()[2], { 'TRACK_ITEM', 't1', item.guid, '', '3.000000', '1.000000', '0.000000', '1.000000', '' })
end)

H.test('chapter_track_state stops listing items at its limit and says how many there were', function()
  local s, chapter = new_session()
  for index = 1, 1003 do
    s.fake:add_item(chapter, { position = index, length = 0.5, source = 'x.wav' })
  end
  s:send('chapter_track_state', 't1', chapter.guid)
  local events = s:events()
  H.eq(#events, 1 + 1000 + 1)
  H.eq(events[#events], { 'TRACK_STATE_END', 't1', '1000', '1003' })
end)

H.test('chapter_track_state with no track answers the transport and the arms, and lists nothing', function()
  local s, chapter = new_session()
  chapter.armed = true
  s.fake:add_item(chapter, { position = 0, length = 1, source = 'a.wav' })
  s:send('chapter_track_state', 't1', '')
  H.eq(s:events(), {
    { 'TRACK_STATE', 't1', '', '0', '0.000000', '0.000000', s.fake.project_path, '0', '0', '0', '1', '', '' },
    { 'TRACK_STATE_END', 't1', '0', '0' },
  })
end)

H.test('chapter_track_state reports a track GUID that no longer resolves and never answers for another track', function()
  local s, chapter = new_session()
  chapter.armed = true
  s.fake:add_item(chapter, { position = 0, length = 1, source = 'a.wav' })
  s:send('chapter_track_state', 't1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}')
  H.eq(s:events(), { { 'TRACK_STALE', 't1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}' } })
end)

H.test('chapter_track_state changes nothing: no undo point, no selection, cursor or transport call', function()
  local s, chapter = new_session()
  local item = s.fake:add_item(chapter, { position = 0, length = 1, source = 'a.wav' })
  s.fake.cursor = 4
  s:send('chapter_track_state', 't1', chapter.guid)
  H.eq(tags(s:events()), { 'TRACK_STATE', 'TRACK_ITEM', 'TRACK_STATE_END' })
  H.eq(#s.fake.undo, 0)
  H.eq(s.fake.cursor, 4)
  H.eq(item.selected, false)
  H.eq(chapter.armed or false, false)
  for _, call in ipairs(s.fake.calls) do
    H.truthy(call.name ~= 'SetMediaTrackInfo_Value' and call.name ~= 'OnPlayButton' and call.name ~= 'OnStopButton', call.name .. ' was called')
  end
end)

H.test('chapter_track_state answers an empty input device when REAPER cannot say which one is open', function()
  local s, chapter = new_session()
  s.fake.audio_input = 'Some device'
  s.fake:remove_api('GetAudioDeviceInfo')
  s:send('chapter_track_state', 't1', chapter.guid)
  H.eq(s:events()[1][13], '')
end)
