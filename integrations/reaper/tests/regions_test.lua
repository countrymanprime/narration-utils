-- Regions for chapters and credits: create_regions (narration_regions.lua). One command serves the chapter regions of
-- the follow-through PRD's Phase 7 (RF-7) and the credits regions of credits-in-chapter-table Phase 4: the host sends a
-- row per region, credits rows named like the chapter table's row labels. It replaced create_chapter_regions, whose
-- behaviour (verified in REAPER 7.80 by spikes/checklist.lua) it keeps; the update flag is new.

local H = require('harness')

local function new_session()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  s.fake:add_track('Narrator')
  return s
end

local function payload(s, name, lines)
  local path = s:path(name)
  H.write_file(path, table.concat(lines, '\n') .. '\n')
  return path
end

local function regions(s)
  local out = {}
  for _, marker in ipairs(s.fake.markers) do
    if marker.is_region then
      out[#out + 1] = { marker.index, marker.pos, marker.rgnend, marker.name }
    end
  end
  return out
end

H.test('create_regions needs AddProjectMarker2 and SetProjectMarker4', function()
  for _, name in ipairs({ 'AddProjectMarker2', 'SetProjectMarker4' }) do
    local s = new_session()
    s.fake:remove_api(name)
    s:send('create_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1' }), '', '0')
    H.eq(s:events(), { { 'ERROR', 't1', 'This REAPER version cannot add regions.' } }, name)
  end
end)

H.test('create_regions reports a missing payload', function()
  local s = new_session()
  s:send('create_regions', 't1', s:path('missing.txt'), '', '0')
  H.eq(s:events(), { { 'ERROR', 't1', 'The region list was not found.' } })
end)

H.test('create_regions adds a coloured region per row in one undo step', function()
  local s = new_session()
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1', '30|61.5|Chapter 2' }), 'FF8800', '0')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '2', '0', '0', '0', '0', '0' } })
  H.eq(regions(s), { { 1, 0, 30, 'Chapter 1' }, { 2, 30, 61.5, 'Chapter 2' } })
  H.eq(s.fake.markers[1].color, 0x1000000 + 0xFF + 0x88 * 256)
  H.eq(s.fake:undo_labels(), { 'Narration Utils: create regions' })
end)

H.test('create_regions adds credits rows like any other: the host names them like the chapter table rows', function()
  local s = new_session()
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|12|Opening Credits', '12|600|Chapter 1', '600|615|Closing Credits' }), '', '0')
  H.eq(s:events()[1][3], '3')
  H.eq(regions(s)[1][4], 'Opening Credits')
  H.eq(regions(s)[3][4], 'Closing Credits')
end)

H.test('create_regions without a colour uses the default colour', function()
  local s = new_session()
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1' }), '', '0')
  H.eq(s.fake.markers[1].color, 0)
end)

H.test('create_regions is idempotent: an existing region within 0.01 s is not added again and makes no undo point', function()
  local s = new_session()
  local path = payload(s, 'r.txt', { '0|30|Chapter 1' })
  s:send('create_regions', 't1', path, '', '0')
  s:events()
  s:send('create_regions', 't2', path, '', '1')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't2', '0', '1', '0', '0', '0', '0' } })
  H.eq(#s.fake.markers, 1)
  H.eq(#s.fake.undo, 1)
end)

H.test('create_regions without the update flag treats a different title or a bound off by more than 0.01 s as new', function()
  local s = new_session()
  s.fake:add_region(0, 30, 'Chapter 1')
  local path = payload(s, 'r.txt', { '0.005|30.005|Chapter 1', '0|30|Renamed', '0|30.02|Chapter 1' })
  s:send('create_regions', 't1', path, '', '0')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '2', '1', '0', '0', '0', '0' } })
end)

H.test('create_regions with the update flag moves the one region with that title, keeping its number and colour', function()
  local s = new_session()
  s.fake:add_region(0, 30, 'Chapter 1')
  s.fake:add_region(30, 60, 'Chapter 2')
  s.fake.markers[2].color = 12345
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1', '30|64.5|Chapter 2' }), 'FF8800', '1')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '0', '1', '0', '1', '0', '0' } })
  H.eq(regions(s), { { 1, 0, 30, 'Chapter 1' }, { 2, 30, 64.5, 'Chapter 2' } })
  H.eq(s.fake.markers[2].color, 12345, 'the narrator colour stays')
  H.eq(s.fake:undo_labels(), { 'Narration Utils: create regions' })
end)

H.test('create_regions with the update flag leaves a title held by several regions alone and creates nothing for it', function()
  local s = new_session()
  s.fake:add_region(0, 30, 'Chapter 1')
  s.fake:add_region(40, 70, 'Chapter 1')
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|35|Chapter 1' }), '', '1')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '0', '0', '0', '0', '1', '0' } })
  H.eq(regions(s), { { 1, 0, 30, 'Chapter 1' }, { 2, 40, 70, 'Chapter 1' } })
  H.eq(#s.fake.undo, 0)
end)

H.test('create_regions with the update flag creates a region whose title is new', function()
  local s = new_session()
  s.fake:add_region(0, 30, 'Chapter 1')
  s:send('create_regions', 't1', payload(s, 'r.txt', { '30|60|Chapter 2' }), '', '1')
  H.eq(s:events()[1], { 'REGIONS_CREATED', 't1', '1', '0', '0', '0', '0', '0' })
end)

H.test('create_regions counts a region REAPER refused to add as failed', function()
  local s = new_session()
  s.fake.add_marker_fails = true
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1' }), '', '0')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '0', '0', '0', '0', '0', '1' } })
end)

H.test('create_regions dedupes rows within one payload', function()
  local s = new_session()
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1', '0|30|Chapter 1' }), '', '0')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '1', '1', '0', '0', '0', '0' } })
end)

H.test('create_regions counts malformed rows as invalid and skips blank lines', function()
  local s = new_session()
  local path = payload(s, 'r.txt', { '0|30|Chapter 1', '', 'nonsense', '-1|5|Negative', '10|5|Backwards', '5|9|', '1|2' })
  s:send('create_regions', 't1', path, '', '0')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '1', '0', '5', '0', '0', '0' } })
end)

H.test('create_regions keeps a pipe in the title', function()
  local s = new_session()
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|30|Part 1 | The Start' }), '', '0')
  H.eq(s.fake.markers[1].name, 'Part 1 | The Start')
end)

H.test('create_regions ignores markers when looking for an existing region', function()
  local s = new_session()
  s.fake:insert_marker({ is_region = false, pos = 0, rgnend = 0, name = 'Chapter 1', color = 0 })
  s:send('create_regions', 't1', payload(s, 'r.txt', { '0|30|Chapter 1' }), '', '1')
  H.eq(s:events(), { { 'REGIONS_CREATED', 't1', '1', '0', '0', '0', '0', '0' } })
end)
