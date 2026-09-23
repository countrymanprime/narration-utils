-- Spike S7 (reaper-automation-follow-through PRD phase 24): how fixed item lanes behave through the API, before phase 25
-- (retakes as fixed lanes) designs on them. Covers I_FREEMODE=2 and UpdateTimeline(), I_NUMFIXEDLANES, I_FIXEDLANE,
-- C_LANEPLAYS (track and item), C_ALLLANESPLAY, P_LANENAME, B_FIXEDLANE_HIDDEN, how takes (the take-review path,
-- ADR 0098) and lanes convert into each other, comp lanes, undo, and what the saved .rpp records.
-- Research tool, not product code: see docs/research/reaper-spike-s7-fixed-lanes.md for the write-up.
-- Run by run-reaper.ps1 inside an isolated REAPER (-cfgfile). Media come from make_media.py. Nothing is armed,
-- recorded or played: recording into lanes needs audio hardware and stays pending.

-- Guard (owner decision D3): refuse to run unless REAPER's resource path is the scratch -Cfg folder run-reaper.ps1
-- passed, and the audio device is closed.
do
  local BACKSLASH = string.char(92)
  local wanted = os.getenv('NARRATION_UTILS_SPIKE_CFG')
  local actual = reaper.GetResourcePath()
  assert(wanted and wanted ~= '', 'NARRATION_UTILS_SPIKE_CFG is not set: start this script with run-reaper.ps1')
  assert(actual:gsub(BACKSLASH, '/'):lower() == wanted:gsub(BACKSLASH, '/'):lower(), 'REAPER is not using the isolated -cfgfile: ' .. actual)
  reaper.Audio_Quit()
  assert(reaper.Audio_IsRunning() == 0, 'the audio device could not be closed')
end

local PACK = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)')
PACK = PACK:gsub(string.char(92), '/')
local REPORT = PACK .. '/fixed-lanes-report.txt'
local function native(path)
  return (path:gsub('/', string.char(92)))
end
local report = {}
-- The report is rewritten after every section, so a hang in a later one (a modal dialog) keeps the earlier findings.
local function flush()
  local handle = io.open(REPORT .. '.partial', 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
end
local function log(...)
  local parts = {}
  for index = 1, select('#', ...) do
    parts[#parts + 1] = tostring((select(index, ...)))
  end
  report[#report + 1] = table.concat(parts, ' ')
end
local function section(title)
  flush()
  report[#report + 1] = ''
  report[#report + 1] = '== ' .. title .. ' =='
end
local function finish()
  local handle = io.open(REPORT, 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
  os.remove(REPORT .. '.partial')
  reaper.Main_OnCommand(40004, 0) -- File: Quit REAPER
end

-- Actions used (IDs and names read from REAPER 7.80's own action list by this spike's discovery pass; the name is
-- checked again at run time, so a renumbered action stops the run instead of doing something else).
local ACTIONS = {
  undo = { 40029, 'Edit: Undo' },
  redo = { 40030, 'Edit: Redo' },
  set_lanes = { 42431, 'Track properties: Set fixed item lanes' },
  set_lanes_convert = { 42661, 'Track properties: Set fixed lanes (convert takes to lanes)' },
  unset_lanes_convert = { 42662, 'Track properties: Unset free item positioning/fixed item lanes (convert fixed lanes to takes)' },
  explode_takes = { 42635, 'Take: Explode takes on selected tracks to fixed lanes' },
  play_first = { 42790, 'Track lanes: Play only first lane' },
  play_next = { 42482, 'Track lanes: Play only next lane' },
  play_all = { 42799, 'Track lanes: Play all lanes' },
  show_one = { 43098, 'Track properties: Show/play only one fixed item lane' },
  show_all = { 43099, 'Track properties: Show/play all fixed item lanes' },
  comp_new = { 42797, 'Track lanes: Comp into new empty lane' },
  comp_areas = { 42652, 'Track lanes: Add comp areas for selected items' },
  delete_comp_areas = { 42955, 'Track lanes: Delete comp areas' },
  comping_off = { 42692, 'Track lanes: Turn off comping' },
}
local function run_action(key)
  local id, expected = ACTIONS[key][1], ACTIONS[key][2]
  local name = reaper.kbd_getTextFromCmd(id, reaper.SectionFromUniqueID(0))
  assert(name == expected, 'action ' .. id .. ' is "' .. tostring(name) .. '", expected "' .. expected .. '"')
  reaper.Main_OnCommand(id, 0)
  reaper.UpdateTimeline()
end

local function item_guid(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
  return guid
end
local function track_guid(track)
  return reaper.GetTrackGUID(track)
end
local function find_track(guid)
  for index = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, index)
    if track_guid(track) == guid then
      return track
    end
  end
  return nil
end
local function undo_label()
  return tostring(reaper.Undo_CanUndo2(0))
end
local function num(value)
  if value == math.floor(value) then
    return string.format('%d', value)
  end
  return string.format('%.3f', value)
end

-- Every lane-related value on a track and its items, one line per item.
local function dump(label, track)
  local _, name = reaper.GetSetMediaTrackInfo_String(track, 'P_NAME', '', false)
  local lanes = reaper.GetMediaTrackInfo_Value(track, 'I_NUMFIXEDLANES')
  local parts = {
    string.format('[%s] track "%s"', label, name),
    'I_FREEMODE=' .. num(reaper.GetMediaTrackInfo_Value(track, 'I_FREEMODE')),
    'I_NUMFIXEDLANES=' .. num(lanes),
    'C_LANESETTINGS=' .. num(reaper.GetMediaTrackInfo_Value(track, 'C_LANESETTINGS')),
    'C_LANESCOLLAPSED=' .. num(reaper.GetMediaTrackInfo_Value(track, 'C_LANESCOLLAPSED')),
    'C_ALLLANESPLAY=' .. num(reaper.GetMediaTrackInfo_Value(track, 'C_ALLLANESPLAY')),
  }
  local plays, names = {}, {}
  for lane = 0, math.max(lanes, 1) - 1 do
    plays[#plays + 1] = num(reaper.GetMediaTrackInfo_Value(track, 'C_LANEPLAYS:' .. lane))
    local _, lane_name = reaper.GetSetMediaTrackInfo_String(track, 'P_LANENAME:' .. lane, '', false)
    names[#names + 1] = '"' .. lane_name .. '"'
  end
  parts[#parts + 1] = 'C_LANEPLAYS:0..=' .. table.concat(plays, ',')
  parts[#parts + 1] = 'P_LANENAME:0..=' .. table.concat(names, ',')
  log(table.concat(parts, ' '))
  for index = 0, reaper.CountTrackMediaItems(track) - 1 do
    local item = reaper.GetTrackMediaItem(track, index)
    local _, line_id = reaper.GetSetMediaItemInfo_String(item, 'P_EXT:narration_utils_line_id', '', false)
    local takes = {}
    for take_index = 0, reaper.CountTakes(item) - 1 do
      local take = reaper.GetTake(item, take_index)
      local _, take_name = reaper.GetSetMediaItemTakeInfo_String(take, 'P_NAME', '', false)
      local _, finding = reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_finding_id', '', false)
      takes[#takes + 1] = '"' .. take_name .. '"' .. (finding ~= '' and ('{finding=' .. finding .. '}') or '')
    end
    log(
      string.format(
        '    item %d pos=%s len=%s I_FIXEDLANE=%s C_LANEPLAYS=%s B_FIXEDLANE_HIDDEN=%s I_CURTAKE=%s line_id="%s" guid=%s takes=[%s]',
        index,
        num(reaper.GetMediaItemInfo_Value(item, 'D_POSITION')),
        num(reaper.GetMediaItemInfo_Value(item, 'D_LENGTH')),
        num(reaper.GetMediaItemInfo_Value(item, 'I_FIXEDLANE')),
        num(reaper.GetMediaItemInfo_Value(item, 'C_LANEPLAYS')),
        num(reaper.GetMediaItemInfo_Value(item, 'B_FIXEDLANE_HIDDEN')),
        num(reaper.GetMediaItemInfo_Value(item, 'I_CURTAKE')),
        line_id,
        item_guid(item),
        table.concat(takes, ', ')
      )
    )
  end
end

-- The lines of the track's state chunk (what the .rpp saves) that carry lane state, so the report shows what lanes add
-- to the file. The full chunk is also written to chunks/<label>.txt.
local LANE_KEYS = { 'FREEMODE', 'FIXEDLANES', 'ITEMLANES', 'LANE', 'LINKEDLANE', 'YPOS', 'COMP', 'RANK' }
local function chunk(label, track)
  local _, text = reaper.GetTrackStateChunk(track, '', false)
  reaper.RecursiveCreateDirectory(native(PACK .. '/chunks'), 0)
  local handle = io.open(PACK .. '/chunks/' .. label .. '.txt', 'wb')
  handle:write(text)
  handle:close()
  for line in text:gmatch('[^\r\n]+') do
    local trimmed = line:match('^%s*(.-)%s*$')
    for _, key in ipairs(LANE_KEYS) do
      if trimmed:find('^<?' .. key) then
        log('    chunk: ' .. trimmed)
        break
      end
    end
  end
end

local function add_track(name)
  reaper.Undo_BeginBlock2(0)
  local index = reaper.CountTracks(0)
  reaper.InsertTrackAtIndex(index, true)
  local track = reaper.GetTrack(0, index)
  reaper.GetSetMediaTrackInfo_String(track, 'P_NAME', name, true)
  reaper.Undo_EndBlock2(0, 'spike: add track ' .. name, -1)
  return track
end
-- An item with one take and an item-level line id (ADR 0026), the shape the app's stamping produces.
local function add_item(track, file, position, length, take_name, line_id)
  local item = reaper.AddMediaItemToTrack(track)
  reaper.SetMediaItemInfo_Value(item, 'D_POSITION', position)
  reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', length)
  local take = reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile('media/' .. file))
  reaper.GetSetMediaItemTakeInfo_String(take, 'P_NAME', take_name, true)
  if line_id then
    reaper.GetSetMediaItemInfo_String(item, 'P_EXT:narration_utils_line_id', line_id, true)
  end
  return item, take
end
local function select_only_track(track)
  reaper.SetOnlyTrackSelected(track)
  reaper.SelectAllMediaItems(0, false)
end
local function set_track(track, key, value, undo_name)
  reaper.Undo_BeginBlock2(0)
  local ok = reaper.SetMediaTrackInfo_Value(track, key, value)
  reaper.Undo_EndBlock2(0, undo_name, -1)
  reaper.UpdateTimeline()
  log(string.format('set %s=%s -> returned %s; undo label now "%s"', key, num(value), tostring(ok), undo_label()))
end

local ok, err = xpcall(function()
  reaper.Main_OnCommand(40023, 0) -- File: New project
  reaper.Main_SaveProjectEx(0, native(PACK .. '/saved-fixed-lanes.rpp'), 0) -- project folder known before media are added
  reaper.GetSetProjectInfo_String(0, 'RECORD_PATH', 'media', true)
  log('version', reaper.GetAppVersion(), 'os', reaper.GetOS())
  for _, name in ipairs({ 'UpdateTimeline', 'GetSetMediaTrackInfo_String', 'GetTrackStateChunk', 'Undo_CanUndo2' }) do
    log('APIExists', name, reaper.APIExists(name))
  end
  for key, action in pairs(ACTIONS) do
    local name = reaper.kbd_getTextFromCmd(action[1], reaper.SectionFromUniqueID(0))
    if name ~= action[2] then
      log('ACTION NAME MISMATCH', key, action[1], name)
    end
  end

  -----------------------------------------------------------------------
  section('A. Enable fixed lanes with I_FREEMODE=2 on a track with one item; undo and redo')
  -----------------------------------------------------------------------
  local track_a = add_track('A - enable by API')
  reaper.Undo_BeginBlock2(0)
  add_item(track_a, 'take_a.wav', 0, 3, 'line 1 read 1', 'line-000001')
  reaper.Undo_EndBlock2(0, 'spike: setup A', -1)
  dump('A before', track_a)
  chunk('A-before', track_a)
  set_track(track_a, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 on A')
  dump('A after I_FREEMODE=2', track_a)
  chunk('A-lanes', track_a)
  local guid_a = track_guid(track_a)
  run_action('undo')
  log('after undo: old track pointer still valid', reaper.ValidatePtr2(0, track_a, 'MediaTrack*'), 'redo label', tostring(reaper.Undo_CanRedo2(0)))
  track_a = find_track(guid_a)
  dump('A after undo', track_a)
  run_action('redo')
  track_a = find_track(guid_a)
  dump('A after redo', track_a)
  set_track(track_a, 'I_FREEMODE', 1, 'spike: I_FREEMODE=1 (free positioning) on A')
  dump('A after I_FREEMODE=1', track_a)
  set_track(track_a, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 again on A')

  -----------------------------------------------------------------------
  section('A2. Enable fixed lanes on a track whose items overlap')
  -----------------------------------------------------------------------
  local track_a2 = add_track('A2 - overlapping then lanes')
  reaper.Undo_BeginBlock2(0)
  add_item(track_a2, 'take_a.wav', 0, 3, 'read 1', 'line-000002')
  add_item(track_a2, 'take_b.wav', 1, 3, 'read 2 (overlaps read 1)', 'line-000002')
  add_item(track_a2, 'take_c.wav', 5, 3, 'read 3 (no overlap)', 'line-000003')
  reaper.Undo_EndBlock2(0, 'spike: setup A2', -1)
  dump('A2 before', track_a2)
  set_track(track_a2, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 on A2')
  dump('A2 after I_FREEMODE=2', track_a2)
  chunk('A2-lanes', track_a2)

  -----------------------------------------------------------------------
  section('A3. The same two cases through the action "Set fixed item lanes" instead of the API')
  -----------------------------------------------------------------------
  local track_a3 = add_track('A3 - one item, action')
  reaper.Undo_BeginBlock2(0)
  add_item(track_a3, 'take_a.wav', 0, 3, 'line 1 read 1', 'line-000001')
  reaper.Undo_EndBlock2(0, 'spike: setup A3', -1)
  select_only_track(track_a3)
  run_action('set_lanes')
  log('undo label after Set fixed item lanes:', undo_label())
  dump('A3 after action', track_a3)
  chunk('A3-lanes-by-action', track_a3)
  local track_a4 = add_track('A4 - overlapping, action')
  reaper.Undo_BeginBlock2(0)
  add_item(track_a4, 'take_a.wav', 0, 3, 'read 1', 'line-000002')
  add_item(track_a4, 'take_b.wav', 1, 3, 'read 2 (overlaps read 1)', 'line-000002')
  add_item(track_a4, 'take_c.wav', 5, 3, 'read 3 (no overlap)', 'line-000003')
  reaper.Undo_EndBlock2(0, 'spike: setup A4', -1)
  select_only_track(track_a4)
  run_action('set_lanes')
  dump('A4 after action', track_a4)
  chunk('A4-overlap-lanes-by-action', track_a4)
  -- Does setting I_NUMFIXEDLANES after the API enable give the same saved state as the action?
  local track_a5 = add_track('A5 - API enable plus I_NUMFIXEDLANES=1')
  reaper.Undo_BeginBlock2(0)
  add_item(track_a5, 'take_a.wav', 0, 3, 'line 1 read 1', 'line-000001')
  reaper.SetMediaTrackInfo_Value(track_a5, 'I_FREEMODE', 2)
  reaper.SetMediaTrackInfo_Value(track_a5, 'I_NUMFIXEDLANES', 1)
  reaper.Undo_EndBlock2(0, 'spike: setup A5', -1)
  reaper.UpdateTimeline()
  dump('A5 after API enable and I_NUMFIXEDLANES=1', track_a5)
  chunk('A5-api-numlanes', track_a5)

  -----------------------------------------------------------------------
  section('B. Place items on lanes by API: I_FIXEDLANE and I_NUMFIXEDLANES')
  -----------------------------------------------------------------------
  local track_b = add_track('B - retakes on lanes')
  set_track(track_b, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 on B')
  reaper.Undo_BeginBlock2(0)
  local b1 = add_item(track_b, 'take_a.wav', 0, 3, 'retake 1', 'line-000004')
  local b2 = add_item(track_b, 'take_b.wav', 0, 3, 'retake 2', 'line-000004')
  log('new item on a lane track, before any I_FIXEDLANE set: b2 I_FIXEDLANE', reaper.GetMediaItemInfo_Value(b2, 'I_FIXEDLANE'))
  log('SetMediaItemInfo_Value(b2, I_FIXEDLANE, 1) returned', reaper.SetMediaItemInfo_Value(b2, 'I_FIXEDLANE', 1))
  log(
    '  read back b2 I_FIXEDLANE',
    reaper.GetMediaItemInfo_Value(b2, 'I_FIXEDLANE'),
    'track I_NUMFIXEDLANES',
    reaper.GetMediaTrackInfo_Value(track_b, 'I_NUMFIXEDLANES')
  )
  reaper.UpdateTimeline()
  log(
    '  after UpdateTimeline: b2 I_FIXEDLANE',
    reaper.GetMediaItemInfo_Value(b2, 'I_FIXEDLANE'),
    'track I_NUMFIXEDLANES',
    reaper.GetMediaTrackInfo_Value(track_b, 'I_NUMFIXEDLANES')
  )
  log('SetMediaTrackInfo_Value(track_b, I_NUMFIXEDLANES, 3) returned', reaper.SetMediaTrackInfo_Value(track_b, 'I_NUMFIXEDLANES', 3))
  log('  read back I_NUMFIXEDLANES', reaper.GetMediaTrackInfo_Value(track_b, 'I_NUMFIXEDLANES'))
  local b3 = add_item(track_b, 'take_c.wav', 0, 3, 'retake 3', 'line-000004')
  reaper.SetMediaItemInfo_Value(b3, 'I_FIXEDLANE', 2)
  local b4 = add_item(track_b, 'take_a.wav', 4, 3, 'out of range lane', 'line-000005')
  log('SetMediaItemInfo_Value(b4, I_FIXEDLANE, 6) returned', reaper.SetMediaItemInfo_Value(b4, 'I_FIXEDLANE', 6))
  log(
    '  read back b4 I_FIXEDLANE',
    reaper.GetMediaItemInfo_Value(b4, 'I_FIXEDLANE'),
    'track I_NUMFIXEDLANES',
    reaper.GetMediaTrackInfo_Value(track_b, 'I_NUMFIXEDLANES')
  )
  reaper.Undo_EndBlock2(0, 'spike: setup B lanes', -1)
  reaper.UpdateTimeline()
  log(
    'after UpdateTimeline: b4 I_FIXEDLANE',
    reaper.GetMediaItemInfo_Value(b4, 'I_FIXEDLANE'),
    'track I_NUMFIXEDLANES',
    reaper.GetMediaTrackInfo_Value(track_b, 'I_NUMFIXEDLANES')
  )
  local guid_b1 = item_guid(b1)
  dump('B after placing', track_b)
  -- Put b4 back in lane 0 so the rest of B is three retakes of one line and one other line.
  reaper.Undo_BeginBlock2(0)
  reaper.SetMediaItemInfo_Value(b4, 'I_FIXEDLANE', 0)
  reaper.Undo_EndBlock2(0, 'spike: b4 back to lane 0', -1)
  reaper.UpdateTimeline()
  log('after moving b4 to lane 0: I_NUMFIXEDLANES', reaper.GetMediaTrackInfo_Value(track_b, 'I_NUMFIXEDLANES'))
  dump('B settled', track_b)

  -----------------------------------------------------------------------
  section('C. Lane play state: C_LANEPLAYS by API, undo, and the lane actions')
  -----------------------------------------------------------------------
  local guid_b = track_guid(track_b)
  set_track(track_b, 'C_LANEPLAYS:1', 1, 'spike: play lane 1 exclusively')
  dump('B after C_LANEPLAYS:1=1', track_b)
  set_track(track_b, 'C_LANEPLAYS:2', 2, 'spike: lane 2 plays with others')
  dump('B after C_LANEPLAYS:2=2', track_b)
  run_action('undo')
  track_b = find_track(guid_b)
  dump('B after undo of C_LANEPLAYS:2=2', track_b)
  run_action('undo')
  track_b = find_track(guid_b)
  dump('B after undo of C_LANEPLAYS:1=1', track_b)
  run_action('redo')
  track_b = find_track(guid_b)
  dump('B after redo of C_LANEPLAYS:1=1', track_b)
  set_track(track_b, 'C_LANEPLAYS:1', 0, 'spike: lane 1 off (no lane left playing?)')
  dump('B after C_LANEPLAYS:1=0', track_b)
  set_track(track_b, 'C_ALLLANESPLAY', 1, 'spike: C_ALLLANESPLAY=1')
  dump('B after C_ALLLANESPLAY=1', track_b)
  select_only_track(track_b)
  run_action('play_first')
  log('undo label after play_first:', undo_label())
  dump('B after action play only first lane', track_b)
  run_action('play_next')
  log('undo label after play_next:', undo_label())
  dump('B after action play only next lane', track_b)
  run_action('show_one')
  dump('B after action show/play only one lane', track_b)
  run_action('show_all')
  dump('B after action show/play all lanes', track_b)
  run_action('play_all')
  dump('B after action play all lanes', track_b)
  set_track(track_b, 'C_LANEPLAYS:1', 1, 'spike: play lane 1 exclusively (for the saved file)')
  -- The docs call the item-level C_LANEPLAYS read-only: try to set it on the retake in lane 2.
  local b3_now = reaper.GetTrackMediaItem(track_b, 2)
  log('SetMediaItemInfo_Value(item in lane 2, C_LANEPLAYS, 1) returned', reaper.SetMediaItemInfo_Value(b3_now, 'C_LANEPLAYS', 1))
  reaper.UpdateTimeline()
  dump('B after trying item C_LANEPLAYS=1', track_b)

  -----------------------------------------------------------------------
  section('D. Lane names')
  -----------------------------------------------------------------------
  reaper.Undo_BeginBlock2(0)
  for lane = 0, 2 do
    log('set P_LANENAME:' .. lane, reaper.GetSetMediaTrackInfo_String(track_b, 'P_LANENAME:' .. lane, 'Retake ' .. (lane + 1), true))
  end
  reaper.Undo_EndBlock2(0, 'spike: lane names', -1)
  reaper.UpdateTimeline()
  dump('B named', track_b)
  chunk('B-lanes-named', track_b)

  -----------------------------------------------------------------------
  section('E. Takes and lanes (the take-review path, ADR 0098): one item with two takes')
  -----------------------------------------------------------------------
  local function build_take_item(name)
    local track = add_track(name)
    reaper.Undo_BeginBlock2(0)
    local item = add_item(track, 'take_a.wav', 0, 3, 'target (active)', 'line-000006')
    local candidate = reaper.AddTakeToMediaItem(item)
    reaper.SetMediaItemTake_Source(candidate, reaper.PCM_Source_CreateFromFile('media/take_b.wav'))
    reaper.GetSetMediaItemTakeInfo_String(candidate, 'P_NAME', 'candidate', true)
    reaper.GetSetMediaItemTakeInfo_String(candidate, 'P_EXT:narration_utils_take_finding_id', 'finding-0001', true)
    reaper.Undo_EndBlock2(0, 'spike: setup ' .. name, -1)
    return track, item
  end
  local track_e1 = build_take_item('E1 - takes, then I_FREEMODE=2')
  dump('E1 before', track_e1)
  set_track(track_e1, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 on a multi-take item')
  dump('E1 after I_FREEMODE=2 (API, no conversion)', track_e1)
  chunk('E1-takes-on-lane-track', track_e1)
  local e1_item = reaper.GetTrackMediaItem(track_e1, 0)
  reaper.Undo_BeginBlock2(0)
  local e1_extra = reaper.AddTakeToMediaItem(e1_item)
  reaper.SetMediaItemTake_Source(e1_extra, reaper.PCM_Source_CreateFromFile('media/take_c.wav'))
  reaper.GetSetMediaItemTakeInfo_String(e1_extra, 'P_NAME', 'candidate added on a lane track', true)
  reaper.Undo_EndBlock2(0, 'spike: add a take on a lane track', -1)
  reaper.UpdateTimeline()
  dump('E1 after AddTakeToMediaItem on a lane track', track_e1)

  local track_e2 = build_take_item('E2 - takes, then convert to lanes')
  local guid_e2 = track_guid(track_e2)
  select_only_track(track_e2)
  run_action('set_lanes_convert')
  log('undo label after convert takes to lanes:', undo_label())
  dump('E2 after action Set fixed lanes (convert takes to lanes)', track_e2)
  chunk('E2-converted-to-lanes', track_e2)
  run_action('undo')
  track_e2 = find_track(guid_e2)
  dump('E2 after one undo', track_e2)
  run_action('redo')
  track_e2 = find_track(guid_e2)
  dump('E2 after redo', track_e2)
  select_only_track(track_e2)
  run_action('unset_lanes_convert')
  log('undo label after convert lanes to takes:', undo_label())
  dump('E2 after action Unset fixed lanes (convert lanes to takes)', track_e2)
  chunk('E2-back-to-takes', track_e2)

  local track_e3 = build_take_item('E3 - takes, then explode to lanes')
  select_only_track(track_e3)
  run_action('explode_takes')
  log('undo label after explode takes:', undo_label())
  dump('E3 after action Explode takes to fixed lanes', track_e3)

  -- Which lane plays after a conversion, when the candidate (not the first take) is the active one.
  local track_e4 = build_take_item('E4 - candidate active, then convert')
  reaper.Undo_BeginBlock2(0)
  local e4_item = reaper.GetTrackMediaItem(track_e4, 0)
  reaper.SetActiveTake(reaper.GetTake(e4_item, 1))
  reaper.Undo_EndBlock2(0, 'spike: E4 candidate active', -1)
  dump('E4 before convert (candidate made active)', track_e4)
  select_only_track(track_e4)
  run_action('set_lanes_convert')
  dump('E4 after convert (candidate was active)', track_e4)

  -- The way back: three retakes on lanes, lane 1 playing, then "convert fixed lanes to takes". Which take is active?
  local track_e5 = add_track('E5 - lanes, lane 1 plays, convert to takes')
  set_track(track_e5, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 on E5')
  reaper.Undo_BeginBlock2(0)
  reaper.SetMediaTrackInfo_Value(track_e5, 'I_NUMFIXEDLANES', 3)
  for lane = 0, 2 do
    local item = add_item(track_e5, ({ 'take_a.wav', 'take_b.wav', 'take_c.wav' })[lane + 1], 0, 3, 'retake ' .. (lane + 1), 'line-000009')
    reaper.SetMediaItemInfo_Value(item, 'I_FIXEDLANE', lane)
    reaper.GetSetMediaItemTakeInfo_String(reaper.GetActiveTake(item), 'P_EXT:narration_utils_take_finding_id', 'finding-e5-' .. lane, true)
  end
  reaper.SetMediaTrackInfo_Value(track_e5, 'C_LANEPLAYS:1', 1)
  reaper.Undo_EndBlock2(0, 'spike: setup E5', -1)
  reaper.UpdateTimeline()
  dump('E5 before convert', track_e5)
  select_only_track(track_e5)
  run_action('unset_lanes_convert')
  dump('E5 after convert lanes to takes', track_e5)
  chunk('E5-lanes-to-takes', track_e5)

  -----------------------------------------------------------------------
  section('F. Comp lanes on three retakes of one line')
  -----------------------------------------------------------------------
  local track_f = add_track('F - comp')
  set_track(track_f, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 on F')
  reaper.Undo_BeginBlock2(0)
  reaper.SetMediaTrackInfo_Value(track_f, 'I_NUMFIXEDLANES', 3)
  for lane = 0, 2 do
    local item = add_item(track_f, ({ 'take_a.wav', 'take_b.wav', 'take_c.wav' })[lane + 1], 0, 3, 'retake ' .. (lane + 1), 'line-000007')
    reaper.SetMediaItemInfo_Value(item, 'I_FIXEDLANE', lane)
  end
  reaper.Undo_EndBlock2(0, 'spike: setup F', -1)
  reaper.UpdateTimeline()
  dump('F before comp', track_f)
  local guid_f = track_guid(track_f)
  select_only_track(track_f)
  run_action('comp_new')
  log('undo label after comp into new empty lane:', undo_label())
  track_f = find_track(guid_f)
  dump('F after action Comp into new empty lane', track_f)
  chunk('F-comp-lane', track_f)
  -- Select the retake in (what was) lane 2, the "good read", and add a comp area for it.
  reaper.SelectAllMediaItems(0, false)
  for index = 0, reaper.CountTrackMediaItems(track_f) - 1 do
    local item = reaper.GetTrackMediaItem(track_f, index)
    local take = reaper.GetActiveTake(item)
    local _, take_name = reaper.GetSetMediaItemTakeInfo_String(take, 'P_NAME', '', false)
    if take_name == 'retake 2' then
      reaper.SetMediaItemSelected(item, true)
    end
  end
  run_action('comp_areas')
  log('undo label after add comp areas for selected items:', undo_label())
  track_f = find_track(guid_f)
  dump('F after action Add comp areas for selected items (retake 2)', track_f)
  chunk('F-comp-area', track_f)
  run_action('undo')
  track_f = find_track(guid_f)
  dump('F after one undo', track_f)
  run_action('redo')
  track_f = find_track(guid_f)
  dump('F after redo', track_f)
  select_only_track(track_f)
  run_action('delete_comp_areas')
  dump('F after action Delete comp areas', track_f)
  run_action('comping_off')
  dump('F after action Turn off comping', track_f)

  -- F2 keeps its comp lane and comp area, so the saved file shows how REAPER records them.
  local track_f2 = add_track('F2 - comp kept')
  set_track(track_f2, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 on F2')
  reaper.Undo_BeginBlock2(0)
  reaper.SetMediaTrackInfo_Value(track_f2, 'I_NUMFIXEDLANES', 3)
  for lane = 0, 2 do
    local item = add_item(track_f2, ({ 'take_a.wav', 'take_b.wav', 'take_c.wav' })[lane + 1], 0, 3, 'retake ' .. (lane + 1), 'line-000010')
    reaper.SetMediaItemInfo_Value(item, 'I_FIXEDLANE', lane)
  end
  reaper.Undo_EndBlock2(0, 'spike: setup F2', -1)
  reaper.UpdateTimeline()
  select_only_track(track_f2)
  run_action('comp_new')
  for index = 0, reaper.CountTrackMediaItems(track_f2) - 1 do
    local item = reaper.GetTrackMediaItem(track_f2, index)
    local _, take_name = reaper.GetSetMediaItemTakeInfo_String(reaper.GetActiveTake(item), 'P_NAME', '', false)
    reaper.SetMediaItemSelected(item, take_name == 'retake 3')
  end
  run_action('comp_areas')
  dump('F2 with comp area on retake 3', track_f2)
  chunk('F2-comp-kept', track_f2)

  -----------------------------------------------------------------------
  section('G. Turn lanes off by API on a track with three lanes; undo')
  -----------------------------------------------------------------------
  local track_g = add_track('G - lanes off by API')
  set_track(track_g, 'I_FREEMODE', 2, 'spike: I_FREEMODE=2 on G')
  reaper.Undo_BeginBlock2(0)
  reaper.SetMediaTrackInfo_Value(track_g, 'I_NUMFIXEDLANES', 3)
  for lane = 0, 2 do
    local item = add_item(track_g, 'take_a.wav', 0, 3, 'retake ' .. (lane + 1), 'line-000008')
    reaper.SetMediaItemInfo_Value(item, 'I_FIXEDLANE', lane)
  end
  reaper.Undo_EndBlock2(0, 'spike: setup G', -1)
  reaper.UpdateTimeline()
  set_track(track_g, 'C_LANEPLAYS:1', 1, 'spike: G plays lane 1')
  dump('G before', track_g)
  local guid_g = track_guid(track_g)
  set_track(track_g, 'I_FREEMODE', 0, 'spike: I_FREEMODE=0 on G')
  dump('G after I_FREEMODE=0', track_g)
  chunk('G-lanes-off', track_g)
  run_action('undo')
  track_g = find_track(guid_g)
  dump('G after undo', track_g)

  -----------------------------------------------------------------------
  section('H. Save, reload, read everything again')
  -----------------------------------------------------------------------
  log('save', reaper.Main_SaveProjectEx(0, native(PACK .. '/saved-fixed-lanes.rpp'), 0))
  local b1_track_guid = guid_b
  reaper.Main_openProject('noprompt:' .. native(PACK .. '/saved-fixed-lanes.rpp'))
  for index = 0, reaper.CountTracks(0) - 1 do
    dump('reloaded', reaper.GetTrack(0, index))
  end
  local reloaded_b = find_track(b1_track_guid)
  log('track B found by GUID after reload', reloaded_b ~= nil)
  local found_b1 = false
  for index = 0, reaper.CountMediaItems(0) - 1 do
    if item_guid(reaper.GetMediaItem(0, index)) == guid_b1 then
      found_b1 = true
    end
  end
  log('item b1 found by GUID after reload', found_b1)
  log('resave', reaper.Main_SaveProjectEx(0, native(PACK .. '/resaved-fixed-lanes.rpp'), 0))
end, debug.traceback)
if not ok then
  log('ERROR', err)
end
finish()
