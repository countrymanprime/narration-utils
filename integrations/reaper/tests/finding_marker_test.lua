-- Adding one approved marker for a finding: add_finding_marker (review-dashboard PRD Phase 8, Q8;
-- docs/architecture/reaper-navigation.md). The one command in narration_navigation.lua that changes the project: it
-- adds one take marker inside one undo block, skips a marker the take already has (the 0.15 s, same-prefix rule the
-- Transcript Compare export uses), and like Go to never falls back to a neighbouring item.

local H = require('harness')

local ITEM = '{AAAAAAAA-0000-4000-8000-000000000001}'
local TAKE = '{AAAAAAAA-0000-4000-8000-0000000000A1}'
local OTHER = '{BBBBBBBB-0000-4000-8000-000000000002}'
local MISSING = '{FFFFFFFF-0000-4000-8000-00000000FFFF}'
local NAME = "MISREAD: 'pink eyes' as 'pink ice'"
local UNDO_LABEL = 'Narration Utils: add approved marker'

-- One track, the finding's item at 100 s (30 s long, source offset 10, rate 1) and a neighbour right after it.
local function scene()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local track = s.fake:add_track('Narrator')
  local item = s.fake:add_item(track, { guid = ITEM, take_guid = TAKE, position = 100, length = 30, source = 'a.wav', startoffs = 10 })
  local neighbour = s.fake:add_item(track, { guid = OTHER, position = 130, length = 30, source = 'b.wav' })
  return s, item, neighbour
end

local function unchanged(s, item, neighbour, label)
  H.eq(#item.takes[1].markers, 0, label .. ': no marker on the finding take')
  H.eq(#neighbour.takes[1].markers, 0, label .. ': no marker on the neighbour')
  H.eq(#s.fake.undo, 0, label .. ': no undo point')
  H.eq(s.fake.open_undo_blocks, 0, label .. ': no undo block left open')
end

H.test('add_finding_marker adds one coloured take marker at the source time, in one undo block, and says so', function()
  local s, item = scene()
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '12.5', 'FF4040', NAME)
  H.eq(s:events(), { { 'FINDING_MARKER', 'm1', 'added', TAKE, '12.500000', NAME } })
  local markers = item.takes[1].markers
  H.eq(#markers, 1)
  H.eq({ markers[1].name, markers[1].srcpos }, { NAME, 12.5 }, 'a take marker is at a source time, so it follows the item')
  H.eq(markers[1].color, reaper.ColorToNative(255, 64, 64) + 0x1000000)
  H.eq(s.fake:undo_labels(), { UNDO_LABEL }, 'one undo point: one Undo in REAPER takes it away')
  H.eq(s.fake.open_undo_blocks, 0)
end)

H.test('add_finding_marker with no colour uses REAPER default marker colour', function()
  local s, item = scene()
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '12.5', '', NAME)
  H.eq(item.takes[1].markers[1].color, 0)
end)

H.test('add_finding_marker puts the marker on the take the finding names, not the active one', function()
  local s, item = scene()
  local named = {
    item = item,
    source = { file = 'b.wav' },
    startoffs = 10,
    playrate = 1,
    midi = false,
    name = '',
    markers = {},
    ext = {},
    guid = '{CCCCCCCC-0000-4000-8000-0000000000A2}',
  }
  item.takes[2] = named
  s:send('add_finding_marker', 'm1', ITEM, named.guid, '12.5', '', NAME)
  H.eq(s:events()[1][4], named.guid)
  H.eq({ #item.takes[1].markers, #named.markers }, { 0, 1 })
end)

H.test('add_finding_marker without a take GUID marks the active take', function()
  local s, item = scene()
  s:send('add_finding_marker', 'm1', ITEM, '', '12.5', '', NAME)
  H.eq(s:events()[1], { 'FINDING_MARKER', 'm1', 'added', TAKE, '12.500000', NAME })
  H.eq(#item.takes[1].markers, 1)
end)

H.test('add_finding_marker skips a marker of the same kind already within 0.15 s, and changes nothing', function()
  local s, item, neighbour = scene()
  item.takes[1].markers[1] = { name = 'misread: exported earlier', srcpos = 12.4, color = 0 }
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '12.5', 'FF4040', NAME)
  H.eq(s:events(), { { 'FINDING_MARKER', 'm1', 'existing', TAKE, '12.500000', 'misread: exported earlier' } })
  H.eq(#item.takes[1].markers, 1)
  H.eq(#neighbour.takes[1].markers, 0)
  H.eq(#s.fake.undo, 0, 'skipping is not an edit: no undo point')
end)

H.test('add_finding_marker adds beside a marker of another kind or one further than 0.15 s away', function()
  local s, item = scene()
  item.takes[1].markers[1] = { name = 'EXTRA: wrong kind', srcpos = 12.5, color = 0 }
  item.takes[1].markers[2] = { name = 'MISREAD: too far', srcpos = 12.66, color = 0 }
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '12.5', '', NAME)
  H.eq(s:events()[1][3], 'added')
  H.eq(#item.takes[1].markers, 3)
end)

H.test('add_finding_marker sent twice adds one marker: the second answers existing', function()
  local s, item = scene()
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '12.5', '', NAME)
  s:send('add_finding_marker', 'm2', ITEM, TAKE, '12.5', '', NAME)
  H.eq(s:events()[2], { 'FINDING_MARKER', 'm2', 'existing', TAKE, '12.500000', NAME })
  H.eq(#item.takes[1].markers, 1)
  H.eq(s.fake:undo_labels(), { UNDO_LABEL })
end)

H.test('add_finding_marker reports a stale item, take or spot and never marks a neighbour', function()
  local s, item, neighbour = scene()
  s:send('add_finding_marker', 'm1', MISSING, '', '12.5', '', NAME)
  s:send('add_finding_marker', 'm2', '', '', '12.5', '', NAME)
  s:send('add_finding_marker', 'm3', ITEM, MISSING, '12.5', '', NAME)
  s:send('add_finding_marker', 'm4', ITEM, TAKE, '45', '', NAME) -- 100 + (45 - 10) = 135 s: past the item's end
  H.eq(s:events(), {
    { 'FINDING_STALE', 'm1', MISSING, 'item' },
    { 'FINDING_STALE', 'm2', '', 'item' },
    { 'FINDING_STALE', 'm3', MISSING, 'take' },
    { 'FINDING_STALE', 'm4', ITEM, 'range' },
  })
  unchanged(s, item, neighbour, 'stale')
end)

H.test('add_finding_marker reports an item with no take as stale', function()
  local s = scene()
  local empty = s.fake:add_item(s.fake.tracks[1], { guid = '{DDDDDDDD-0000-4000-8000-000000000004}', position = 200, length = 5 })
  s:send('add_finding_marker', 'm1', empty.guid, '', '1', '', NAME)
  H.eq(s:events(), { { 'FINDING_STALE', 'm1', empty.guid, 'take' } })
  H.eq(#s.fake.undo, 0)
end)

H.test('add_finding_marker does nothing while REAPER is recording', function()
  local s, item, neighbour = scene()
  s.fake.play_state = 5
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '12.5', '', NAME)
  H.eq(s:events(), { { 'ERROR', 'm1', 'REAPER is recording. Stop recording first.' } })
  unchanged(s, item, neighbour, 'recording')
end)

H.test('add_finding_marker refuses a missing time or name', function()
  local s, item, neighbour = scene()
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '', '', NAME)
  s:send('add_finding_marker', 'm2', ITEM, TAKE, 'soon', '', NAME)
  s:send('add_finding_marker', 'm3', ITEM, TAKE, '12.5', '', '   ')
  H.eq(s:events(), {
    { 'ERROR', 'm1', 'The finding has no usable time.' },
    { 'ERROR', 'm2', 'The finding has no usable time.' },
    { 'ERROR', 'm3', 'The marker has no name.' },
  })
  unchanged(s, item, neighbour, 'bad request')
end)

H.test('add_finding_marker needs the take marker API', function()
  local s, item, neighbour = scene()
  s.fake:remove_api('SetTakeMarker')
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '12.5', '', NAME)
  H.eq(s:events(), { { 'ERROR', 'm1', 'This REAPER version cannot add take markers.' } })
  unchanged(s, item, neighbour, 'old REAPER')
end)

H.test('add_finding_marker moves nothing: no selection, cursor, time selection or playback', function()
  local s, item = scene()
  s:send('add_finding_marker', 'm1', ITEM, TAKE, '12.5', '', NAME)
  H.eq(item.selected, false)
  H.eq(s.fake.cursor, 0)
  H.eq(s.fake.time_selection, { 0, 0 })
  H.eq(s.fake:transport_calls(), {})
end)
