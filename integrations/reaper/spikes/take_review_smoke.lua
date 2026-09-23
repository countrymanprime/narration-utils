-- Take-review phase 6 smoke test: proves the real create_take bridge command (narration_take_review.lua, loaded the
-- same way narration_ui_bridge.lua loads it in production) against a real REAPER 7.80, on a COPY of
-- Challenges_001.rpp (task instruction), directly testing the phase 1 spike's specific warning that undo/redo
-- replace REAPER's item/take Lua objects project-wide. Answers, for the real command (not the fake-reaper harness):
--   (a) the previously active take stays active after create_take
--   (b) the target item's D_LENGTH is unchanged
--   (c) the new take's P_EXT provenance survives an Undo/Redo cycle, re-resolved by GUID afterwards
-- Research tool, not product code. Run by run-reaper.ps1 with -Project pointing at the scratch copy of
-- Challenges_001.rpp (never the original) and -Cfg an isolated resource directory.

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
local REAPER_DIR = assert(os.getenv('NARRATION_UTILS_REAPER_DIR'), 'set NARRATION_UTILS_REAPER_DIR (run-reaper.ps1 does)')
-- The candidate source file, made by make_media.py into the scratch -Out folder before REAPER starts (never a real
-- narration recording): a short synthetic tone, so this smoke test attaches a real, playable file without touching
-- any file under Documents\REAPER Media.
local CANDIDATE_FILE = assert(os.getenv('NARRATION_UTILS_SMOKE_CANDIDATE'), 'set NARRATION_UTILS_SMOKE_CANDIDATE')
-- The target item's own GUID inside the scratch copy of Challenges_001.rpp (known from the project file; this
-- script never searches Documents\REAPER Media, it only reads the already-open, already-copied project).
local TARGET_ITEM_GUID = assert(os.getenv('NARRATION_UTILS_SMOKE_TARGET_GUID'), 'set NARRATION_UTILS_SMOKE_TARGET_GUID')

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
  local handle = io.open(PACK .. '/take-review-smoke-report.txt', 'wb')
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
local function read_provenance(take)
  local _, id = reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_finding_id', '', false)
  local _, file = reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_source_file', '', false)
  local _, range = reaper.GetSetMediaItemTakeInfo_String(take, 'P_EXT:narration_utils_take_source_range', '', false)
  return id, file, range
end

local ok, err = xpcall(function()
  log('version', reaper.GetAppVersion(), 'os', reaper.GetOS())

  -----------------------------------------------------------------------
  section('Setup: locate the real target item in the scratch copy of Challenges_001.rpp')
  -----------------------------------------------------------------------
  local target_item = assert(find_item_by_guid(TARGET_ITEM_GUID), 'target item ' .. TARGET_ITEM_GUID .. ' was not found in the open project')
  local before_active = reaper.GetActiveTake(target_item)
  local guid_before_active = take_guid(before_active)
  local length_before = reaper.GetMediaItemInfo_Value(target_item, 'D_LENGTH')
  local takes_before = reaper.CountTakes(target_item)
  log('target item found; takes before', takes_before, 'D_LENGTH before', length_before, 'active take guid before', guid_before_active)

  -----------------------------------------------------------------------
  section('Load the real narration_take_review.lua create_take command (production code, not a copy)')
  -----------------------------------------------------------------------
  local SEP = package.config:sub(1, 1)
  local core = dofile(REAPER_DIR .. SEP .. 'narration_bridge_core.lua')
  local registry = core.new_registry()
  local chunk = assert(loadfile(core.join(REAPER_DIR, 'narration_take_review.lua')))
  local register = chunk(core)
  register(registry)
  local handler = assert(registry.lookup('create_take'), 'create_take is not registered')
  log('loaded narration_take_review.lua from', REAPER_DIR)

  -----------------------------------------------------------------------
  section('Run create_take exactly as the Go host would: a run id and a payload file path')
  -----------------------------------------------------------------------
  local payload_path = PACK .. SEP .. 'smoke-create-take-request.txt'
  local payload_handle = io.open(payload_path, 'wb')
  -- target_item_guid|candidate_item_guid|source_start|source_end|finding_id|source_file (core.pipe_fields'
  -- convention, source file last since it may contain a character the row's own separator would misparse).
  payload_handle:write(table.concat({ TARGET_ITEM_GUID, '', '0.5', '2.5', 'smoke-finding-0001', CANDIDATE_FILE }, '|') .. '\n')
  payload_handle:close()

  -- The registered handler writes through core.event straight to session_dir/events.log (the same file the Go
  -- host's bridge.Client reads in production), not through a ctx callback: read that file back, the way
  -- bridge.Dispatch would, rather than trusting a Lua callback the real command never calls.
  local events_log_path = PACK .. SEP .. 'events.log'
  os.remove(events_log_path)
  handler({ session_dir = PACK }, { 'smoke-run-1', payload_path })

  local events = {}
  local events_handle = io.open(events_log_path, 'r')
  if events_handle then
    for line in events_handle:lines() do
      events[#events + 1] = core.split(line, 8)
    end
    events_handle:close()
  end

  local outcome = events[1] and events[1][1] or 'NO EVENT'
  log('create_take result event', outcome, events[1] and table.concat(events[1], '|') or '')
  assert(outcome == 'TAKE_CREATED', 'create_take did not report TAKE_CREATED: ' .. tostring(outcome))
  local new_take_guid = events[1][4]

  -----------------------------------------------------------------------
  section('(a) the previously active take stays active')
  -----------------------------------------------------------------------
  local item_after_add = assert(find_item_by_guid(TARGET_ITEM_GUID), 're-resolving the target item by GUID after create_take failed')
  local active_after_add = reaper.GetActiveTake(item_after_add)
  local guid_active_after_add = take_guid(active_after_add)
  local active_unchanged = guid_active_after_add == guid_before_active
  log('active take guid after add', guid_active_after_add, 'unchanged from before', active_unchanged)
  assert(active_unchanged, 'FAIL (a): the previously active take did not stay active')
  log('takes after add', reaper.CountTakes(item_after_add), '(before + 1)', reaper.CountTakes(item_after_add) == takes_before + 1)

  -----------------------------------------------------------------------
  section('(b) the item length is unchanged')
  -----------------------------------------------------------------------
  local length_after_add = reaper.GetMediaItemInfo_Value(item_after_add, 'D_LENGTH')
  local length_unchanged = length_after_add == length_before
  log('D_LENGTH after add', length_after_add, 'unchanged from before', length_unchanged)
  assert(length_unchanged, 'FAIL (b): the item length changed')

  -----------------------------------------------------------------------
  section('(c) the new take P_EXT survives an Undo/Redo cycle, re-resolved by GUID afterwards')
  -----------------------------------------------------------------------
  local new_take_before_undo = assert(find_take_by_guid(item_after_add, new_take_guid), 'the new take could not be found by GUID before undo')
  local id_before, file_before, range_before = read_provenance(new_take_before_undo)
  log('provenance before undo', id_before, file_before, range_before)

  reaper.Main_OnCommand(40029, 0) -- Edit: Undo
  local item_after_undo = find_item_by_guid(TARGET_ITEM_GUID)
  local takes_after_undo = item_after_undo and reaper.CountTakes(item_after_undo) or -1
  log('after undo (re-resolved by GUID): takes', takes_after_undo, '(back to before-add count)', takes_after_undo == takes_before)

  reaper.Main_OnCommand(40030, 0) -- Edit: Redo
  -- The phase 1 spike's warning, tested directly: the pre-undo item_after_add/new_take_before_undo pointers must
  -- never be trusted past this point. Everything below re-resolves by GUID.
  local item_after_redo = assert(find_item_by_guid(TARGET_ITEM_GUID), 're-resolving the target item by GUID after redo failed')
  local take_after_redo = find_take_by_guid(item_after_redo, new_take_guid)
  local reresolved = take_after_redo ~= nil
  log('re-resolved the new take by GUID after redo', reresolved)
  assert(reresolved, 'FAIL (c): the new take could not be re-resolved by GUID after undo/redo')
  local id_after, file_after, range_after = read_provenance(take_after_redo)
  log('provenance after redo (re-resolved by GUID)', id_after, file_after, range_after)
  local provenance_survived = id_after == 'smoke-finding-0001' and file_after == CANDIDATE_FILE and range_after == '0.500000|2.500000'
  log('provenance survived the undo/redo cycle intact', provenance_survived)
  assert(provenance_survived, 'FAIL (c): take provenance did not survive undo/redo')

  local active_after_redo = take_guid(reaper.GetActiveTake(item_after_redo))
  log('active take after redo, still the original', active_after_redo, active_after_redo == guid_before_active)

  -----------------------------------------------------------------------
  section('Result')
  -----------------------------------------------------------------------
  log('ALL OBSERVATIONS PASSED (a) active take preserved, (b) item length unchanged, (c) provenance survives undo/redo re-resolved by GUID')
end, debug.traceback)
if not ok then
  log('ERROR', err)
end
finish()
