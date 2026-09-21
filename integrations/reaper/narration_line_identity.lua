-- Manuscript line identity over the bridge: stamp_item_lines, read_line_ids and create_chapter_regions (see
-- docs/architecture/manuscript-line-identity.md). Loaded by narration_ui_bridge.lua, which passes the shared helpers
-- as the chunk argument.

local core = ...
local pipe_fields, event, color = core.pipe_fields, core.event, core.color

-- Manuscript line identity lives in the project itself, as namespaced item
-- extension data, so it survives moves, splits and copies. Nothing below
-- touches item notes or take names: those belong to the narrator.
local LINE_ID_KEY = 'P_EXT:narration_utils_line_id'
local LINE_TEXT_KEY = 'P_EXT:narration_utils_line_text'
local UNRESOLVED_EVENT_LIMIT = 50
local REGION_TOLERANCE = 0.01

local function normalize_guid(guid)
  local bare = tostring(guid or ''):gsub('[{}%s]', ''):upper()
  if bare == '' then
    return ''
  end
  return '{' .. bare .. '}'
end
local function one_line(value)
  return (tostring(value or ''):gsub('[\r\n]+', ' '))
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
local function ext_value(item, key)
  local ok, value = reaper.GetSetMediaItemInfo_String(item, key, '', false)
  return ok and value or ''
end
local function report_unresolved(session_dir, tag, run_id, guids)
  for index = 1, math.min(#guids, UNRESOLVED_EVENT_LIMIT) do
    event(session_dir, tag, run_id, guids[index])
  end
end

-- Payload rows are `item_guid|line_id|line_text`; the text is last so it may
-- contain pipes. Rows without a GUID or line ID are ignored.
local function read_stamp_payload(path)
  local input = io.open(path, 'r')
  if not input then
    return nil
  end
  local rows = {}
  for line in input:lines() do
    local fields = pipe_fields((line:gsub('\r$', '')), 3)
    local guid = normalize_guid(fields[1])
    if guid ~= '' and (fields[2] or '') ~= '' then
      rows[#rows + 1] = { guid = guid, id = fields[2], text = one_line(fields[3]) }
    end
  end
  input:close()
  return rows
end

local function plan_stamps(rows, items, overwrite)
  local plan = { apply = {}, unchanged = 0, missing = {}, conflicts = {} }
  for _, row in ipairs(rows) do
    local item = items[row.guid]
    if not item then
      plan.missing[#plan.missing + 1] = row.guid
    else
      local current = ext_value(item, LINE_ID_KEY)
      if current == row.id and ext_value(item, LINE_TEXT_KEY) == row.text then
        plan.unchanged = plan.unchanged + 1
      elseif current ~= '' and current ~= row.id and not overwrite then
        plan.conflicts[#plan.conflicts + 1] = row.guid
      else
        plan.apply[#plan.apply + 1] = { item = item, row = row }
      end
    end
  end
  return plan
end

-- Stamps manuscript line IDs onto items by GUID. An item that already carries
-- a different line ID is reported as a conflict and left alone unless the
-- narrator explicitly asked to overwrite. A GUID that no longer resolves is
-- reported as stale; no adjacent item is ever used in its place.
local function stamp_item_lines(session_dir, run_id, path, overwrite)
  if not reaper.APIExists('GetSetMediaItemInfo_String') then
    event(session_dir, 'ERROR', 'This REAPER version cannot store item extension data.')
    return
  end
  local rows = read_stamp_payload(path)
  if not rows then
    event(session_dir, 'ERROR', 'The manuscript line list was not found.')
    return
  end
  local plan = plan_stamps(rows, items_by_guid(), overwrite)
  if #plan.apply > 0 then
    reaper.Undo_BeginBlock2(0)
    for _, entry in ipairs(plan.apply) do
      reaper.GetSetMediaItemInfo_String(entry.item, LINE_ID_KEY, entry.row.id, true)
      reaper.GetSetMediaItemInfo_String(entry.item, LINE_TEXT_KEY, entry.row.text, true)
    end
    reaper.Undo_EndBlock2(0, 'Narration Utils: stamp manuscript line IDs', -1)
    reaper.UpdateArrange()
  end
  report_unresolved(session_dir, 'LINES_STALE', run_id, plan.missing)
  report_unresolved(session_dir, 'LINES_CONFLICT', run_id, plan.conflicts)
  event(session_dir, 'LINES_STAMPED', run_id, #plan.apply, plan.unchanged, #plan.missing, #plan.conflicts)
end

-- Writes every stamped item as `item_guid|line_id|position|length|line_text`
-- to a file, so the host reads identity through the REAPER API instead of
-- depending on how the project file happens to store it. Read-only.
local function read_line_ids(session_dir, run_id, path)
  local output = io.open(path, 'w')
  if not output then
    event(session_dir, 'ERROR', 'Could not write the manuscript line report.')
    return
  end
  local count = 0
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    local line_id = ext_value(item, LINE_ID_KEY)
    if line_id ~= '' then
      output:write(
        string.format(
          '%s|%s|%.6f|%.6f|%s\n',
          item_guid(item),
          line_id,
          reaper.GetMediaItemInfo_Value(item, 'D_POSITION'),
          reaper.GetMediaItemInfo_Value(item, 'D_LENGTH'),
          one_line(ext_value(item, LINE_TEXT_KEY))
        )
      )
      count = count + 1
    end
  end
  output:close()
  event(session_dir, 'LINES_READ', run_id, path, count)
end

-- Payload rows are `start|end|title` in project seconds; the title is last so
-- it may contain pipes. Returns the valid rows and how many were rejected.
local function read_region_payload(path)
  local input = io.open(path, 'r')
  if not input then
    return nil, 0
  end
  local rows, invalid = {}, 0
  for line in input:lines() do
    local fields = pipe_fields((line:gsub('\r$', '')), 3)
    local first, last, title = tonumber(fields[1]), tonumber(fields[2]), one_line(fields[3])
    if first and last and first >= 0 and last > first and title ~= '' then
      rows[#rows + 1] = { first = first, last = last, title = title }
    elseif line ~= '' then
      invalid = invalid + 1
    end
  end
  input:close()
  return rows, invalid
end
local function same_region(region, title, first, last)
  return region.title == title and math.abs(region.first - first) <= REGION_TOLERANCE and math.abs(region.last - last) <= REGION_TOLERANCE
end
local function project_regions()
  local regions, index = {}, 0
  while true do
    local next_index, is_region, first, last, name = reaper.EnumProjectMarkers3(0, index)
    if next_index == 0 then
      break
    end
    if is_region then
      regions[#regions + 1] = { title = name, first = first, last = last }
    end
    index = index + 1
  end
  return regions
end

-- Creates one region per payload row, skipping any that already exist (same
-- title and bounds within a hundredth of a second), so re-running is safe.
local function create_chapter_regions(session_dir, run_id, path, hex)
  if not reaper.APIExists('AddProjectMarker2') then
    event(session_dir, 'ERROR', 'This REAPER version cannot add regions.')
    return
  end
  local rows, invalid = read_region_payload(path)
  if not rows then
    event(session_dir, 'ERROR', 'The chapter region list was not found.')
    return
  end
  local known, pending, existing_count = project_regions(), {}, 0
  for _, row in ipairs(rows) do
    local found = false
    for _, region in ipairs(known) do
      found = found or same_region(region, row.title, row.first, row.last)
    end
    if found then
      existing_count = existing_count + 1
    else
      pending[#pending + 1] = row
      known[#known + 1] = { title = row.title, first = row.first, last = row.last }
    end
  end
  if #pending > 0 then
    local region_color = (hex or '') ~= '' and color(hex) or 0
    reaper.Undo_BeginBlock2(0)
    for _, row in ipairs(pending) do
      reaper.AddProjectMarker2(0, true, row.first, row.last, row.title, -1, region_color)
    end
    reaper.Undo_EndBlock2(0, 'Narration Utils: create chapter regions', -1)
    reaper.UpdateArrange()
  end
  event(session_dir, 'REGIONS_CREATED', run_id, #pending, existing_count, invalid)
end

return function(registry)
  registry.register('stamp_item_lines', function(ctx, args)
    stamp_item_lines(ctx.session_dir, args[1] or '', args[2] or '', args[3] == '1')
  end)
  registry.register('read_line_ids', function(ctx, args)
    read_line_ids(ctx.session_dir, args[1] or '', args[2] or '')
  end)
  registry.register('create_chapter_regions', function(ctx, args)
    create_chapter_regions(ctx.session_dir, args[1] or '', args[2] or '', args[3] or '')
  end)
end
