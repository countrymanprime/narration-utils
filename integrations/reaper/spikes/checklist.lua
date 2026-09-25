-- Spike S0, part 2 and the scripted run of docs/architecture/manuscript-line-identity.md's checklist: drives the REAL bridge
-- (integrations/reaper/narration_ui_bridge.lua) inside a real REAPER through the file protocol, the way the Go host does,
-- against a scratch project built here, and records every step in chk/report.txt. Steps that need the app or the owner
-- (Transcript Compare through the app, step 10) are not here.

-- Guard (owner decision D3): refuse to run unless REAPER's resource path is the scratch -Cfg folder run-reaper.ps1 passed,
-- and the audio device is closed. A script that is started any other way stops here instead of touching real settings.
do
  local BACKSLASH = string.char(92)
  local wanted = os.getenv('NARRATION_UTILS_SPIKE_CFG')
  local actual = reaper.GetResourcePath()
  assert(wanted and wanted ~= '', 'NARRATION_UTILS_SPIKE_CFG is not set: start this script with run-reaper.ps1')
  assert(actual:gsub(BACKSLASH, '/'):lower() == wanted:gsub(BACKSLASH, '/'):lower(), 'REAPER is not using the isolated -cfgfile: ' .. actual)
  -- REAPER opens the default Windows audio device (WaveOut, Sound Mapper) on start even when the first-run prompt is
  -- answered No. Nothing is recorded or played, but close it at once and prove it is closed.
  reaper.Audio_Quit()
  assert(reaper.Audio_IsRunning() == 0, 'the audio device could not be closed')
end

local BS = string.char(92)
local function native(path)
  return (path:gsub('/', BS))
end
-- run-reaper.ps1 sets both: the scratch folder (holding media/) and the repository's integrations/reaper folder.
local CHK = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)'):gsub(BS, '/')
local REPO_REAPER = assert(os.getenv('NARRATION_UTILS_REAPER_DIR'), 'set NARRATION_UTILS_REAPER_DIR (run-reaper.ps1 does)'):gsub(BS, '/')
local report, failures = {}, 0

local function log(text)
  report[#report + 1] = text
end
local function check(name, ok, detail)
  if not ok then
    failures = failures + 1
  end
  log(string.format('%s  %s%s', ok and 'PASS' or 'FAIL', name, detail and ('  [' .. tostring(detail) .. ']') or ''))
end
local function finish()
  log(string.format('RESULT %d failure(s)', failures))
  local handle = io.open(CHK .. '/report.txt', 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
  reaper.Main_OnCommand(40004, 0)
end

-- protocol helpers ------------------------------------------------------------------------------------------------
local function encode(value)
  return (tostring(value):gsub('[^%w%-_%.~]', function(char)
    return string.format('%%%02X', string.byte(char))
  end))
end
local function decode(value)
  return (value:gsub('%%(%x%x)', function(hex)
    return string.char(tonumber(hex, 16))
  end))
end
local session_dir = native(CHK .. '/session')
local sent, read_offset = 0, 0
local function send(command, ...)
  sent = sent + 1
  local fields = { '1', command, ... }
  for index, value in ipairs(fields) do
    fields[index] = encode(value)
  end
  local final = session_dir .. BS .. 'commands' .. BS .. string.format('%08d.cmd', sent)
  local handle = assert(io.open(final .. '.tmp', 'wb'))
  handle:write(table.concat(fields, '|'), '\n')
  handle:close()
  assert(os.rename(final .. '.tmp', final))
end
local function new_events()
  local handle = io.open(session_dir .. BS .. 'events.log', 'rb')
  if not handle then
    return {}
  end
  local text = handle:read('a'):gsub('\r\n', '\n')
  handle:close()
  local fresh = text:sub(read_offset + 1)
  read_offset = #text
  local out = {}
  for line in fresh:gmatch('[^\n]+') do
    local fields = {}
    for part in (line .. '|'):gmatch('(.-)|') do
      fields[#fields + 1] = decode(part)
    end
    out[#out + 1] = fields
  end
  return out
end
local function join_events(events)
  local lines = {}
  for _, fields in ipairs(events) do
    lines[#lines + 1] = table.concat(fields, '|')
  end
  return table.concat(lines, ' ; ')
end
local function write_file(path, text)
  local handle = assert(io.open(path, 'wb'))
  handle:write(text)
  handle:close()
end
local function read_file(path)
  local handle = io.open(path, 'rb')
  if not handle then
    return nil
  end
  local text = handle:read('a'):gsub('\r\n', '\n')
  handle:close()
  return text
end

-- coroutine driver: the bridge loop and this script both run once per REAPER frame ---------------------------------
local function frames(count)
  for _ = 1, count do
    coroutine.yield()
  end
end
-- Sends a command and returns the events it produced (waits up to ~4 s of frames for `expect_tag` to appear).
local function run(command, expect_tag, ...)
  new_events()
  send(command, ...)
  local collected = {}
  for _ = 1, 150 do
    frames(1)
    for _, event in ipairs(new_events()) do
      collected[#collected + 1] = event
    end
    for _, event in ipairs(collected) do
      if event[1] == expect_tag or event[1] == 'ERROR' then
        frames(2)
        for _, extra in ipairs(new_events()) do
          collected[#collected + 1] = extra
        end
        return collected
      end
    end
  end
  return collected
end
local function last(events)
  return events[#events]
end

-- scratch project helpers -------------------------------------------------------------------------------------------
local function item_guid(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
  return guid
end
local function ext(item, key)
  local ok, value = reaper.GetSetMediaItemInfo_String(item, 'P_EXT:narration_utils_' .. key, '', false)
  return ok and value or nil
end
local function stamped_count()
  local n = 0
  for index = 0, reaper.CountMediaItems(0) - 1 do
    if ext(reaper.GetMediaItem(0, index), 'line_id') then
      n = n + 1
    end
  end
  return n
end
local function items_by_guid()
  local map = {}
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    map[item_guid(item)] = item
  end
  return map
end

local body = function()
  reaper.RecursiveCreateDirectory(session_dir .. BS .. 'commands', 0)
  reaper.Main_OnCommand(40023, 0) -- File: New project
  local project_path = native(CHK .. '/line-identity.rpp')
  reaper.GetSetProjectInfo_String(0, 'RENDER_FILE', 'renders', true)
  reaper.Main_SaveProjectEx(0, project_path, 0)
  local track = (function()
    reaper.InsertTrackAtIndex(0, true)
    local t = reaper.GetTrack(0, 0)
    reaper.GetSetMediaTrackInfo_String(t, 'P_NAME', 'Narrator', true)
    return t
  end)()
  local items = {}
  for index, spec in ipairs({ { 0, 'take_a.wav' }, { 4, 'take_b.wav' }, { 8, 'take_c.wav' } }) do
    local item = reaper.AddMediaItemToTrack(track)
    reaper.SetMediaItemInfo_Value(item, 'D_POSITION', spec[1])
    reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', 3)
    local take = reaper.AddTakeToMediaItem(item)
    reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile('media/' .. spec[2]))
    reaper.GetSetMediaItemTakeInfo_String(take, 'P_NAME', 'take ' .. index, true)
    reaper.GetSetMediaItemInfo_String(item, 'P_NOTES', 'narrator note ' .. index, true)
    items[index] = item
  end
  reaper.UpdateArrange()
  reaper.Undo_OnStateChange('CHECKLIST: items created') -- API edits leave no undo point, so undoing the stamp would remove the items
  local guid_a, guid_b, guid_c = item_guid(items[1]), item_guid(items[2]), item_guid(items[3])
  log('project ' .. project_path .. '  REAPER ' .. reaper.GetAppVersion())
  log('items ' .. guid_a .. ' ' .. guid_b .. ' ' .. guid_c)

  local bridge = dofile(REPO_REAPER .. '/narration_ui_bridge.lua')
  bridge.run(session_dir)
  frames(3)
  log('registered commands: ' .. table.concat(bridge.new_registry().names(), ','))

  -- 2. Stamp -----------------------------------------------------------------------------------------------------
  local payload = native(CHK .. '/stamp1.txt')
  write_file(payload, guid_a .. '|line-000001|First line.\n')
  local events = run('stamp_item_lines', 'LINES_STAMPED', 't1', payload, '0')
  check('2. stamp: LINES_STAMPED|t1|1|0|0|0', join_events(events) == 'LINES_STAMPED|t1|1|0|0|0', join_events(events))
  check('2. stamp: item carries id and text', ext(items[1], 'line_id') == 'line-000001' and ext(items[1], 'line_text') == 'First line.')
  local label = reaper.Undo_CanUndo2(0)
  check('2. stamp: undo entry "Narration Utils: stamp manuscript line IDs"', label == 'Narration Utils: stamp manuscript line IDs', label)
  -- Undo and redo replace REAPER's item objects, so every item is looked up by GUID again afterwards.
  local function refresh()
    local by_guid = items_by_guid()
    items = { by_guid[guid_a], by_guid[guid_b], by_guid[guid_c] }
  end
  reaper.Undo_DoUndo2(0)
  refresh()
  check('2. stamp: Undo removes the stamp', ext(items[1], 'line_id') == nil, tostring(ext(items[1], 'line_id')))
  reaper.Undo_DoRedo2(0)
  refresh()
  check('2. stamp: Redo restores the stamp', ext(items[1], 'line_id') == 'line-000001', tostring(ext(items[1], 'line_id')))

  -- 3. Idempotent ------------------------------------------------------------------------------------------------
  -- REAPER records an undo point only when the project changed, so change something first.
  reaper.Undo_BeginBlock2(0)
  reaper.GetSetMediaTrackInfo_String(reaper.GetTrack(0, 0), 'P_NAME', 'Narrator (renamed)', true)
  reaper.Undo_EndBlock2(0, 'CHECKLIST marker', -1)
  log('INFO  undo label after a marker point: ' .. tostring(reaper.Undo_CanUndo2(0)))
  events = run('stamp_item_lines', 'LINES_STAMPED', 't2', payload, '0')
  check('3. idempotent: LINES_STAMPED|t2|0|1|0|0', join_events(events) == 'LINES_STAMPED|t2|0|1|0|0', join_events(events))
  label = reaper.Undo_CanUndo2(0)
  check('3. idempotent: no new undo entry', label == 'CHECKLIST marker', label)

  -- 4. Conflict --------------------------------------------------------------------------------------------------
  write_file(payload, guid_a .. '|line-000002|Changed line.\n')
  events = run('stamp_item_lines', 'LINES_STAMPED', 't3', payload, '0')
  check(
    '4. conflict: LINES_CONFLICT then LINES_STAMPED|t3|0|0|0|1',
    join_events(events) == 'LINES_CONFLICT|t3|' .. guid_a .. ' ; LINES_STAMPED|t3|0|0|0|1',
    join_events(events)
  )
  check('4. conflict: old id kept', ext(items[1], 'line_id') == 'line-000001')
  events = run('stamp_item_lines', 'LINES_STAMPED', 't4', payload, '1')
  check('4. overwrite=1: id changes', join_events(events) == 'LINES_STAMPED|t4|1|0|0|0' and ext(items[1], 'line_id') == 'line-000002', join_events(events))

  -- 5. Stale -----------------------------------------------------------------------------------------------------
  local before = stamped_count()
  local ghost = '{00000000-0000-4000-8000-00000000BEEF}'
  write_file(payload, ghost .. '|line-000009|Ghost.\n')
  events = run('stamp_item_lines', 'LINES_STAMPED', 't5', payload, '0')
  check(
    '5. stale: LINES_STALE then LINES_STAMPED|t5|0|0|1|0',
    join_events(events) == 'LINES_STALE|t5|' .. ghost .. ' ; LINES_STAMPED|t5|0|0|1|0',
    join_events(events)
  )
  check('5. stale: no item changed', stamped_count() == before and ext(items[2], 'line_id') == nil)

  -- 6. Survives editing: split, move, duplicate, copy and paste ---------------------------------------------------
  local right = reaper.SplitMediaItem(items[1], 1.5)
  check('6. split: right half exists', right ~= nil)
  local left_id, right_id = ext(items[1], 'line_id'), right and ext(right, 'line_id')
  check('6. split: left half keeps the stamp', left_id == 'line-000002', tostring(left_id))
  check('6. split: right half keeps the stamp', right_id == 'line-000002', tostring(right_id))
  log('INFO  split right half text=' .. tostring(right and ext(right, 'line_text')) .. '  new GUID differs=' .. tostring(right and item_guid(right) ~= guid_a))
  reaper.SetMediaItemInfo_Value(right, 'D_POSITION', 20)
  reaper.SelectAllMediaItems(0, false)
  reaper.SetMediaItemSelected(items[1], true)
  reaper.Main_OnCommand(41295, 0) -- Item: Duplicate items
  local after_duplicate = stamped_count()
  check('6. duplicate: the copy keeps the stamp (3 stamped items)', after_duplicate == 3, after_duplicate)
  reaper.SelectAllMediaItems(0, false)
  reaper.SetMediaItemSelected(items[1], true)
  local items_before_paste = reaper.CountMediaItems(0)
  reaper.Main_OnCommand(40698, 0) -- Edit: Copy items/tracks/envelope points (depending on focus)
  reaper.SetEditCurPos(30, false, false)
  reaper.SetOnlyTrackSelected(reaper.GetTrack(0, 0))
  reaper.Main_OnCommand(42398, 0) -- Item: Paste items/tracks
  local after_paste = stamped_count()
  log('INFO  paste attempt 1 (42398): items ' .. items_before_paste .. ' -> ' .. reaper.CountMediaItems(0) .. ', stamped ' .. after_paste)
  if reaper.CountMediaItems(0) == items_before_paste then
    reaper.Main_OnCommand(40058, 0) -- Item: Paste items/tracks (old-style)
    after_paste = stamped_count()
    log('INFO  paste attempt 2 (40058): items ' .. items_before_paste .. ' -> ' .. reaper.CountMediaItems(0) .. ', stamped ' .. after_paste)
  end
  if reaper.CountMediaItems(0) == items_before_paste then
    -- Fall back to what a paste does to the item: its state chunk (including extension data) copied onto another item.
    local _, chunk = reaper.GetItemStateChunk(items[1], '', false)
    log('INFO  the item state chunk carries the extension block: ' .. tostring(chunk:find('narration_utils_line_id', 1, true) ~= nil))
    local copy = reaper.AddMediaItemToTrack(reaper.GetTrack(0, 0))
    reaper.SetItemStateChunk(copy, chunk, false)
    after_paste = stamped_count()
    log('INFO  chunk copy: stamped ' .. after_paste)
  end
  check('6. paste or chunk copy: the copy keeps the stamp (4 stamped items)', after_paste == 4, after_paste)
  local out = native(CHK .. '/lines.txt')
  events = run('read_line_ids', 'LINES_READ', 't6', out)
  check('6. read_line_ids reports every stamped item', join_events(events) == 'LINES_READ|t6|' .. out .. '|4', join_events(events))
  local report_text = read_file(out) or ''
  local first_line = report_text:match('[^\n]+') or ''
  local fields = {}
  for part in (first_line .. '|'):gmatch('(.-)|') do
    fields[#fields + 1] = part
  end
  check('6. read_line_ids line shape guid|id|position|length|text', #fields == 5 and fields[1]:match('^{%x+%-') and fields[2] == 'line-000002', first_line)

  -- 7. Survives save and reload ----------------------------------------------------------------------------------
  local stamped_before_save = stamped_count()
  reaper.Main_SaveProjectEx(0, project_path, 0)
  reaper.Main_openProject('noprompt:' .. project_path)
  frames(5)
  check('7. reload: same number of stamped items', stamped_count() == stamped_before_save, stamped_count() .. ' vs ' .. stamped_before_save)
  events = run('read_line_ids', 'LINES_READ', 't7', out)
  check('7. reload: read_line_ids reports them all', join_events(events) == 'LINES_READ|t7|' .. out .. '|' .. stamped_before_save, join_events(events))
  check('7. reload: item text preserved', (read_file(out) or ''):find('|Changed line.', 1, true) ~= nil)

  -- 8. Untouched fields ------------------------------------------------------------------------------------------
  local map_after = items_by_guid()
  local b = map_after[guid_b]
  local _, notes = reaper.GetSetMediaItemInfo_String(b, 'P_NOTES', '', false)
  local _, take_name = reaper.GetSetMediaItemTakeInfo_String(reaper.GetActiveTake(b), 'P_NAME', '', false)
  check('8. untouched: notes and take name unchanged', notes == 'narrator note 2' and take_name == 'take 2', notes .. ' / ' .. take_name)
  local a_now = map_after[guid_a]
  local _, notes_a = reaper.GetSetMediaItemInfo_String(a_now, 'P_NOTES', '', false)
  check('8. untouched: a stamped item keeps its notes', notes_a == 'narrator note 1', notes_a)

  -- 9. Regions ---------------------------------------------------------------------------------------------------
  local regions = native(CHK .. '/regions.txt')
  write_file(regions, '0|30|Chapter 1\n')
  events = run('create_regions', 'REGIONS_CREATED', 't8', regions, 'FF8800', '0')
  check('9. regions: REGIONS_CREATED|t8|1|0|0|0|0|0', join_events(events) == 'REGIONS_CREATED|t8|1|0|0|0|0|0', join_events(events))
  local _, is_region, first, last_pos, name, _, color = reaper.EnumProjectMarkers3(0, 0)
  check(
    '9. regions: a region 0-30 named Chapter 1 with colour',
    is_region and first == 0 and last_pos == 30 and name == 'Chapter 1' and color == reaper.ColorToNative(255, 136, 0) + 0x1000000,
    tostring(color)
  )
  events = run('create_regions', 'REGIONS_CREATED', 't9', regions, 'FF8800', '0')
  check('9. regions again: REGIONS_CREATED|t9|0|1|0|0|0|0', join_events(events) == 'REGIONS_CREATED|t9|0|1|0|0|0|0', join_events(events))
  write_file(regions, '0|30|Chapter 1\nnot a region\n')
  events = run('create_regions', 'REGIONS_CREATED', 't10', regions, '', '0')
  check('9. malformed row counted invalid: REGIONS_CREATED|t10|0|1|1|0|0|0', join_events(events) == 'REGIONS_CREATED|t10|0|1|1|0|0|0', join_events(events))
  local count_regions = select(3, reaper.CountProjectMarkers(0))
  check('9. still exactly one region', count_regions == 1, count_regions)

  -- 10 (bridge side only). Transcript Compare commands with a hand-made results file -----------------------------------
  local project_folder = CHK
  reaper.RecursiveCreateDirectory(native(project_folder .. '/narration-utils/manuscript'), 0)
  write_file(native(project_folder .. '/narration-utils/manuscript/manuscript.json'), '{"version":1}')
  reaper.SelectAllMediaItems(0, false)
  local target = map_after[guid_b]
  reaper.SetMediaItemSelected(target, true)
  events = run('prepare_compare', 'COMPARE_PREPARED', 'c1')
  local prepared = last(events)
  check('10. prepare_compare: COMPARE_PREPARED with 1 audio item', prepared and prepared[1] == 'COMPARE_PREPARED' and prepared[7] == '1', join_events(events))
  local manifest = prepared and read_file(prepared[3]) or ''
  check(
    '10. prepare_compare: manifest names the media and the offsets',
    manifest:find('take_b.wav', 1, true) ~= nil and manifest:find('|0.000000|3.000000', 1, true) ~= nil,
    manifest
  )
  local results = native(CHK .. '/results_c1.txt')
  write_file(results, 'SUMMARY|1 discrepancy(s) found.\nMARKER|0|1.250000|MISREAD|MISREAD: alice|Alice|Alyss|Chapter 1|4|script ctx|audio ctx|0.9|0.1\n')
  events = run('inspect_compare_results', 'COMPARE_INSPECTED', 'c1', results)
  check(
    '10. inspect: one COMPARE_MARKER at project time 5.25 and COMPARE_INSPECTED',
    #events == 2 and events[1][1] == 'COMPARE_MARKER' and events[1][8] == '5.25' and events[2][1] == 'COMPARE_INSPECTED',
    join_events(events)
  )
  events = run('export_compare_markers', 'COMPARE_EXPORTED', 'c1', results, 'FF4040', 'FFC000', '40A0FF')
  check('10. export: COMPARE_EXPORTED|c1|1|0', last(events) and table.concat(last(events), '|') == 'COMPARE_EXPORTED|c1|1|0', join_events(events))
  local take_b = reaper.GetActiveTake(target)
  local marker_pos, marker_name = reaper.GetTakeMarker(take_b, 0)
  check(
    '10. export: a take marker MISREAD: alice at source 1.25',
    marker_name == 'MISREAD: alice' and math.abs(marker_pos - 1.25) < 1e-6,
    tostring(marker_name) .. ' @ ' .. tostring(marker_pos)
  )
  check(
    '10. export: undo entry "Transcript Compare: export take markers"',
    reaper.Undo_CanUndo2(0) == 'Transcript Compare: export take markers',
    reaper.Undo_CanUndo2(0)
  )
  reaper.SelectAllMediaItems(0, false)
  events = run('jump_to_compare_marker', 'NONE', 'c1', '0@1.250000')
  frames(3)
  check(
    '10. jump: cursor at 5.25 and the item selected',
    math.abs(reaper.GetCursorPosition() - 5.25) < 1e-6 and reaper.IsMediaItemSelected(target),
    reaper.GetCursorPosition()
  )
  events = run('jump_to_compare_marker', 'NONE', 'c1', 'unknown@1.000000')
  check(
    '10. jump to an unknown row: ERROR|c1|Marker location is no longer available.',
    join_events(events) == 'ERROR|c1|Marker location is no longer available.',
    join_events(events)
  )

  -- final save (the fixture) and close ------------------------------------------------------------------------------------
  events = run('close', 'NONE')
  reaper.Main_SaveProjectEx(0, project_path, 0)
  log('saved ' .. project_path)
end

local co = coroutine.create(function()
  local ok, err = xpcall(body, debug.traceback)
  if not ok then
    failures = failures + 1
    log('ERROR ' .. tostring(err))
  end
  finish()
end)
local function step()
  if coroutine.status(co) ~= 'dead' then
    local ok, err = coroutine.resume(co)
    if not ok then
      log('DRIVER ERROR ' .. tostring(err))
      finish()
      return
    end
    reaper.defer(step)
  end
end
reaper.RecursiveCreateDirectory(native(CHK), 0)
reaper.defer(step)
