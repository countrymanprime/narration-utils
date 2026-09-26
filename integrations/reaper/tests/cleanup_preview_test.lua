-- Preview markers and approve-to-apply trims for silence cleanup candidates: preview_cleanup_markers,
-- apply_cleanup_trims (diagnostics-delivery-and-cleanup-tools PRD Phase 10, ADR 0251).

local H = require('harness')

local ITEM = '{AAAAAAAA-0000-4000-8000-000000000001}'
local TAKE = '{AAAAAAAA-0000-4000-8000-0000000000A1}'
local MISSING = '{FFFFFFFF-0000-4000-8000-00000000FFFF}'

-- One track, one item at 100 s (30 s long, source offset 10, rate 1): source seconds 10..40 map to project 100..130.
local function scene()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local track = s.fake:add_track('Narrator')
  local item = s.fake:add_item(track, { guid = ITEM, take_guid = TAKE, position = 100, length = 30, source = 'a.wav', startoffs = 10 })
  return s, track, item
end

local function payload(s, name, rows)
  local path = s:path(name)
  H.write_file(path, table.concat(rows, '\n') .. '\n')
  return path
end

local function row(item_guid, take_guid, class, cut_start, cut_end, finding_id)
  return table.concat({ item_guid, take_guid, class, cut_start, cut_end, finding_id }, '|')
end

-- preview_cleanup_markers -------------------------------------------------------------------------------------------

H.test('preview_cleanup_markers needs the take marker API', function()
  local s = scene()
  s.fake:remove_api('SetTakeMarker')
  s:send('preview_cleanup_markers', 'c1', payload(s, 'p.txt', { row(ITEM, TAKE, 'silence', '12.5', '15.5', 'f-1') }))
  H.eq(s:events(), { { 'ERROR', 'c1', 'This REAPER version cannot add take markers.' } })
end)

H.test('preview_cleanup_markers reports a missing payload', function()
  local s = scene()
  s:send('preview_cleanup_markers', 'c1', s:path('missing.txt'))
  H.eq(s:events(), { { 'ERROR', 'c1', 'The cleanup candidate list was not found.' } })
end)

H.test('preview_cleanup_markers adds a start and end marker for one candidate in one undo step', function()
  local s, _, item = scene()
  s:send('preview_cleanup_markers', 'c1', payload(s, 'p.txt', { row(ITEM, TAKE, 'silence', '12.5', '15.5', 'f-1') }))
  H.eq(s:events(), { { 'CLEANUP_PREVIEWED', 'c1', '2', '0' } })
  local take = item.takes[1]
  H.eq(#take.markers, 2)
  H.eq({ take.markers[1].srcpos, take.markers[1].name }, { 12.5, 'CLEANUP_SILENCE_START: f-1' })
  H.eq({ take.markers[2].srcpos, take.markers[2].name }, { 15.5, 'CLEANUP_SILENCE_END: f-1' })
  H.eq(s.fake:undo_labels(), { 'Narration Utils: preview cleanup markers' })
  H.eq(s.fake.arrange_updates, 1)
end)

H.test('preview_cleanup_markers is idempotent: a repeat call reports existing markers and adds no undo point', function()
  local s = scene()
  local path = payload(s, 'p.txt', { row(ITEM, TAKE, 'silence', '12.5', '15.5', 'f-1') })
  s:send('preview_cleanup_markers', 'c1', path)
  s:events()
  s:send('preview_cleanup_markers', 'c2', path)
  H.eq(s:events(), { { 'CLEANUP_PREVIEWED', 'c2', '0', '2' } })
  H.eq(#s.fake.undo, 1, 'nothing changed the second time, so no second undo point')
end)

H.test('preview_cleanup_markers reports a stale item, take or out-of-range cut and adds no marker for it', function()
  local s, _, item = scene()
  local path = payload(s, 'p.txt', {
    row(MISSING, '', 'silence', '12.5', '15.5', 'f-1'),
    row(ITEM, MISSING, 'silence', '12.5', '15.5', 'f-2'),
    row(ITEM, TAKE, 'silence', '41', '45', 'f-3'),
  })
  s:send('preview_cleanup_markers', 'c1', path)
  H.eq(s:events(), {
    { 'CLEANUP_STALE', 'c1', 'f-1', MISSING, 'item' },
    { 'CLEANUP_STALE', 'c1', 'f-2', MISSING, 'take' },
    { 'CLEANUP_STALE', 'c1', 'f-3', ITEM, 'range' },
    { 'CLEANUP_PREVIEWED', 'c1', '0', '0' },
  })
  H.eq(#item.takes[1].markers, 0)
  H.eq(#s.fake.undo, 0, 'nothing to mark opens no undo block')
end)

H.test('preview_cleanup_markers reports a small overshoot past the item end as stale, not absorbed by rounding tolerance', function()
  local s, _, item = scene()
  -- Source 40.5 is only 0.5 s past the item's end (source 10..40, project 100..130): well outside the tiny rounding
  -- tolerance EDGE_TOLERANCE allows, so this must still be stale.
  local path = payload(s, 'p.txt', { row(ITEM, TAKE, 'silence', '38', '40.5', 'f-1') })
  s:send('preview_cleanup_markers', 'c1', path)
  H.eq(s:events(), { { 'CLEANUP_STALE', 'c1', 'f-1', ITEM, 'range' }, { 'CLEANUP_PREVIEWED', 'c1', '0', '0' } })
  H.eq(#item.takes[1].markers, 0)
end)

H.test('preview_cleanup_markers does nothing while REAPER is recording', function()
  local s, _, item = scene()
  s.fake.play_state = 5
  s:send('preview_cleanup_markers', 'c1', payload(s, 'p.txt', { row(ITEM, TAKE, 'silence', '12.5', '15.5', 'f-1') }))
  H.eq(s:events(), { { 'ERROR', 'c1', 'REAPER is recording. Stop recording first.' } })
  H.eq(#item.takes[1].markers, 0)
end)

-- apply_cleanup_trims ------------------------------------------------------------------------------------------------

H.test('apply_cleanup_trims reports a missing payload', function()
  local s = scene()
  s:send('apply_cleanup_trims', 'c1', s:path('missing.txt'))
  H.eq(s:events(), { { 'ERROR', 'c1', 'The cleanup candidate list was not found.' } })
end)

H.test('apply_cleanup_trims splits the cut out and leaves the two remaining pieces in one undo step', function()
  local s, track, item = scene()
  s:send('apply_cleanup_trims', 'c1', payload(s, 'p.txt', { row(ITEM, TAKE, 'silence', '12.5', '15.5', 'f-1') }))
  H.eq(s:events(), { { 'CLEANUP_APPLIED', 'c1', '1' } })
  H.eq(#track.items, 2, 'the cut middle piece is gone, the two flanking pieces remain')
  H.eq({ item.position, item.length }, { 100, 2.5 }, 'the original item is now only its part before the cut')
  local after = track.items[2]
  H.eq({ after.position, after.length }, { 105.5, 24.5 }, 'the part after the cut is a new item starting where the cut ends')
  H.eq(after.takes[1].source.file, 'a.wav')
  H.eq(s.fake:undo_labels(), { 'Narration Utils: apply cleanup trim' })
  H.eq(s.fake.arrange_updates, 1)
end)

H.test('apply_cleanup_trims applies every candidate on one item in one undo step, in any order it was sent', function()
  local s, track, item = scene()
  -- Two candidates in the same item: a later one and an earlier one, sent earliest-first, so the reader's own
  -- descending sort - not the payload's order - is what keeps the earlier candidate's item GUID valid.
  local path = payload(s, 'p.txt', {
    row(ITEM, TAKE, 'silence', '12.5', '13.5', 'f-1'), -- project 102.5..103.5
    row(ITEM, TAKE, 'breath', '20', '21', 'f-2'), -- project 110..111
  })
  s:send('apply_cleanup_trims', 'c1', path)
  H.eq(s:events(), { { 'CLEANUP_APPLIED', 'c1', '2' } })
  H.eq(#track.items, 3)
  H.eq({ item.position, item.length }, { 100, 2.5 }, 'before the first (earlier) cut')
  H.eq({ track.items[2].position, track.items[2].length }, { 103.5, 6.5 }, 'between the two cuts')
  H.eq({ track.items[3].position, track.items[3].length }, { 111, 19 }, 'after the second (later) cut')
  H.eq(#s.fake.undo, 1, 'approving the whole batch is one undo step')
end)

H.test('apply_cleanup_trims reports a stale candidate and still applies the others in the same call', function()
  local s, track, item = scene()
  local path = payload(s, 'p.txt', {
    row(MISSING, '', 'silence', '12.5', '15.5', 'f-1'),
    row(ITEM, TAKE, 'silence', '12.5', '15.5', 'f-2'),
  })
  s:send('apply_cleanup_trims', 'c1', path)
  H.eq(s:events(), { { 'CLEANUP_STALE', 'c1', 'f-1', MISSING, 'item' }, { 'CLEANUP_APPLIED', 'c1', '1' } })
  H.eq(#track.items, 2)
  H.eq({ item.position, item.length }, { 100, 2.5 })
end)

H.test('apply_cleanup_trims opens no undo block when every candidate is stale', function()
  local s, track = scene()
  s:send('apply_cleanup_trims', 'c1', payload(s, 'p.txt', { row(MISSING, '', 'silence', '12.5', '15.5', 'f-1') }))
  H.eq(s:events(), { { 'CLEANUP_STALE', 'c1', 'f-1', MISSING, 'item' }, { 'CLEANUP_APPLIED', 'c1', '0' } })
  H.eq(#track.items, 1, 'the one item is untouched, byte-for-byte')
  H.eq(#s.fake.undo, 0)
end)

H.test('apply_cleanup_trims does nothing while REAPER is recording', function()
  local s, track = scene()
  s.fake.play_state = 5
  s:send('apply_cleanup_trims', 'c1', payload(s, 'p.txt', { row(ITEM, TAKE, 'silence', '12.5', '15.5', 'f-1') }))
  H.eq(s:events(), { { 'ERROR', 'c1', 'REAPER is recording. Stop recording first.' } })
  H.eq(#track.items, 1)
end)

H.test('declining a candidate by leaving it out of the payload leaves the item exactly as it was', function()
  local s, track, item = scene()
  local other = s.fake:add_item(track, {
    guid = '{BBBBBBBB-0000-4000-8000-000000000002}',
    take_guid = '{BBBBBBBB-0000-4000-8000-0000000000B1}',
    position = 200,
    length = 10,
    source = 'b.wav',
    startoffs = 0,
  })
  s:send('apply_cleanup_trims', 'c1', payload(s, 'p.txt', { row(ITEM, TAKE, 'silence', '12.5', '15.5', 'f-1') }))
  H.eq({ other.position, other.length, other.takes[1].source.file }, { 200, 10, 'b.wav' }, 'the declined item is byte-for-byte unchanged')
end)
