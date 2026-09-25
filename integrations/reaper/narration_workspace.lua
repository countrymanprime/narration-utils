-- The edit and proof workspace's REAPER actions, over the bridge (edit-and-proof-workspace PRD Phases 6, 8 and 9; the
-- calls are in docs/research/reaper-api-for-planned-commands.md): set_active_take ("Use this take", EP7 A),
-- list_fx_chains (EP8) and apply_fx_chain (EP9 A). Loaded by narration_ui_bridge.lua, which passes the shared helpers as
-- the chunk argument.
--
-- An item and a take are named by GUID; a GUID that does not resolve, a take no longer on the item and a passage the
-- item no longer covers answer ITEM_STALE|run|guid|reason (item, take or range) and change nothing. Nothing changes
-- while REAPER records. An FX chain is named by its path relative to <resource path>/FXChains, with forward slashes,
-- and is resolved here, never taken as a path: it must be a chain list_fx_chains would list. A change is one undo
-- block. None of these calls Main_OnCommand.

local core = ...
local event = core.event

local CHAIN_DEPTH_LIMIT = 4
local CHAIN_COUNT_LIMIT = 500
-- How close to an item's edge a passage edge may fall and still count as the edge (no split there).
local EDGE_EPSILON = 0.0005

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
local function take_guid(take)
  local _, guid = reaper.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
  return normalize_guid(guid)
end
local function recording()
  return math.floor(reaper.GetPlayState() / 4) % 2 == 1
end

-- The item and take a request names, or nil plus the GUID that did not resolve and why.
local function resolve(item_text, take_text)
  local wanted = normalize_guid(item_text)
  local item = nil
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local candidate = reaper.GetMediaItem(0, index)
    if wanted ~= '' and item_guid(candidate) == wanted then
      item = candidate
      break
    end
  end
  if not item then
    return nil, nil, item_text, 'item'
  end
  local wanted_take = normalize_guid(take_text)
  for index = 0, reaper.CountTakes(item) - 1 do
    local take = reaper.GetTake(item, index)
    if take and wanted_take ~= '' and take_guid(take) == wanted_take then
      return item, take
    end
  end
  return nil, nil, take_text, 'take'
end

local function set_active_take(session_dir, run_id, item_text, take_text)
  if not reaper.APIExists('SetActiveTake') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot choose the active take.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local item, take, stale, reason = resolve(item_text, take_text)
  if not item then
    event(session_dir, 'ITEM_STALE', run_id, stale, reason)
    return
  end
  if reaper.GetActiveTake(item) == take then
    event(session_dir, 'ACTIVE_TAKE_SET', run_id, item_guid(item), take_guid(take), 0)
    return
  end
  reaper.Undo_BeginBlock2(0)
  reaper.SetActiveTake(take)
  reaper.UpdateItemInProject(item)
  reaper.Undo_EndBlock2(0, 'Narration Utils: use take', -1)
  reaper.UpdateArrange()
  event(session_dir, 'ACTIVE_TAKE_SET', run_id, item_guid(item), take_guid(take), 1)
end

local function chain_root()
  return core.join(reaper.GetResourcePath(), 'FXChains')
end
local function is_chain(name)
  return name:lower():match('%.rfxchain$') ~= nil
end
-- A folder or file name as the listing gives it: never a separator, never '.' or '..'.
local function plain(name)
  return name ~= '' and name ~= '.' and name ~= '..' and not name:find('[/\\]')
end
local function listing(enumerate, directory)
  enumerate(directory, -1)
  local names, index = {}, 0
  while true do
    local name = enumerate(directory, index)
    if not name or name == '' then
      break
    end
    if plain(name) then
      names[#names + 1] = name
    end
    index = index + 1
  end
  table.sort(names)
  return names
end

-- Every chain under FXChains as a relative name with forward slashes, sorted, at most CHAIN_COUNT_LIMIT and at most
-- CHAIN_DEPTH_LIMIT folders deep; the second value says whether a limit left anything out.
local function list_chains()
  local found, truncated = {}, false
  local function walk(directory, prefix, depth)
    for _, name in ipairs(listing(reaper.EnumerateFiles, directory)) do
      if is_chain(name) then
        found[#found + 1] = prefix .. name
      end
    end
    for _, name in ipairs(listing(reaper.EnumerateSubdirectories, directory)) do
      if depth >= CHAIN_DEPTH_LIMIT then
        truncated = true
      else
        walk(core.join(directory, name), prefix .. name .. '/', depth + 1)
      end
    end
  end
  walk(chain_root(), '', 1)
  table.sort(found)
  if #found > CHAIN_COUNT_LIMIT then
    for index = #found, CHAIN_COUNT_LIMIT + 1, -1 do
      found[index] = nil
    end
    truncated = true
  end
  return found, truncated
end

local function list_fx_chains(session_dir, run_id)
  local found, truncated = list_chains()
  for _, name in ipairs(found) do
    event(session_dir, 'FX_CHAIN', run_id, name)
  end
  event(session_dir, 'FX_CHAINS_LISTED', run_id, #found, truncated and 1 or 0)
end

-- The full path of a chain named relative to FXChains, or nil unless the name is exactly one list_chains lists and its
-- file is there. The listing is the guard: it holds only plain folder and file names found under FXChains, so no '..',
-- drive, absolute path or backslash can equal one of its entries and reach the join.
local function chain_path(name)
  local found = list_chains()
  for _, listed in ipairs(found) do
    if listed == name then
      local path = chain_root()
      for part in name:gmatch('[^/]+') do
        path = core.join(path, part)
      end
      return core.file_exists(path) and path or nil
    end
  end
  return nil
end

local function apply_fx_chain(session_dir, run_id, item_text, take_text, start_text, end_text, name)
  if not reaper.APIExists('TakeFX_AddByName') or not reaper.APIExists('SplitMediaItem') or not reaper.APIExists('TakeFX_GetCount') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot apply an FX chain.')
    return
  end
  local path = chain_path(name)
  if not path then
    event(session_dir, 'ERROR', run_id, 'That FX chain is not in the FXChains folder REAPER lists.')
    return
  end
  local source_start, source_end = tonumber(start_text), tonumber(end_text)
  if not source_start or not source_end or source_end <= source_start then
    event(session_dir, 'ERROR', run_id, 'The passage has no usable time.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local item, take, stale, reason = resolve(item_text, take_text)
  if not item then
    event(session_dir, 'ITEM_STALE', run_id, stale, reason)
    return
  end
  if reaper.GetActiveTake(item) ~= take then
    event(session_dir, 'ERROR', run_id, 'The passage is not on the take that plays.')
    return
  end
  local first = reaper.GetMediaItemInfo_Value(item, 'D_POSITION')
  local last = first + reaper.GetMediaItemInfo_Value(item, 'D_LENGTH')
  local offset = reaper.GetMediaItemTakeInfo_Value(take, 'D_STARTOFFS')
  local rate = reaper.GetMediaItemTakeInfo_Value(take, 'D_PLAYRATE')
  if rate == 0 then
    rate = 1
  end
  local from = first + (source_start - offset) / rate
  local to = first + (source_end - offset) / rate
  if from < first - EDGE_EPSILON or to > last + EDGE_EPSILON then
    event(session_dir, 'ITEM_STALE', run_id, item_guid(item), 'range')
    return
  end
  local label = 'Narration Utils: apply FX chain ' .. name
  reaper.PreventUIRefresh(1)
  reaper.Undo_BeginBlock2(0)
  local middle, splits, failure = item, 0, nil
  if to < last - EDGE_EPSILON then
    if reaper.SplitMediaItem(item, to) then
      splits = splits + 1
    else
      failure = 'REAPER could not split the item.'
    end
  end
  if not failure and from > first + EDGE_EPSILON then
    middle = reaper.SplitMediaItem(item, from)
    if middle then
      splits = splits + 1
    else
      failure = 'REAPER could not split the item.'
    end
  end
  local middle_take, added = nil, 0
  if not failure then
    middle_take = reaper.GetActiveTake(middle)
    local before = reaper.TakeFX_GetCount(middle_take)
    local index = reaper.TakeFX_AddByName(middle_take, path, -1)
    added = reaper.TakeFX_GetCount(middle_take) - before
    if index < 0 or added <= 0 then
      failure = 'REAPER did not load the FX chain.'
    end
  end
  reaper.Undo_EndBlock2(0, label, -1)
  reaper.PreventUIRefresh(-1)
  reaper.UpdateArrange()
  if failure then
    local message = failure
    if splits > 0 then
      message = message .. ' The item was split: press Undo in REAPER to rejoin it.'
    end
    event(session_dir, 'ERROR', run_id, message)
    return
  end
  event(session_dir, 'FX_CHAIN_APPLIED', run_id, name, item_guid(middle), take_guid(middle_take), splits, added)
end

return function(registry)
  registry.register('set_active_take', function(ctx, args)
    set_active_take(ctx.session_dir, args[1] or '', args[2] or '', args[3] or '')
  end)
  registry.register('list_fx_chains', function(ctx, args)
    list_fx_chains(ctx.session_dir, args[1] or '')
  end)
  registry.register('apply_fx_chain', function(ctx, args)
    apply_fx_chain(ctx.session_dir, args[1] or '', args[2] or '', args[3] or '', args[4] or '', args[5] or '', args[6] or '')
  end)
end
