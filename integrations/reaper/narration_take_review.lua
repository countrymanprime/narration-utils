-- Take creation over the bridge: create_take (take-review-pickups-duplicates-take-intelligence.prd.md phase 6, the
-- phase 1 spike docs/research/take-review-spike-p1-take-mechanics.md, and ADR 0098). Loaded by
-- narration_ui_bridge.lua, which passes the shared helpers as the chunk argument.

local core = ...
local event, pipe_fields = core.event, core.pipe_fields

-- Namespaced take extension data (ADR 0098, extending ADR 0026 to take granularity): which finding produced this
-- take, the candidate's source file, and the matched source range within it. Never item notes or take names.
local FINDING_ID_KEY = 'P_EXT:narration_utils_take_finding_id'
local SOURCE_FILE_KEY = 'P_EXT:narration_utils_take_source_file'
local SOURCE_RANGE_KEY = 'P_EXT:narration_utils_take_source_range'

local function normalize_guid(guid)
  local bare = tostring(guid or ''):gsub('[{}%s]', ''):upper()
  if bare == '' then
    return ''
  end
  return '{' .. bare .. '}'
end
local function item_guid(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
  return normalize_guid(guid)
end
local function items_by_guid()
  local map = {}
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    map[item_guid(item)] = item
  end
  return map
end
local function take_guid(take)
  local _, guid = reaper.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
  return normalize_guid(guid)
end
local function find_take_by_guid(item, guid)
  for index = 0, reaper.CountTakes(item) - 1 do
    local take = reaper.GetTake(item, index)
    if take and take_guid(take) == guid then
      return take
    end
  end
  return nil
end

-- The bridge's wire protocol caps a command at a handful of positional fields (narration_bridge_core.lua's split,
-- count 8: protocol version, command name, then 6 argument fields with the last one free to contain a literal
-- pipe). create_take needs six values of its own, so - like stamp_item_lines and create_chapter_regions - the
-- narrator-facing fields travel in a one-row payload file and the command itself takes only a run id and that
-- file's path. The row is `target_item_guid|candidate_item_guid|source_start|source_end|finding_id|source_file`;
-- source_file is last because it is the field most likely to contain an unusual character.
local function read_create_take_payload(path)
  local input = io.open(path, 'r')
  if not input then
    return nil
  end
  local line = (input:read('*l') or ''):gsub('\r$', '')
  input:close()
  local fields = pipe_fields(line, 6)
  return {
    target_guid = fields[1] or '',
    candidate_guid = fields[2] or '',
    source_start = fields[3] or '',
    source_end = fields[4] or '',
    finding_id = fields[5] or '',
    source_file = fields[6] or '',
  }
end

-- Adds one candidate source range as a new take on the target item (Q4): AddTakeToMediaItem, set source, align
-- D_STARTOFFS to the matched span's start inside the candidate's own source, write the three provenance keys (Q5),
-- all inside one Undo_BeginBlock2/Undo_EndBlock2 block. Never calls SetActiveTake (the previously active take stays
-- active - nothing asks it to switch) and never touches the item's D_LENGTH, matching the spike's observations.
-- Undo and redo replace REAPER's item/take Lua objects project-wide (the spike's warning), so this re-resolves the
-- target item and the new take by GUID after Undo_EndBlock2 rather than trusting the pre-add pointers.
-- candidate_guid is an optional extra staleness check (empty string skips it): when the candidate's own source
-- also names a live project item, that item must still exist too, or the scan this finding came from is out of date.
local function create_take(session_dir, run_id, payload_path)
  if not reaper.APIExists('AddTakeToMediaItem') or not reaper.APIExists('GetSetMediaItemTakeInfo_String') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot add takes.')
    return
  end
  local payload = read_create_take_payload(payload_path)
  if not payload then
    event(session_dir, 'ERROR', run_id, 'The take-creation request was not found.')
    return
  end
  local normalized_target = normalize_guid(payload.target_guid)
  local items = items_by_guid()
  local target_item = items[normalized_target]
  if not target_item then
    event(session_dir, 'TAKE_STALE', run_id, payload.target_guid)
    return
  end
  local normalized_candidate = normalize_guid(payload.candidate_guid)
  if normalized_candidate ~= '' and not items[normalized_candidate] then
    event(session_dir, 'TAKE_STALE', run_id, payload.candidate_guid)
    return
  end
  if not core.file_exists(payload.source_file) then
    event(session_dir, 'ERROR', run_id, 'The candidate source file was not found.')
    return
  end
  local start = tonumber(payload.source_start) or 0
  local stop = tonumber(payload.source_end) or start

  reaper.Undo_BeginBlock2(0)
  local take = reaper.AddTakeToMediaItem(target_item)
  local source = reaper.PCM_Source_CreateFromFile(payload.source_file)
  reaper.SetMediaItemTake_Source(take, source)
  reaper.SetMediaItemTakeInfo_Value(take, 'D_STARTOFFS', start)
  reaper.GetSetMediaItemTakeInfo_String(take, FINDING_ID_KEY, payload.finding_id, true)
  reaper.GetSetMediaItemTakeInfo_String(take, SOURCE_FILE_KEY, payload.source_file, true)
  reaper.GetSetMediaItemTakeInfo_String(take, SOURCE_RANGE_KEY, string.format('%.6f|%.6f', start, stop), true)
  local new_take_guid = take_guid(take)
  reaper.Undo_EndBlock2(0, 'Narration Utils: add take', -1)
  reaper.UpdateArrange()

  local resolved_item = items_by_guid()[normalized_target]
  if not resolved_item or not find_take_by_guid(resolved_item, new_take_guid) then
    event(session_dir, 'ERROR', run_id, 'The take was created but could not be re-resolved by GUID.')
    return
  end
  event(session_dir, 'TAKE_CREATED', run_id, normalized_target, new_take_guid)
end

return function(registry)
  registry.register('create_take', function(ctx, args)
    create_take(ctx.session_dir, args[1] or '', args[2] or '')
  end)
end
