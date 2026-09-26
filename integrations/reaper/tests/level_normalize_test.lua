-- Applying a per-item gain change to match a narrator-set loudness target: apply_item_gain
-- (diagnostics-delivery-and-cleanup-tools PRD Phase 11's level-normalize half, ADR 0252).

local H = require('harness')

local ITEM = '{AAAAAAAA-0000-4000-8000-000000000001}'
local MISSING = '{FFFFFFFF-0000-4000-8000-00000000FFFF}'

local function scene()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local track = s.fake:add_track('Narrator')
  local item = s.fake:add_item(track, { guid = ITEM, source = 'a.wav' })
  return s, track, item
end

local function payload(s, name, rows)
  local path = s:path(name)
  H.write_file(path, table.concat(rows, '\n') .. '\n')
  return path
end

local function row(item_guid, delta_db, finding_id)
  return table.concat({ item_guid, delta_db, finding_id }, '|')
end

H.test('apply_item_gain reports a missing payload', function()
  local s = scene()
  s:send('apply_item_gain', 'g1', s:path('missing.txt'))
  H.eq(s:events(), { { 'ERROR', 'g1', 'The level-match candidate list was not found.' } })
end)

H.test('apply_item_gain raises the item volume by the given dB in one undo step', function()
  local s, track, item = scene()
  -- +6.0206 dB is a linear factor of 2 (20*log10(2)); the fake starts every item at D_VOL 1 (0 dB).
  s:send('apply_item_gain', 'g1', payload(s, 'p.txt', { row(ITEM, '6.0206', 'f-1') }))
  H.eq(s:events(), { { 'GAIN_ITEM', 'g1', ITEM, '1.000000', '2.000000' }, { 'GAIN_APPLIED', 'g1', '1' } })
  H.truthy(math.abs(item.vol - 2) < 0.0001, 'the item volume doubled')
  H.eq(s.fake:undo_labels(), { 'Narration Utils: apply level-match gain' })
  H.eq(s.fake.arrange_updates, 1)
  H.truthy(track.items[1] == item, 'the item was changed in place, not replaced')
end)

H.test('apply_item_gain lowers the volume for a negative dB and compounds onto an existing gain', function()
  local s, _, item = scene()
  item.vol = 2 -- the narrator (or an earlier apply) already doubled it
  s:send('apply_item_gain', 'g1', payload(s, 'p.txt', { row(ITEM, '-6.0206', 'f-1') }))
  H.truthy(math.abs(item.vol - 1) < 0.0001, 'halving the existing 2x gain returns to 1 (0 dB), on top of it, not from scratch')
end)

H.test('apply_item_gain reports a stale item and never falls back to a neighbour', function()
  local s, track = scene()
  s:send('apply_item_gain', 'g1', payload(s, 'p.txt', { row(MISSING, '3', 'f-1') }))
  H.eq(s:events(), { { 'GAIN_STALE', 'g1', 'f-1', MISSING, 'item' }, { 'GAIN_APPLIED', 'g1', '0' } })
  H.eq(track.items[1].vol, nil, 'the one real item is untouched')
end)

H.test('apply_item_gain opens no undo block when every item is stale', function()
  local s = scene()
  s:send('apply_item_gain', 'g1', payload(s, 'p.txt', { row(MISSING, '3', 'f-1') }))
  H.eq(#s.fake.undo, 0)
end)

H.test('apply_item_gain reports a stale item and still applies the others in the same call', function()
  local s, track, item = scene()
  local other = s.fake:add_item(track, { guid = '{BBBBBBBB-0000-4000-8000-000000000002}', source = 'b.wav' })
  s:send(
    'apply_item_gain',
    'g1',
    payload(s, 'p.txt', {
      row(MISSING, '3', 'f-1'),
      row(ITEM, '6.0206', 'f-2'),
    })
  )
  H.eq(s:events(), {
    { 'GAIN_STALE', 'g1', 'f-1', MISSING, 'item' },
    { 'GAIN_ITEM', 'g1', ITEM, '1.000000', '2.000000' },
    { 'GAIN_APPLIED', 'g1', '1' },
  })
  H.truthy(math.abs(item.vol - 2) < 0.0001)
  H.eq(other.vol, nil, 'a candidate not named in this call is untouched')
end)

H.test('apply_item_gain does nothing while REAPER is recording', function()
  local s, _, item = scene()
  s.fake.play_state = 5
  s:send('apply_item_gain', 'g1', payload(s, 'p.txt', { row(ITEM, '6', 'f-1') }))
  H.eq(s:events(), { { 'ERROR', 'g1', 'REAPER is recording. Stop recording first.' } })
  H.eq(item.vol, nil)
end)

H.test('apply_item_gain with an unusable delta drops the row rather than guessing at zero', function()
  local s, _, item = scene()
  s:send('apply_item_gain', 'g1', payload(s, 'p.txt', { row(ITEM, 'soon', 'f-1') }))
  H.eq(s:events(), { { 'GAIN_APPLIED', 'g1', '0' } })
  H.eq(item.vol, nil)
end)
