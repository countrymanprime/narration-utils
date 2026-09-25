-- Transcript Compare over the bridge: prepare, inspect, export and jump, as the Go transcript service drives them.

local H = require('harness')

-- A saved project with a manuscript, so prepare_compare gets past its guards. Returns the session and the folder.
local function project_session(options)
  options = options or {}
  local root = host.tmpdir()
  local folder = H.join(root, 'Book')
  host.makedirs(H.join(H.join(folder, 'narration-utils'), 'manuscript'))
  if options.manuscript ~= false then
    H.write_file(H.join(H.join(H.join(folder, 'narration-utils'), 'manuscript'), 'manuscript.json'), '{"version":1}')
  end
  local s = H.session({ project_path = options.saved == false and '' or H.join(folder, 'Book.rpp') })
  return s, folder
end

local function audio_track(s, name, selected)
  return s.fake:add_track(name or 'Narrator', selected)
end

local function first_event(s)
  local events = s:events()
  H.eq(#events, 1, 'expected exactly one event')
  return events[1]
end

-- prepare_compare -----------------------------------------------------------------------------------------------

H.test('prepare_compare needs SetTakeMarker', function()
  local s = project_session()
  s.fake:remove_api('SetTakeMarker')
  s:send('prepare_compare', 'r1')
  H.eq(first_event(s), { 'ERROR', 'r1', 'This REAPER version cannot add take markers.' })
end)

H.test('prepare_compare needs a saved project', function()
  local s = project_session({ saved = false })
  s:send('prepare_compare', 'r1')
  H.eq(first_event(s), { 'ERROR', 'r1', 'Save the REAPER project before starting Transcript Compare.' })
end)

H.test('prepare_compare needs an imported manuscript', function()
  local s = project_session({ manuscript = false })
  s:send('prepare_compare', 'r1')
  H.eq(first_event(s), { 'ERROR', 'r1', 'Import a manuscript in Narration Utils before starting Transcript Compare.' })
end)

H.test('prepare_compare needs a selection', function()
  local s = project_session()
  s:send('prepare_compare', 'r1')
  H.eq(first_event(s), { 'ERROR', 'r1', 'Select audio item(s), or select a track, then start Transcript Compare.' })
end)

H.test('prepare_compare reports a selected track without items', function()
  local s = project_session()
  audio_track(s, 'Empty', true)
  s:send('prepare_compare', 'r1')
  H.eq(first_event(s), { 'ERROR', 'r1', 'The selected track has no audio items.' })
end)

H.test('prepare_compare reports when no selected item has a resolvable source', function()
  local s = project_session()
  local track = audio_track(s)
  s.fake:add_item(track, { selected = true, midi = true, source = '' })
  s.fake:add_item(track, { selected = true })
  s:send('prepare_compare', 'r1')
  H.eq(first_event(s), { 'ERROR', 'r1', 'No resolvable audio sources were found in the selection.' })
end)

H.test('prepare_compare writes the manifest of the selected items in time order and announces it', function()
  local s, folder = project_session()
  local track = audio_track(s, 'Alice: chapter 1')
  s.fake:add_item(track, { selected = true, position = 20, length = 4, source = 'C:\\media\\b.wav', startoffs = 2.5, playrate = 2 })
  s.fake:add_item(track, { selected = true, position = 5, length = 10, source = 'C:\\media\\a.wav' })
  s.fake:add_item(track, { selected = false, position = 40, length = 1, source = 'C:\\media\\unselected.wav' })
  local other = audio_track(s, 'Other')
  s.fake:add_item(other, { selected = true, position = 1, length = 1, source = 'C:\\media\\other-track.wav' })
  s:send('prepare_compare', 'r1')

  local manifest_path = s:path('manifest_r1.txt')
  H.eq(H.read_text(manifest_path), '0|C:\\media\\a.wav|0.000000|10.000000\n1|C:\\media\\b.wav|2.500000|8.000000\n')
  local diff_path = H.join(H.join(H.join(folder, 'TranscriptCompare'), 'diffs'), 'Alice_ chapter 1_r1.diff')
  H.eq(first_event(s), {
    'COMPARE_PREPARED',
    'r1',
    manifest_path,
    H.join(H.join(H.join(folder, 'narration-utils'), 'manuscript'), 'manuscript.json'),
    'Alice: chapter 1',
    diff_path,
    '2',
    '0',
  })
  H.eq(host.listdir(H.join(H.join(folder, 'TranscriptCompare'), 'diffs')), {}, 'the diffs directory is created and empty')
end)

-- The comparison's baseline for the "changed since comparison" label (follow-through PRD Phase 13): REAPER's own edit
-- counter as the audio was listed, read in the same call so no edit can fall between the two.
H.test('prepare_compare answers the change count the comparison starts from', function()
  local s = project_session()
  local track = audio_track(s)
  s.fake:add_item(track, { selected = true, position = 0, length = 10, source = 'a.wav' })
  s.fake.change_count = 41
  s:send('prepare_compare', 'r1')
  H.eq(first_event(s)[8], '41')
end)

H.test('prepare_compare leaves the change count off when REAPER cannot report it', function()
  local s = project_session()
  local track = audio_track(s)
  s.fake:add_item(track, { selected = true, position = 0, length = 10, source = 'a.wav' })
  s.fake:remove_api('GetProjectStateChangeCount')
  s:send('prepare_compare', 'r1')
  local event = first_event(s)
  H.eq(event[1], 'COMPARE_PREPARED')
  H.eq(#event, 7, 'an older REAPER answers the six fields it always did')
end)

H.test('prepare_compare from a selected track uses every item on it, skipping MIDI and empty takes', function()
  local s = project_session()
  local track = audio_track(s, 'Narrator', true)
  s.fake:add_item(track, { position = 1, length = 3, source = 'one.wav' })
  s.fake:add_item(track, { position = 9, length = 3, midi = true })
  s.fake:add_item(track, { position = 15, length = 3 })
  s.fake:add_item(track, { position = 30, length = 3, source = 'two.wav', playrate = 0 })
  s:send('prepare_compare', 'r1')
  H.eq(H.read_text(s:path('manifest_r1.txt')), '0|one.wav|0.000000|3.000000\n1|two.wav|0.000000|3.000000\n', 'a zero play rate is treated as 1')
  local event = first_event(s)
  H.eq(event[1], 'COMPARE_PREPARED')
  H.eq(event[7], '2')
end)

-- inspect_compare_results and export ---------------------------------------------------------------------------------

-- Prepares a run with two items and returns the session plus a helper that writes a results file.
local function prepared_run(run_id)
  local s = project_session()
  local track = audio_track(s)
  local a = s.fake:add_item(track, { selected = true, position = 100, length = 30, source = 'a.wav', startoffs = 10, playrate = 1 })
  local b = s.fake:add_item(track, { selected = true, position = 200, length = 30, source = 'b.wav', startoffs = 0, playrate = 2 })
  s:send('prepare_compare', run_id)
  s:events()
  local function write_results(lines)
    local path = s:path('results_' .. run_id .. '.txt')
    H.write_file(path, table.concat(lines, '\n') .. '\n')
    return path
  end
  return s, a, b, write_results
end

-- MARKER|item_index|srcpos|kind|name|doc_text|audio_text|chapter|paragraph|script_ctx|audio_ctx|confidence|gap
local function marker_line(item, srcpos, kind, name, doc, audio, extra)
  return string.format('MARKER|%d|%s|%s|%s|%s|%s|%s', item, srcpos, kind, name, doc, audio, extra or 'Chapter 1|4|script ctx|audio ctx|0.9|0.1')
end

H.test('inspect_compare_results says the context expired for an unknown run', function()
  local s = project_session()
  s:send('inspect_compare_results', 'nope', s:path('r.txt'))
  H.eq(first_event(s), { 'ERROR', 'nope', 'Transcript Compare context expired; prepare a new comparison.' })
end)

H.test('inspect_compare_results reports a missing results file', function()
  local s = prepared_run('r1')
  s:send('inspect_compare_results', 'r1', s:path('missing.txt'))
  H.eq(first_event(s), { 'ERROR', 'r1', 'Transcript results were not found.' })
end)

H.test('inspect_compare_results emits one COMPARE_MARKER per row with project-time positions', function()
  local s, a, _, write_results = prepared_run('r1')
  local path = write_results({
    'SUMMARY|2 discrepancy(s) found.',
    marker_line(0, '12.500000', 'MISREAD', 'MISREAD: alice', 'Alice', 'Alyss'),
    marker_line(1, '3.000000', 'SKIPPED', 'SKIPPED: the', 'the', ''),
    marker_line(7, '1.000000', 'EXTRA', 'EXTRA: x', '', 'x'),
    'NOISE|ignored',
  })
  s:send('inspect_compare_results', 'r1', path)
  local events = s:events()
  H.eq(#events, 3, 'two rows and the closing event; the unknown item index is dropped')
  -- Item 0 starts at 100 s with source offset 10 and rate 1: project time 100 + (12.5 - 10) / 1.
  local first = {
    'COMPARE_MARKER',
    'r1',
    '0@12.500000',
    'MISREAD',
    'MISREAD: alice',
    'Alice',
    'Alyss',
    '102.5',
    '0',
    'Chapter 1',
    '4',
    'script ctx',
    'audio ctx',
    'pending',
    '',
    '12.5',
    -- The trailing identity (review-dashboard PRD Phase 6): item, take and track GUIDs, so a finding can be navigated
    -- to by GUID instead of by a row that only lives as long as this run.
    a.guid,
    a.takes[1].guid,
    a.track.guid,
  }
  H.eq(events[1], first)
  -- Item 1 starts at 200 s, offset 0, rate 2: project time 200 + 3 / 2.
  H.eq(events[2][3], '1@3.000000')
  H.eq(events[2][8], '201.5')
  H.eq(events[3], { 'COMPARE_INSPECTED', 'r1', '2 discrepancy(s) found.', '2', '0' })
end)

H.test('inspect_compare_results falls back to a count summary and flags markers that already exist', function()
  local s, a, _, write_results = prepared_run('r1')
  a.takes[1].markers[1] = { name = 'MISREAD: previous', srcpos = 12.4, color = 0 }
  local path = write_results({ marker_line(0, '12.500000', 'MISREAD', 'MISREAD: alice', 'Alice', 'Alyss') })
  s:send('inspect_compare_results', 'r1', path)
  local events = s:events()
  H.eq(events[1][14], 'existing')
  H.eq(events[1][15], 'MISREAD: previous')
  H.eq(events[2], { 'COMPARE_INSPECTED', 'r1', '1 discrepancy(s) found.', '1', '1' })
end)

H.test('the GUIDs on a marker are the ones the item had when the comparison was prepared', function()
  local s, a, _, write_results = prepared_run('r1')
  local prepared_item, prepared_take = a.guid, a.takes[1].guid
  -- The narrator edits while the sidecar runs; the audio the rows describe is the audio prepared, so the identity is too.
  a.guid = '{AAAAAAAA-0000-4000-8000-0000000000AA}'
  local path = write_results({ marker_line(0, '12.500000', 'MISREAD', 'MISREAD: alice', 'Alice', 'Alyss') })
  s:send('inspect_compare_results', 'r1', path)
  local marker = s:events()[1]
  H.eq({ marker[17], marker[18] }, { prepared_item, prepared_take })
end)

H.test('an existing marker only counts within 0.15 s and with the same prefix', function()
  local s, a, _, write_results = prepared_run('r1')
  a.takes[1].markers[1] = { name = 'MISREAD: too far', srcpos = 12.66, color = 0 }
  a.takes[1].markers[2] = { name = 'EXTRA: wrong kind', srcpos = 12.5, color = 0 }
  a.takes[1].markers[3] = { name = 'no prefix at all', srcpos = 12.5, color = 0 }
  local path = write_results({ marker_line(0, '12.500000', 'MISREAD', 'MISREAD: alice', 'Alice', 'Alyss') })
  s:send('inspect_compare_results', 'r1', path)
  H.eq(s:events()[1][14], 'pending')
end)

H.test('export_compare_markers says the context expired for an unknown run', function()
  local s = project_session()
  s:send('export_compare_markers', 'nope', s:path('r.txt'), 'FF4040', 'FFC000', '40A0FF')
  H.eq(first_event(s), { 'ERROR', 'nope', 'Transcript Compare context expired; prepare a new comparison.' })
end)

H.test('export_compare_markers reports a missing results file', function()
  local s = prepared_run('r1')
  s:send('export_compare_markers', 'r1', s:path('missing.txt'), 'FF4040', 'FFC000', '40A0FF')
  H.eq(first_event(s), { 'ERROR', 'r1', 'Transcript results were not found.' })
end)

H.test('export_compare_markers adds each inspected pending marker once, coloured by kind, in one undo step', function()
  local s, a, b, write_results = prepared_run('r1')
  local path = write_results({
    marker_line(0, '12.500000', 'MISREAD', 'MISREAD: alice', 'Alice', 'Alyss'),
    marker_line(1, '3.000000', 'SKIPPED', 'SKIPPED: the', 'the', ''),
  })
  s:send('inspect_compare_results', 'r1', path)
  s:events()
  s:send('export_compare_markers', 'r1', path, 'FF4040', 'FFC000', '40A0FF')
  local events = s:events()
  H.eq(events[1], { 'COMPARE_EXPORT_MARKER', 'r1', '0@12.500000', 'exported', '' })
  H.eq(events[2], { 'COMPARE_EXPORT_MARKER', 'r1', '1@3.000000', 'exported', '' })
  H.eq(events[3], { 'COMPARE_EXPORTED', 'r1', '2', '0' })
  H.eq(a.takes[1].markers, { { name = 'MISREAD: alice', srcpos = 12.5, color = 0x1000000 + 0xFF + 0x40 * 256 + 0x40 * 65536 } })
  H.eq(b.takes[1].markers, { { name = 'SKIPPED: the', srcpos = 3, color = 0x1000000 + 0xFF + 0xC0 * 256 } })
  H.eq(s.fake:undo_labels(), { 'Transcript Compare: export take markers' })
end)

H.test('export_compare_markers twice adds nothing the second time and leaves no new undo point', function()
  local s, a, _, write_results = prepared_run('r1')
  local path = write_results({ marker_line(0, '12.500000', 'MISREAD', 'MISREAD: alice', 'Alice', 'Alyss') })
  s:send('inspect_compare_results', 'r1', path)
  s:send('export_compare_markers', 'r1', path, 'FF4040', 'FFC000', '40A0FF')
  s:events()
  s:send('export_compare_markers', 'r1', path, 'FF4040', 'FFC000', '40A0FF')
  H.eq(s:events(), { { 'COMPARE_EXPORTED', 'r1', '0', '0' } })
  H.eq(#a.takes[1].markers, 1)
  H.eq(#s.fake.undo, 1)
end)

H.test('export_compare_markers skips a marker the narrator added between inspect and export', function()
  local s, a, _, write_results = prepared_run('r1')
  local path = write_results({ marker_line(0, '12.500000', 'MISREAD', 'MISREAD: alice', 'Alice', 'Alyss') })
  s:send('inspect_compare_results', 'r1', path)
  s:events()
  a.takes[1].markers[1] = { name = 'MISREAD: by hand', srcpos = 12.55, color = 0 }
  s:send('export_compare_markers', 'r1', path, 'FF4040', 'FFC000', '40A0FF')
  local events = s:events()
  H.eq(events[1], { 'COMPARE_EXPORT_MARKER', 'r1', '0@12.500000', 'existing', 'MISREAD: by hand' })
  H.eq(events[2], { 'COMPARE_EXPORTED', 'r1', '0', '1' })
  H.eq(#a.takes[1].markers, 1)
  H.eq(#s.fake.undo, 0)
end)

H.test('export_compare_markers ignores rows that were never inspected', function()
  local s, a, _, write_results = prepared_run('r1')
  local path = write_results({ marker_line(0, '12.500000', 'MISREAD', 'MISREAD: alice', 'Alice', 'Alyss') })
  s:send('export_compare_markers', 'r1', path, 'FF4040', 'FFC000', '40A0FF')
  H.eq(s:events(), { { 'COMPARE_EXPORTED', 'r1', '0', '0' } })
  H.eq(#a.takes[1].markers, 0)
end)

-- jump_to_compare_marker ------------------------------------------------------------------------------------------

H.test('jump_to_compare_marker selects only that item and moves the edit cursor to the marker', function()
  local s, a, b, write_results = prepared_run('r1')
  local path = write_results({ marker_line(1, '3.000000', 'SKIPPED', 'SKIPPED: the', 'the', '') })
  s:send('inspect_compare_results', 'r1', path)
  s:events()
  a.selected = true
  s:send('jump_to_compare_marker', 'r1', '1@3.000000')
  H.eq(s:events(), {})
  H.eq({ a.selected, b.selected }, { false, true })
  H.eq(s.fake.cursor, 201.5)
  H.eq({ s.fake.cursor_moveview, s.fake.cursor_seekplay }, { true, false })
end)

H.test('jump_to_compare_marker reports an unknown row or run', function()
  local s = prepared_run('r1')
  s:send('jump_to_compare_marker', 'r1', 'nothing@1.000000')
  H.eq(first_event(s), { 'ERROR', 'r1', 'Marker location is no longer available.' })
  s:send('jump_to_compare_marker', 'other-run', '0@1.000000')
  H.eq(first_event(s), { 'ERROR', 'other-run', 'Marker location is no longer available.' })
end)
