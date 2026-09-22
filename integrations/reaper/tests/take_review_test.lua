-- Take creation: create_take (take-review-pickups-duplicates-take-intelligence.prd.md phase 6, ADR 0098).

local H = require('harness')

local FINDING_ID_KEY = 'narration_utils_take_finding_id'
local SOURCE_FILE_KEY = 'narration_utils_take_source_file'
local SOURCE_RANGE_KEY = 'narration_utils_take_source_range'

local function new_session()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local track = s.fake:add_track('Narrator')
  return s, track
end

-- Row: target_item_guid|candidate_item_guid|source_start|source_end|finding_id|source_file (source_file last, may
-- contain a pipe).
local function payload(s, name, target_guid, candidate_guid, source_start, source_end, finding_id, source_file)
  local path = s:path(name)
  H.write_file(path, table.concat({ target_guid, candidate_guid, source_start, source_end, finding_id, source_file }, '|') .. '\n')
  return path
end

H.test('create_take needs the take extension data API', function()
  local s, track = new_session()
  s.fake:add_item(track, { guid = '{A}', source = 'a.wav' })
  s.fake:remove_api('GetSetMediaItemTakeInfo_String')
  s:send('create_take', 't1', payload(s, 'req.txt', '{A}', '', '0', '3', 'finding-1', 'candidate.wav'))
  H.eq(s:events(), { { 'ERROR', 't1', 'This REAPER version cannot add takes.' } })
end)

H.test('create_take reports a missing request payload', function()
  local s = new_session()
  s:send('create_take', 't1', s:path('missing.txt'))
  H.eq(s:events(), { { 'ERROR', 't1', 'The take-creation request was not found.' } })
end)

H.test('create_take reports a target item GUID that no longer resolves and touches nothing', function()
  local s, track = new_session()
  local other = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}', source = 'a.wav' })
  s:send('create_take', 't1', payload(s, 'req.txt', '{FFFFFFFF-0000-4000-8000-00000000FFFF}', '', '0', '3', 'finding-1', 'candidate.wav'))
  H.eq(s:events(), { { 'TAKE_STALE', 't1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}' } })
  H.eq(#other.takes, 1)
  H.eq(#s.fake.undo, 0)
end)

H.test('create_take reports a stale candidate item GUID and touches nothing', function()
  local s, track = new_session()
  local target = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}', source = 'a.wav' })
  s:send(
    'create_take',
    't1',
    payload(s, 'req.txt', '{AAAAAAAA-0000-4000-8000-000000000001}', '{FFFFFFFF-0000-4000-8000-00000000FFFF}', '0', '3', 'finding-1', 'candidate.wav')
  )
  H.eq(s:events(), { { 'TAKE_STALE', 't1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}' } })
  H.eq(#target.takes, 1)
  H.eq(#s.fake.undo, 0)
end)

H.test('create_take reports a missing candidate source file', function()
  local s, track = new_session()
  s.fake:add_item(track, { guid = '{A}', source = 'a.wav' })
  s:send('create_take', 't1', payload(s, 'req.txt', '{A}', '', '0', '3', 'finding-1', s:path('missing.wav')))
  H.eq(s:events(), { { 'ERROR', 't1', 'The candidate source file was not found.' } })
end)

H.test('create_take adds a take, aligns D_STARTOFFS, writes provenance, and preserves the active take and item length in one undo step', function()
  local s, track = new_session()
  local candidate_path = s:path('candidate.wav')
  H.write_file(candidate_path, 'x')
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}', source = 'a.wav', length = 3 })
  local active_before = reaper.GetActiveTake(item)

  s:send('create_take', 't1', payload(s, 'req.txt', '{AAAAAAAA-0000-4000-8000-000000000001}', '', '1.5', '4.5', 'finding-1', candidate_path))

  local events = s:events()
  H.eq(#events, 1)
  H.eq(events[1][1], 'TAKE_CREATED')
  H.eq(events[1][2], 't1')
  H.eq(events[1][3], '{AAAAAAAA-0000-4000-8000-000000000001}')
  local new_take_guid = events[1][4]
  H.truthy(new_take_guid ~= '', 'the event carries the new take GUID')

  H.eq(#item.takes, 2)
  H.truthy(reaper.GetActiveTake(item) == active_before, 'the previously active take stays active')
  H.eq(item.length, 3, 'item length is never touched')

  local new_take = item.takes[2]
  H.eq(new_take.source.file, candidate_path)
  H.eq(new_take.startoffs, 1.5)
  H.eq(new_take.guid, new_take_guid)
  H.eq(new_take.ext[FINDING_ID_KEY], 'finding-1')
  H.eq(new_take.ext[SOURCE_FILE_KEY], candidate_path)
  H.eq(new_take.ext[SOURCE_RANGE_KEY], '1.500000|4.500000')

  H.eq(s.fake:undo_labels(), { 'Narration Utils: add take' })
  H.eq(s.fake.arrange_updates, 1)
end)

H.test('create_take does not collide with the item-level line identity key on the same item', function()
  local s, track = new_session()
  local candidate_path = s:path('candidate.wav')
  H.write_file(candidate_path, 'x')
  local item = s.fake:add_item(track, { guid = '{A}', source = 'a.wav' })
  item.ext['narration_utils_line_id'] = 'line-000001'

  s:send('create_take', 't1', payload(s, 'req.txt', '{A}', '', '0', '2', 'finding-1', candidate_path))

  H.eq(item.ext['narration_utils_line_id'], 'line-000001')
  H.eq(item.takes[2].ext[FINDING_ID_KEY], 'finding-1')
end)

H.test('create_take with no candidate item GUID given still succeeds (candidate is source-file identified only)', function()
  local s, track = new_session()
  local candidate_path = s:path('candidate.wav')
  H.write_file(candidate_path, 'x')
  s.fake:add_item(track, { guid = '{A}', source = 'a.wav' })
  s:send('create_take', 't1', payload(s, 'req.txt', '{A}', '', '0', '2', 'finding-1', candidate_path))
  H.eq(s:events()[1][1], 'TAKE_CREATED')
end)

H.test('create_take is idempotent across repeated approvals: each call adds its own take rather than erroring', function()
  local s, track = new_session()
  local candidate_path = s:path('candidate.wav')
  H.write_file(candidate_path, 'x')
  local item = s.fake:add_item(track, { guid = '{A}', source = 'a.wav' })
  s:send('create_take', 't1', payload(s, 'req1.txt', '{A}', '', '0', '2', 'finding-1', candidate_path))
  s:events()
  s:send('create_take', 't2', payload(s, 'req2.txt', '{A}', '', '0', '2', 'finding-1', candidate_path))
  H.eq(#item.takes, 3)
  H.eq(#s.fake.undo, 2)
end)
