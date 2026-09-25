-- Regions for chapters and credits over the bridge: create_regions (the chapter regions of the follow-through PRD's
-- Phase 7, RF-7, and the credits regions of credits-in-chapter-table Phase 4; the calls are in
-- docs/research/reaper-api-for-planned-commands.md). Loaded by narration_ui_bridge.lua, which passes the shared helpers
-- as the chunk argument.
--
-- It replaced create_chapter_regions (manuscript line identity), keeping its payload and behaviour, which the scripted
-- REAPER 7.80 checklist verified: one region per `start|end|title` row (project seconds; the title is last so it may
-- contain pipes), a region that already exists with the same title and bounds within REGION_TOLERANCE is not added
-- again, and every change is one undo block. Credits rows are rows like any other; the host names them.
--
-- New: with the update flag, a row whose title is held by exactly one region with other bounds moves that region
-- (SetProjectMarker4, keeping its number and colour) instead of adding a second one, so re-running after a chapter was
-- re-recorded is safe; a title held by several regions is left alone and counted as ambiguous. A region REAPER refuses
-- to add is counted as failed.
--
-- Answers REGIONS_CREATED|run|created|existing|invalid|updated|ambiguous|failed.

local core = ...
local pipe_fields, event, color = core.pipe_fields, core.event, core.color

local REGION_TOLERANCE = 0.01

local function one_line(value)
  return (tostring(value or ''):gsub('[\r\n]+', ' '))
end

-- Payload rows are `start|end|title`. Returns the valid rows and how many were rejected.
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
    elseif line ~= '' and line ~= '\r' then
      invalid = invalid + 1
    end
  end
  input:close()
  return rows, invalid
end
local function same_bounds(region, first, last)
  return math.abs(region.first - first) <= REGION_TOLERANCE and math.abs(region.last - last) <= REGION_TOLERANCE
end
local function project_regions()
  local regions, index = {}, 0
  while true do
    local next_index, is_region, first, last, name, number = reaper.EnumProjectMarkers3(0, index)
    if next_index == 0 then
      break
    end
    if is_region then
      regions[#regions + 1] = { title = name, first = first, last = last, number = number }
    end
    index = index + 1
  end
  return regions
end

-- Decides what each row needs: nothing (it exists), a move (update flag, one region with the title), nothing because the
-- title is ambiguous, or a new region.
local function plan_regions(rows, update)
  local known = project_regions()
  local plan = { add = {}, move = {}, existing = 0, ambiguous = 0 }
  for _, row in ipairs(rows) do
    local exists, titled = false, {}
    for _, region in ipairs(known) do
      if region.title == row.title then
        exists = exists or same_bounds(region, row.first, row.last)
        titled[#titled + 1] = region
      end
    end
    if exists then
      plan.existing = plan.existing + 1
    elseif update and #titled == 1 then
      plan.move[#plan.move + 1] = { region = titled[1], row = row }
      titled[1].first, titled[1].last = row.first, row.last
    elseif update and #titled > 1 then
      plan.ambiguous = plan.ambiguous + 1
    else
      plan.add[#plan.add + 1] = row
      known[#known + 1] = { title = row.title, first = row.first, last = row.last }
    end
  end
  return plan
end

local function create_regions(session_dir, run_id, path, hex, update)
  if not reaper.APIExists('AddProjectMarker2') or not reaper.APIExists('SetProjectMarker4') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot add regions.')
    return
  end
  local rows, invalid = read_region_payload(path)
  if not rows then
    event(session_dir, 'ERROR', run_id, 'The region list was not found.')
    return
  end
  local plan = plan_regions(rows, update)
  local created, failed = 0, 0
  if #plan.add > 0 or #plan.move > 0 then
    local region_color = (hex or '') ~= '' and color(hex) or 0
    reaper.Undo_BeginBlock2(0)
    for _, row in ipairs(plan.add) do
      if reaper.AddProjectMarker2(0, true, row.first, row.last, row.title, -1, region_color) >= 0 then
        created = created + 1
      else
        failed = failed + 1
      end
    end
    for _, entry in ipairs(plan.move) do
      reaper.SetProjectMarker4(0, entry.region.number, true, entry.row.first, entry.row.last, entry.row.title, 0, 0)
    end
    reaper.Undo_EndBlock2(0, 'Narration Utils: create regions', -1)
    reaper.UpdateArrange()
  end
  event(session_dir, 'REGIONS_CREATED', run_id, created, plan.existing, invalid, #plan.move, plan.ambiguous, failed)
end

return function(registry)
  registry.register('create_regions', function(ctx, args)
    create_regions(ctx.session_dir, args[1] or '', args[2] or '', args[3] or '', args[4] == '1')
  end)
end
