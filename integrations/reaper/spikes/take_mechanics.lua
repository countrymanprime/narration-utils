-- Take-review PRD phase 1 spike: answers Q4 (how a take is created: which take becomes active, item-length
-- behaviour on a longer/shorter candidate, source-offset alignment, one-step undo) and Q5 (take provenance via
-- namespaced take P_EXT plus a finding id, extending ADR 0026). Research tool, not product code: see
-- docs/research/take-review-spike-p1-take-mechanics.md for the write-up.
-- Run by run-reaper.ps1 inside an isolated REAPER (-cfgfile). Media come from make_media.py and make_length_media.py.

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
local function native(path)
  return (path:gsub('/', string.char(92)))
end
local report = {}
local function log(...)
  local parts = {}
  for index = 1, select('#', ...) do
    parts[#parts + 1] = tostring((select(index, ...)))
  end
  report[#report + 1] = table.concat(parts, ' ')
end
local function section(title)
  report[#report + 1] = ''
  report[#report + 1] = '== ' .. title .. ' =='
end
local function finish()
  local handle = io.open(PACK .. '/take-mechanics-report.txt', 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
  reaper.Main_OnCommand(40004, 0) -- File: Quit REAPER
end

local function item_guid(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
  return guid
end
local function take_guid(take)
  local _, guid = reaper.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
  return guid
end
-- Undo, redo and project reload replace REAPER's item/take objects (confirmed by the S0 spike and by this one):
-- any script that mutates and then must read the result back needs to re-resolve by GUID, never keep the old
-- pointer. This is what the phase 6 Lua command must do after Undo_EndBlock2.
local function find_item_by_guid(guid)
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    if item_guid(item) == guid then
      return item
    end
  end
  return nil
end
local function find_take_by_guid(item, guid)
  for index = 0, reaper.CountTakes(item) - 1 do
    local take = reaper.GetTake(item, index)
    if take_guid(take) == guid then
      return take
    end
  end
  return nil
end
local function add_track(name)
  local index = reaper.CountTracks(0)
  reaper.InsertTrackAtIndex(index, true)
  local track = reaper.GetTrack(0, index)
  reaper.GetSetMediaTrackInfo_String(track, 'P_NAME', name, true)
  return track
end
-- Builds one item with one take (the "target"), the shape the spike starts every test from.
local function add_target_item(track, file, position, length, take_name)
  local item = reaper.AddMediaItemToTrack(track)
  reaper.SetMediaItemInfo_Value(item, 'D_POSITION', position)
  reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', length)
  local take = reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile('media/' .. file))
  reaper.GetSetMediaItemTakeInfo_String(take, 'P_NAME', take_name, true)
  return item, take
end
-- Adds a candidate's source range as a new take, the mechanism Q4 evaluates. Does not call SetActiveTake and does
-- not touch D_LENGTH: this is exactly the sequence the phase 6 Lua command is expected to run.
local function add_candidate_take(item, file, take_name)
  local take = reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile('media/' .. file))
  reaper.GetSetMediaItemTakeInfo_String(take, 'P_NAME', take_name, true)
  return take
end
-- Provenance: namespaced take P_EXT plus the finding id (Q5). Mirrors ADR 0026's item-level key style
-- (narration_utils_<name>) but at take level and with a finding id key.
local function write_provenance(take, finding_id, source_file, range_start, range_end)
  reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_finding_id', finding_id, true)
  reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_source_file', source_file, true)
  reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_source_range', string.format('%.6f|%.6f', range_start, range_end), true)
end
local function read_provenance(take)
  local _, id = reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_finding_id', '', false)
  local _, file = reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_source_file', '', false)
  local _, range = reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_source_range', '', false)
  return id, file, range
end

local ok, err = xpcall(function()
  reaper.Main_OnCommand(40023, 0) -- File: New project
  reaper.GetSetProjectInfo_String(0, 'RENDER_FILE', 'renders', true)
  reaper.Main_SaveProjectEx(0, native(PACK .. '/saved-take-mechanics.rpp'), 0) -- project folder known before media are added
  reaper.GetSetProjectInfo_String(0, 'RECORD_PATH', 'media', true)
  log('version', reaper.GetAppVersion(), 'os', reaper.GetOS())

  -----------------------------------------------------------------------
  section('A. Same-length candidate: active take, undo, redo, provenance')
  -----------------------------------------------------------------------
  -- Give the target item its own undo point before testing "add a take" in isolation. Without this, REAPER
  -- attributes every prior unwrapped script change (track and item creation) to the NEXT Undo_EndBlock2, so
  -- undoing the take-add would also remove the item itself — a real project's items are already saved, so this
  -- reproduces that baseline instead of an artifact of how the spike builds its fixture.
  reaper.Undo_BeginBlock2(0)
  local track_a = add_track('A - same length')
  local item_a, take_a1 = add_target_item(track_a, 'take_a.wav', 0, 3, 'take A (target, active)')
  reaper.Undo_EndBlock2(0, 'Narration Utils: spike setup A', -1)
  local guid_item_a = item_guid(item_a)
  local before_active = reaper.GetActiveTake(item_a)
  local guid_before_active = take_guid(before_active)
  log('before add: CountTakes', reaper.CountTakes(item_a), 'I_CURTAKE', reaper.GetMediaItemInfo_Value(item_a, 'I_CURTAKE'))
  log('before add: active take guid', guid_before_active, 'D_LENGTH', reaper.GetMediaItemInfo_Value(item_a, 'D_LENGTH'))

  reaper.Undo_BeginBlock2(0)
  local candidate_a = add_candidate_take(item_a, 'take_b.wav', 'candidate (same length)')
  write_provenance(candidate_a, 'finding-0001', 'take_b.wav', 0.0, 3.0)
  reaper.Undo_EndBlock2(0, 'Narration Utils: add take (spike A)', -1)
  reaper.UpdateArrange()
  local guid_candidate_a = take_guid(candidate_a)

  local after_active = reaper.GetActiveTake(item_a)
  log('after add: CountTakes', reaper.CountTakes(item_a), 'I_CURTAKE', reaper.GetMediaItemInfo_Value(item_a, 'I_CURTAKE'))
  log('after add: active take guid', take_guid(after_active), 'unchanged from before', take_guid(after_active) == guid_before_active)
  log('after add: D_LENGTH', reaper.GetMediaItemInfo_Value(item_a, 'D_LENGTH'), 'unchanged', reaper.GetMediaItemInfo_Value(item_a, 'D_LENGTH') == 3)
  local id1, file1, range1 = read_provenance(candidate_a)
  log('after add: candidate provenance', id1, file1, range1)
  log('after add: previous active take provenance (should be empty)', read_provenance(before_active))

  reaper.Main_OnCommand(40029, 0) -- Edit: Undo
  -- Undo replaces REAPER's item/take objects project-wide (confirmed by the S0 spike): the old item_a/candidate_a
  -- pointers are stale now, so a probe call on the old pointer is expected to fail, and every read after an undo
  -- or redo must re-resolve by GUID.
  local probe_ok, probe_take_count = pcall(reaper.CountTakes, item_a)
  log('probing the item_a pointer after undo (still valid because item_a had its own undo point before the take-add):', probe_ok, probe_take_count)
  local item_a_after_undo = find_item_by_guid(guid_item_a)
  log(
    'after undo (re-resolved by GUID): CountTakes',
    reaper.CountTakes(item_a_after_undo),
    'active take guid',
    take_guid(reaper.GetActiveTake(item_a_after_undo))
  )

  reaper.Main_OnCommand(40030, 0) -- Edit: Redo
  local item_a_after_redo = find_item_by_guid(guid_item_a)
  local redo_take = find_take_by_guid(item_a_after_redo, guid_candidate_a)
  local id2 = read_provenance(redo_take)
  log(
    'after redo (re-resolved by GUID): CountTakes',
    reaper.CountTakes(item_a_after_redo),
    'active take guid',
    take_guid(reaper.GetActiveTake(item_a_after_redo))
  )
  log('after redo: candidate provenance restored', id2, id2 == 'finding-0001')

  -- Contrast: an explicit SetActiveTake does switch it, proving the earlier "unchanged" result is not just an
  -- accident of the API always leaving I_CURTAKE at 0.
  reaper.SetActiveTake(redo_take)
  log('after explicit SetActiveTake(candidate): I_CURTAKE', reaper.GetMediaItemInfo_Value(item_a_after_redo, 'I_CURTAKE'))
  item_a, candidate_a = item_a_after_redo, redo_take

  -----------------------------------------------------------------------
  section('B. Longer candidate than the target item')
  -----------------------------------------------------------------------
  local track_b = add_track('B - longer candidate')
  local item_b = add_target_item(track_b, 'take_a.wav', 5, 3, 'take A (target, 3s)')
  log('before add: D_LENGTH', reaper.GetMediaItemInfo_Value(item_b, 'D_LENGTH'))
  reaper.Undo_BeginBlock2(0)
  local candidate_b = add_candidate_take(item_b, 'take_long.wav', 'candidate (5s, longer)')
  reaper.Undo_EndBlock2(0, 'Narration Utils: add take (spike B)', -1)
  local source_b = reaper.GetMediaItemTake_Source(candidate_b)
  local length_b, is_qn_b = reaper.GetMediaSourceLength(source_b)
  log('after add: D_LENGTH', reaper.GetMediaItemInfo_Value(item_b, 'D_LENGTH'), 'unchanged', reaper.GetMediaItemInfo_Value(item_b, 'D_LENGTH') == 3)
  log(
    'after add: candidate source file',
    reaper.GetMediaSourceFileName(source_b, ''),
    'source length',
    length_b,
    'is QN',
    is_qn_b,
    'I_CURTAKE (should still be 0, target active)',
    reaper.GetMediaItemInfo_Value(item_b, 'I_CURTAKE')
  )

  -----------------------------------------------------------------------
  section('C. Shorter candidate than the target item')
  -----------------------------------------------------------------------
  local track_c = add_track('C - shorter candidate')
  local item_c = add_target_item(track_c, 'take_a.wav', 10, 3, 'take A (target, 3s)')
  log('before add: D_LENGTH', reaper.GetMediaItemInfo_Value(item_c, 'D_LENGTH'))
  reaper.Undo_BeginBlock2(0)
  local candidate_c = add_candidate_take(item_c, 'take_short.wav', 'candidate (1s, shorter)')
  reaper.Undo_EndBlock2(0, 'Narration Utils: add take (spike C)', -1)
  local source_c = reaper.GetMediaItemTake_Source(candidate_c)
  local length_c, is_qn_c = reaper.GetMediaSourceLength(source_c)
  log('after add: D_LENGTH', reaper.GetMediaItemInfo_Value(item_c, 'D_LENGTH'), 'unchanged', reaper.GetMediaItemInfo_Value(item_c, 'D_LENGTH') == 3)
  log(
    'after add: candidate source file',
    reaper.GetMediaSourceFileName(source_c, ''),
    'source length',
    length_c,
    'is QN',
    is_qn_c,
    'I_CURTAKE (should still be 0, target active)',
    reaper.GetMediaItemInfo_Value(item_c, 'I_CURTAKE')
  )

  -----------------------------------------------------------------------
  section('D. Source-offset alignment to a manuscript span start')
  -----------------------------------------------------------------------
  local track_d = add_track('D - offset alignment')
  local item_d = add_target_item(track_d, 'take_a.wav', 15, 2, 'take A (target, 2s span)')
  reaper.Undo_BeginBlock2(0)
  -- take_aligned.wav is 4s; the matched manuscript span inside it is simulated to start 1.5s in and run 2s,
  -- matching the target item's own length. D_STARTOFFS is the take's read-head into its source.
  local candidate_d = add_candidate_take(item_d, 'take_aligned.wav', 'candidate (offset-aligned)')
  log('before offset set: D_STARTOFFS', reaper.GetMediaItemTakeInfo_Value(candidate_d, 'D_STARTOFFS'))
  reaper.SetMediaItemTakeInfo_Value(candidate_d, 'D_STARTOFFS', 1.5)
  write_provenance(candidate_d, 'finding-0002', 'take_aligned.wav', 1.5, 3.5)
  reaper.Undo_EndBlock2(0, 'Narration Utils: add take (spike D, offset)', -1)
  log('after offset set: D_STARTOFFS', reaper.GetMediaItemTakeInfo_Value(candidate_d, 'D_STARTOFFS'))
  log('item D_LENGTH still the target span, unaffected by offset', reaper.GetMediaItemInfo_Value(item_d, 'D_LENGTH'))

  -----------------------------------------------------------------------
  section('E. Provenance does not collide with item-level line identity (ADR 0026)')
  -----------------------------------------------------------------------
  reaper.GetSetMediaItemInfo_String(item_a, 'P_EXT:narration_utils_line_id', 'line-000001', true)
  local _, line_id = reaper.GetSetMediaItemInfo_String(item_a, 'P_EXT:narration_utils_line_id', '', false)
  local id3 = read_provenance(candidate_a)
  log('item-level line id', line_id, 'take-level provenance still separate', id3)

  -----------------------------------------------------------------------
  section('F. Provenance persists through save and reload')
  -----------------------------------------------------------------------
  local guid_a, guid_candidate_a = item_guid(item_a), take_guid(candidate_a)
  reaper.Main_OnCommand(40182, 0) -- Item: Select all items (irrelevant, keeps focus sane before saving)
  log('save', reaper.Main_SaveProjectEx(0, native(PACK .. '/saved-take-mechanics.rpp'), 0))
  log('reload', reaper.Main_openProject('noprompt:' .. native(PACK .. '/saved-take-mechanics.rpp')))
  -- Undo/redo replaced REAPER's objects; a reload does too. Re-resolve item A and its candidate take by GUID,
  -- exactly as any mutation must (the static project model can go stale).
  local found_item, found_take
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    if item_guid(item) == guid_a then
      found_item = item
      for take_index = 0, reaper.CountTakes(item) - 1 do
        local take = reaper.GetTake(item, take_index)
        if take_guid(take) == guid_candidate_a then
          found_take = take
        end
      end
    end
  end
  log('re-resolved item by GUID after reload', found_item ~= nil)
  log('re-resolved candidate take by GUID after reload', found_take ~= nil)
  if found_take then
    local id4, file4, range4 = read_provenance(found_take)
    log('provenance after reload', id4, file4, range4)
    log('provenance survived reload intact', id4 == 'finding-0001' and file4 == 'take_b.wav' and range4 == '0.000000|3.000000')
  end
  if found_item then
    local _, line_id_after = reaper.GetSetMediaItemInfo_String(found_item, 'P_EXT:narration_utils_line_id', '', false)
    log('item-level line id after reload', line_id_after)
  end
end, debug.traceback)
if not ok then
  log('ERROR', err)
end
finish()
