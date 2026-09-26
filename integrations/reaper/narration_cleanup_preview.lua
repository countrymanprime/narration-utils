-- Preview markers and approve-to-apply trims for silence cleanup candidates (diagnostics-delivery-and-cleanup-tools
-- PRD Phase 10, ADR 0251). A candidate is `measure.CleanupCandidate` (ADR 0238) mapped onto a live item by the host
-- (apps/desktop/internal/cleanupmap): item and take GUID, a class, and a cut range in source-file seconds - the same
-- units and the same source-to-project mapping narration_navigation.lua's project_time already uses, so a candidate
-- stays correctly placed even if the item moved on the timeline since the host last read the project.
--
-- preview_cleanup_markers only adds take markers (one at the cut's start, one at its end, both named for the
-- candidate's class and finding id so a repeat call and Transcript Compare's own markers never collide or double);
-- nothing here ever changes an item's content. apply_cleanup_trims removes the marked span: it splits the item at the
-- cut's start and end and deletes the middle piece with DeleteTrackMediaItem, which only forgets the item's reference
-- to that stretch of the take - the source file on disk is never rendered, trimmed or deleted, so approving a mistake
-- is undone like any other REAPER edit. Every row in a payload is wrapped in one undo block, so approving a whole
-- batch or one candidate at a time is always one Undo away; it opens no block, and touches nothing, when every row is
-- stale. A candidate whose item, take or cut range no longer resolves is reported as CLEANUP_STALE and skipped - it
-- never falls back to a neighbouring item, matching narration_navigation.lua's own rule.
--
-- Every row is resolved and reported (CLEANUP_STALE or added to the plan) in the order the payload gave it, so a
-- caller sees results in the order it asked; only the plan apply_cleanup_trims then executes is re-sorted, by
-- descending cut-start, because a split only ever shortens an item from its right edge and gives the removed stretch
-- a new GUID: applying the right-most cut on an item first keeps that item's own GUID naming its left-most remaining
-- part, so it stays valid for every candidate still to its left in the same call, however many of that item's
-- candidates are in the batch.

local core = ...
local pipe_fields, event = core.pipe_fields, core.event

local UNDO_APPLY_TRIMS = 'Narration Utils: apply cleanup trim'
-- How far outside an item's bounds a cut may fall and still count as inside it (float rounding of position maths),
-- matching narration_navigation.lua's own EDGE_TOLERANCE.
local EDGE_TOLERANCE = 0.000001

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
local function find_item(guid)
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    if item_guid(item) == guid then
      return item
    end
  end
  return nil
end
local function find_take(item, guid)
  for index = 0, reaper.CountTakes(item) - 1 do
    local take = reaper.GetTake(item, index)
    if take and take_guid(take) == guid then
      return take
    end
  end
  return nil
end

-- Resolves a candidate's item and take (the named one, or the active one when no take GUID was given), or nil plus
-- the GUID that did not resolve and why ('item' or 'take'), exactly like narration_navigation.lua's own resolve.
local function resolve(item_text, take_text)
  local wanted_item = normalize_guid(item_text)
  local item = wanted_item ~= '' and find_item(wanted_item) or nil
  if not item then
    return nil, nil, item_text, 'item'
  end
  local wanted_take = normalize_guid(take_text)
  if wanted_take == '' then
    return item, reaper.GetActiveTake(item)
  end
  local take = find_take(item, wanted_take)
  if not take then
    return nil, nil, take_text, 'take'
  end
  return item, take
end

local function bounds(item)
  local first = reaper.GetMediaItemInfo_Value(item, 'D_POSITION')
  return first, first + reaper.GetMediaItemInfo_Value(item, 'D_LENGTH')
end

-- Where a source time of the take is on the timeline now, the same mapping narration_navigation.lua uses.
local function project_time(item, take, source_time)
  local offset = reaper.GetMediaItemTakeInfo_Value(take, 'D_STARTOFFS')
  local rate = reaper.GetMediaItemTakeInfo_Value(take, 'D_PLAYRATE')
  if rate == 0 then
    rate = 1
  end
  return reaper.GetMediaItemInfo_Value(item, 'D_POSITION') + (source_time - offset) / rate
end

local function recording()
  return math.floor(reaper.GetPlayState() / 4) % 2 == 1
end

-- Payload rows are `item_guid|take_guid|class|cut_start|cut_end|finding_id` (take_guid empty means the active take);
-- a row that is not well-formed is dropped rather than guessed at.
local function read_payload(path)
  local input = io.open(path, 'r')
  if not input then
    return nil
  end
  local rows = {}
  for line in input:lines() do
    local fields = pipe_fields((line:gsub('\r$', '')), 6)
    local item_text, take_text, class, start_text, end_text, finding_id = fields[1], fields[2], fields[3], fields[4], fields[5], fields[6]
    local cut_start, cut_end = tonumber(start_text), tonumber(end_text)
    if (item_text or '') ~= '' and (finding_id or '') ~= '' and cut_start and cut_end and cut_end > cut_start then
      rows[#rows + 1] =
        { item_text = item_text, take_text = take_text or '', class = class or '', cut_start = cut_start, cut_end = cut_end, finding_id = finding_id }
    end
  end
  input:close()
  return rows
end

-- Resolves a row to its item, take and the cut's current project-time bounds, or reports it CLEANUP_STALE and
-- returns nil. `first`/`last` are the item's own bounds, checked against EDGE_TOLERANCE like navigate_item.
local function resolve_cut(session_dir, run_id, row)
  local item, take, stale_guid, reason = resolve(row.item_text, row.take_text)
  if not item then
    event(session_dir, 'CLEANUP_STALE', run_id, row.finding_id, stale_guid, reason)
    return nil
  end
  if not take then
    event(session_dir, 'CLEANUP_STALE', run_id, row.finding_id, row.item_text, 'take')
    return nil
  end
  local first, last = bounds(item)
  local cut_start = project_time(item, take, row.cut_start)
  local cut_end = project_time(item, take, row.cut_end)
  if cut_start < first - EDGE_TOLERANCE or cut_end > last + EDGE_TOLERANCE then
    event(session_dir, 'CLEANUP_STALE', run_id, row.finding_id, row.item_text, 'range')
    return nil
  end
  return item, take, math.max(cut_start, first), math.min(cut_end, last)
end

local function preview_cleanup_markers(session_dir, run_id, path)
  if not reaper.APIExists('SetTakeMarker') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot add take markers.')
    return
  end
  local rows = read_payload(path)
  if not rows then
    event(session_dir, 'ERROR', run_id, 'The cleanup candidate list was not found.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local added, existing = 0, 0
  local marks = {}
  for _, row in ipairs(rows) do
    local item, take = resolve_cut(session_dir, run_id, row)
    if item then
      local kind_prefix = 'CLEANUP_' .. row.class:upper()
      marks[#marks + 1] = { take = take, kind = kind_prefix .. '_START', at = row.cut_start, name = string.format('%s_START: %s', kind_prefix, row.finding_id) }
      marks[#marks + 1] = { take = take, kind = kind_prefix .. '_END', at = row.cut_end, name = string.format('%s_END: %s', kind_prefix, row.finding_id) }
    end
  end
  local opened = false
  for _, mark in ipairs(marks) do
    if core.existing_take_marker(mark.take, mark.kind, mark.at) then
      existing = existing + 1
    else
      if not opened then
        reaper.Undo_BeginBlock2(0)
        opened = true
      end
      reaper.SetTakeMarker(mark.take, -1, mark.name, mark.at, 0)
      added = added + 1
    end
  end
  if opened then
    reaper.Undo_EndBlock2(0, 'Narration Utils: preview cleanup markers', -1)
    reaper.UpdateArrange()
  end
  event(session_dir, 'CLEANUP_PREVIEWED', run_id, added, existing)
end

local function apply_cleanup_trims(session_dir, run_id, path)
  local rows = read_payload(path)
  if not rows then
    event(session_dir, 'ERROR', run_id, 'The cleanup candidate list was not found.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local applied = 0
  local plan = {}
  for _, row in ipairs(rows) do
    local item, _, cut_start, cut_end = resolve_cut(session_dir, run_id, row)
    if item then
      plan[#plan + 1] = { item = item, cut_start = cut_start, cut_end = cut_end }
    end
  end
  -- See this file's header: only the execution order changes, so a split never invalidates a not-yet-applied
  -- candidate still to its left on the same item.
  table.sort(plan, function(a, b)
    return a.cut_start > b.cut_start
  end)
  if #plan > 0 then
    reaper.Undo_BeginBlock2(0)
    for _, cut in ipairs(plan) do
      local right = reaper.SplitMediaItem(cut.item, cut.cut_start)
      if right then
        local track = reaper.GetMediaItem_Track(cut.item)
        reaper.SplitMediaItem(right, cut.cut_end)
        reaper.DeleteTrackMediaItem(track, right)
        applied = applied + 1
      end
    end
    reaper.Undo_EndBlock2(0, UNDO_APPLY_TRIMS, -1)
    reaper.UpdateArrange()
  end
  event(session_dir, 'CLEANUP_APPLIED', run_id, applied)
end

return function(registry)
  registry.register('preview_cleanup_markers', function(ctx, args)
    preview_cleanup_markers(ctx.session_dir, args[1] or '', args[2] or '')
  end)
  registry.register('apply_cleanup_trims', function(ctx, args)
    apply_cleanup_trims(ctx.session_dir, args[1] or '', args[2] or '')
  end)
end
