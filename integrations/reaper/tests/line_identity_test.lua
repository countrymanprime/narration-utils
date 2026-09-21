-- Manuscript line identity: stamping item extension data by GUID, reading it back, and creating chapter regions.

local H = require('harness')

local ID_KEY = 'narration_utils_line_id'
local TEXT_KEY = 'narration_utils_line_text'

local function new_session()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local track = s.fake:add_track('Narrator')
  return s, track
end

local function payload(s, name, lines)
  local path = s:path(name)
  H.write_file(path, table.concat(lines, '\n') .. '\n')
  return path
end

-- stamp_item_lines ---------------------------------------------------------------------------------------------------

H.test('stamp_item_lines needs the item extension data API', function()
  local s = new_session()
  s.fake:remove_api('GetSetMediaItemInfo_String')
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{A}|line-1|First.' }), '0')
  H.eq(s:events(), { { 'ERROR', 'This REAPER version cannot store item extension data.' } })
end)

H.test('stamp_item_lines reports a missing payload', function()
  local s = new_session()
  s:send('stamp_item_lines', 't1', s:path('missing.txt'), '0')
  H.eq(s:events(), { { 'ERROR', 'The manuscript line list was not found.' } })
end)

H.test('stamp_item_lines stamps an item found by GUID in one undo step', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{AAAAAAAA-0000-4000-8000-000000000001}|line-000001|First line.' }), '0')
  H.eq(s:events(), { { 'LINES_STAMPED', 't1', '1', '0', '0', '0' } })
  H.eq(item.ext, { [ID_KEY] = 'line-000001', [TEXT_KEY] = 'First line.' })
  H.eq(s.fake:undo_labels(), { 'Narration Utils: stamp manuscript line IDs' })
  H.eq(s.fake.arrange_updates, 1)
end)

H.test('stamp_item_lines matches GUIDs without braces or in lower case', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{ABCDEF01-0000-4000-8000-000000000001}' })
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { 'abcdef01-0000-4000-8000-000000000001|line-1|Text' }), '0')
  H.eq(s:events()[1], { 'LINES_STAMPED', 't1', '1', '0', '0', '0' })
  H.eq(item.ext[ID_KEY], 'line-1')
end)

H.test('stamp_item_lines is idempotent: the same payload changes nothing and creates no undo point', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  local path = payload(s, 'p.txt', { '{AAAAAAAA-0000-4000-8000-000000000001}|line-1|Text' })
  s:send('stamp_item_lines', 't1', path, '0')
  s:events()
  s:send('stamp_item_lines', 't2', path, '0')
  H.eq(s:events(), { { 'LINES_STAMPED', 't2', '0', '1', '0', '0' } })
  H.eq(#s.fake.undo, 1)
  H.eq(item.ext[ID_KEY], 'line-1')
end)

H.test('stamp_item_lines reports a different existing ID as a conflict and keeps it', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  item.ext[ID_KEY], item.ext[TEXT_KEY] = 'line-1', 'Old text'
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{AAAAAAAA-0000-4000-8000-000000000001}|line-2|New text' }), '0')
  H.eq(s:events(), { { 'LINES_CONFLICT', 't1', '{AAAAAAAA-0000-4000-8000-000000000001}' }, { 'LINES_STAMPED', 't1', '0', '0', '0', '1' } })
  H.eq(item.ext, { [ID_KEY] = 'line-1', [TEXT_KEY] = 'Old text' })
  H.eq(#s.fake.undo, 0)
end)

H.test('stamp_item_lines overwrites a conflict only when asked to', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  item.ext[ID_KEY], item.ext[TEXT_KEY] = 'line-1', 'Old text'
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{AAAAAAAA-0000-4000-8000-000000000001}|line-2|New text' }), '1')
  H.eq(s:events(), { { 'LINES_STAMPED', 't1', '1', '0', '0', '0' } })
  H.eq(item.ext, { [ID_KEY] = 'line-2', [TEXT_KEY] = 'New text' })
end)

H.test('stamp_item_lines updates the text of the same line ID without calling it a conflict', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  item.ext[ID_KEY], item.ext[TEXT_KEY] = 'line-1', 'Old text'
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{AAAAAAAA-0000-4000-8000-000000000001}|line-1|Edited text' }), '0')
  H.eq(s:events(), { { 'LINES_STAMPED', 't1', '1', '0', '0', '0' } })
  H.eq(item.ext[TEXT_KEY], 'Edited text')
end)

H.test('stamp_item_lines reports a GUID that no longer resolves and never touches a neighbour', function()
  local s, track = new_session()
  local near = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}', position = 10 })
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{FFFFFFFF-0000-4000-8000-00000000FFFF}|line-1|Text' }), '0')
  H.eq(s:events(), { { 'LINES_STALE', 't1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}' }, { 'LINES_STAMPED', 't1', '0', '0', '1', '0' } })
  H.eq(near.ext, {})
  H.eq(#s.fake.undo, 0)
end)

H.test('stamp_item_lines handles a mix in one payload and applies only what is safe', function()
  local s, track = new_session()
  local fresh = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  local same = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000002}' })
  local clash = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000003}' })
  same.ext[ID_KEY], same.ext[TEXT_KEY] = 'line-2', 'Two'
  clash.ext[ID_KEY], clash.ext[TEXT_KEY] = 'line-9', 'Nine'
  local path = payload(s, 'p.txt', {
    '{AAAAAAAA-0000-4000-8000-000000000001}|line-1|One',
    '{AAAAAAAA-0000-4000-8000-000000000002}|line-2|Two',
    '{AAAAAAAA-0000-4000-8000-000000000003}|line-3|Three',
    '{99999999-0000-4000-8000-000000000009}|line-4|Four',
  })
  s:send('stamp_item_lines', 't1', path, '0')
  local events = s:events()
  H.eq(events[#events], { 'LINES_STAMPED', 't1', '1', '1', '1', '1' })
  H.eq(fresh.ext[ID_KEY], 'line-1')
  H.eq(clash.ext[ID_KEY], 'line-9')
end)

H.test('stamp_item_lines keeps a pipe in the text and flattens line breaks', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{AAAAAAAA-0000-4000-8000-000000000001}|line-1|Either | or' }), '0')
  H.eq(item.ext[TEXT_KEY], 'Either | or')
end)

H.test('stamp_item_lines ignores rows with no GUID or no line ID and blank lines', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '', '|line-1|no guid', '{AAAAAAAA-0000-4000-8000-000000000001}||no id', 'garbage' }), '0')
  H.eq(s:events(), { { 'LINES_STAMPED', 't1', '0', '0', '0', '0' } })
  H.eq(item.ext, {})
end)

H.test('stamp_item_lines and create_chapter_regions read a payload with Windows line endings', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}' })
  local stamps = s:path('crlf-stamps.txt')
  H.write_file(stamps, '{AAAAAAAA-0000-4000-8000-000000000001}|line-1|Text\r\n')
  s:send('stamp_item_lines', 't1', stamps, '0')
  H.eq(item.ext[TEXT_KEY], 'Text')
  local regions = s:path('crlf-regions.txt')
  H.write_file(regions, '0|30|Chapter 1\r\n')
  s:send('create_chapter_regions', 't2', regions, '')
  H.eq(s.fake.markers[1].name, 'Chapter 1')
end)

H.test('stamp_item_lines writes item notes and take names nowhere', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}', notes = 'narrator note', source = 'a.wav', take_name = 'take one' })
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{AAAAAAAA-0000-4000-8000-000000000001}|line-1|Text' }), '0')
  H.eq(item.notes, 'narrator note')
  H.eq(item.takes[1].name, 'take one')
end)

H.test('stamp_item_lines lists at most fifty unresolved GUIDs but counts them all', function()
  local s = new_session()
  local lines = {}
  for index = 1, 60 do
    lines[#lines + 1] = string.format('{00000000-0000-4000-8000-%012X}|line-%d|Text', index, index)
  end
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', lines), '0')
  local events = s:events()
  H.eq(#events, 51)
  H.eq(events[51], { 'LINES_STAMPED', 't1', '0', '0', '60', '0' })
end)

-- read_line_ids ---------------------------------------------------------------------------------------------------

H.test('read_line_ids lists only stamped items with position, length and text, and touches nothing', function()
  local s, track = new_session()
  local stamped = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}', position = 12.5, length = 3 })
  stamped.ext[ID_KEY], stamped.ext[TEXT_KEY] = 'line-1', 'Some text'
  s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000002}' })
  local out = s:path('lines.txt')
  s:send('read_line_ids', 't1', out)
  H.eq(s:events(), { { 'LINES_READ', 't1', out, '1' } })
  H.eq(H.read_text(out), '{AAAAAAAA-0000-4000-8000-000000000001}|line-1|12.500000|3.000000|Some text\n')
  H.eq(#s.fake.undo, 0)
end)

H.test('read_line_ids writes an empty report when nothing is stamped', function()
  local s = new_session()
  local out = s:path('lines.txt')
  s:send('read_line_ids', 't1', out)
  H.eq(s:events(), { { 'LINES_READ', 't1', out, '0' } })
  H.eq(H.read_text(out), '')
end)

H.test('read_line_ids reports an output file it cannot write', function()
  local s = new_session()
  s:send('read_line_ids', 't1', s:path('no-such-folder') .. package.config:sub(1, 1) .. 'out.txt')
  H.eq(s:events(), { { 'ERROR', 'Could not write the manuscript line report.' } })
end)

H.test('an item split keeps the stamp on both halves and a round trip reads them back', function()
  local s, track = new_session()
  local item = s.fake:add_item(track, { guid = '{AAAAAAAA-0000-4000-8000-000000000001}', position = 0, length = 20, source = 'a.wav' })
  s:send('stamp_item_lines', 't1', payload(s, 'p.txt', { '{AAAAAAAA-0000-4000-8000-000000000001}|line-1|Text' }), '0')
  s:events()
  s.fake:split_item(item, 8)
  local out = s:path('lines.txt')
  s:send('read_line_ids', 't2', out)
  H.eq(s:events()[1][4], '2')
end)

-- create_chapter_regions --------------------------------------------------------------------------------------------

H.test('create_chapter_regions needs AddProjectMarker2', function()
  local s = new_session()
  s.fake:remove_api('AddProjectMarker2')
  s:send('create_chapter_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1' }), '')
  H.eq(s:events(), { { 'ERROR', 'This REAPER version cannot add regions.' } })
end)

H.test('create_chapter_regions reports a missing payload', function()
  local s = new_session()
  s:send('create_chapter_regions', 't1', s:path('missing.txt'), '')
  H.eq(s:events(), { { 'ERROR', 'The chapter region list was not found.' } })
end)

H.test('create_chapter_regions adds a coloured region per row in one undo step', function()
  local s = new_session()
  s:send('create_chapter_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1', '30|61.5|Chapter 2' }), 'FF8800')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '2', '0', '0' } })
  H.eq(#s.fake.markers, 2)
  local first = s.fake.markers[1]
  H.eq({ first.is_region, first.pos, first.rgnend, first.name }, { true, 0, 30, 'Chapter 1' })
  H.eq(first.color, 0x1000000 + 0xFF + 0x88 * 256)
  H.eq(s.fake:undo_labels(), { 'Narration Utils: create chapter regions' })
end)

H.test('create_chapter_regions without a colour uses the default colour', function()
  local s = new_session()
  s:send('create_chapter_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1' }), '')
  H.eq(s.fake.markers[1].color, 0)
end)

H.test('create_chapter_regions is idempotent: an existing region within 0.01 s is not added again', function()
  local s = new_session()
  local path = payload(s, 'r.txt', { '0|30|Chapter 1' })
  s:send('create_chapter_regions', 't1', path, '')
  s:events()
  s:send('create_chapter_regions', 't2', path, '')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't2', '0', '1', '0' } })
  H.eq(#s.fake.markers, 1)
  H.eq(#s.fake.undo, 1)
end)

H.test('create_chapter_regions treats a different title or a bound off by more than 0.01 s as new', function()
  local s = new_session()
  s.fake:add_region(0, 30, 'Chapter 1')
  local path = payload(s, 'r.txt', { '0.005|30.005|Chapter 1', '0|30|Renamed', '0|30.02|Chapter 1' })
  s:send('create_chapter_regions', 't1', path, '')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '2', '1', '0' } })
end)

H.test('create_chapter_regions dedupes rows within one payload', function()
  local s = new_session()
  s:send('create_chapter_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1', '0|30|Chapter 1' }), '')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '1', '1', '0' } })
end)

H.test('create_chapter_regions counts malformed rows as invalid and skips blank lines', function()
  local s = new_session()
  local path = payload(s, 'r.txt', { '0|30|Chapter 1', '', 'nonsense', '-1|5|Negative', '10|5|Backwards', '5|9|', '1|2' })
  s:send('create_chapter_regions', 't1', path, '')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '1', '0', '5' } })
end)

H.test('create_chapter_regions keeps a pipe in the title', function()
  local s = new_session()
  s:send('create_chapter_regions', 't1', payload(s, 'r.txt', { '0|30|Part 1 | The Start' }), '')
  H.eq(s.fake.markers[1].name, 'Part 1 | The Start')
end)

H.test('create_chapter_regions ignores markers when looking for an existing region', function()
  local s = new_session()
  s.fake:insert_marker({ is_region = false, pos = 0, rgnend = 0, name = 'Chapter 1', color = 0 })
  s:send('create_chapter_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1' }), '')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '1', '0', '0' } })
end)
