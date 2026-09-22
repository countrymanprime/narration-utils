-- Pickup list over the bridge: import_pickups, export_pickups, next_pickup, resolve_pickup and count_pickups (see
-- docs/architecture/reaper-bridge.md). Loaded by narration_ui_bridge.lua, which passes the shared helpers as the
-- chunk argument. This PRD owns the pickup marker convention (Open Question 6); the take-review PRD only consumes
-- the markers it creates.
--
-- A pickup is a project marker named `PICKUP: <body>` while open and `PICKUP_DONE: <body>` once resolved, reusing
-- the `PREFIX:` naming convention (narration_compare.lua's marker_kind, duplicated below so this file stays a
-- self-contained feature). `<body>` is the note, or `[tag] note` when the payload row carried a tag, so export can
-- round-trip a pickup through one marker name with no second file (Open Question 5: generic CSV first - start
-- time, note, optional tag). A note that itself starts with a bracketed prefix is not distinguishable from a tag;
-- an accepted limit of the MVP format.

local core = ...
local pipe_fields, event = core.pipe_fields, core.event

-- Matches the compare export's duplicate window (narration_compare.lua), so "already there" means the same thing
-- across every marker-based feature.
local PICKUP_TOLERANCE = 0.15

local function one_line(value)
  return (tostring(value or ''):gsub('[\r\n]+', ' '))
end

local function marker_kind(name)
  local prefix = tostring(name or ''):match('^%s*([%a_]+)%s*:')
  return prefix and prefix:upper() or ''
end
local function marker_body(name)
  return (tostring(name or ''):match('^%s*[%a_]+%s*:%s*(.*)$')) or ''
end

local function pickup_body(tag, note)
  if tag ~= '' then
    return '[' .. tag .. '] ' .. note
  end
  return note
end
local function split_pickup_body(body)
  local tag, note = body:match('^%[(.-)%]%s(.*)$')
  if tag then
    return tag, note
  end
  return '', body
end

-- Every non-region project marker, in enumeration order.
local function project_markers()
  local markers, index = {}, 0
  while true do
    local next_index, is_region, pos, rgnend, name, idnum = reaper.EnumProjectMarkers3(0, index)
    if next_index == 0 then
      break
    end
    if not is_region then
      markers[#markers + 1] = { pos = pos, rgnend = rgnend, name = name, idnum = idnum }
    end
    index = index + 1
  end
  return markers
end

-- Payload rows are `start|tag|note`; the note is last so it may contain pipes. A row needs a finite, non-negative
-- start and a non-empty note; anything else is invalid and skipped (Go already validates before writing this file,
-- but the row is never trusted here either).
local function read_pickup_payload(path)
  local input = io.open(path, 'r')
  if not input then
    return nil, 0
  end
  local rows, invalid = {}, 0
  for line in input:lines() do
    local fields = pipe_fields((line:gsub('\r$', '')), 3)
    local start, tag, note = tonumber(fields[1]), fields[2] or '', one_line(fields[3])
    if start and start == start and start >= 0 and start < math.huge and note ~= '' then
      rows[#rows + 1] = { start = start, tag = tag, note = note }
    elseif line ~= '' then
      invalid = invalid + 1
    end
  end
  input:close()
  return rows, invalid
end

-- True when a pickup already exists at this time with this body, open or already resolved, so re-importing a
-- proofer's list is safe whether or not the narrator has worked through some of it since.
local function pickup_exists(markers, start, body)
  for _, marker in ipairs(markers) do
    local kind = marker_kind(marker.name)
    if (kind == 'PICKUP' or kind == 'PICKUP_DONE') and math.abs(marker.pos - start) <= PICKUP_TOLERANCE and marker_body(marker.name) == body then
      return true
    end
  end
  return false
end

local function plan_import(rows, markers)
  local pending, existing_count = {}, 0
  for _, row in ipairs(rows) do
    local body = pickup_body(row.tag, row.note)
    if pickup_exists(markers, row.start, body) then
      existing_count = existing_count + 1
    else
      pending[#pending + 1] = { start = row.start, body = body }
      markers[#markers + 1] = { pos = row.start, name = 'PICKUP: ' .. body }
    end
  end
  return pending, existing_count
end

-- Adds one `PICKUP:` marker per new row, in one undo step; a row that duplicates an existing pickup (open or
-- resolved) is skipped, so importing the same list twice adds nothing the second time.
local function import_pickups(session_dir, run_id, path)
  if not reaper.APIExists('AddProjectMarker2') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot add markers.')
    return
  end
  local rows, invalid = read_pickup_payload(path)
  if not rows then
    event(session_dir, 'ERROR', run_id, 'The pickup list was not found.')
    return
  end
  local pending, existing_count = plan_import(rows, project_markers())
  if #pending > 0 then
    reaper.Undo_BeginBlock2(0)
    for _, row in ipairs(pending) do
      reaper.AddProjectMarker2(0, false, row.start, 0, 'PICKUP: ' .. row.body, -1, 0)
    end
    reaper.Undo_EndBlock2(0, 'Narration Utils: import pickups', -1)
    reaper.UpdateArrange()
  end
  event(session_dir, 'PICKUPS_IMPORTED', run_id, #pending, existing_count, invalid)
end

-- Writes every open (`PICKUP:`) marker as `start|tag|note` to a file, in the same shape import_pickups reads, so
-- export then import round-trips. Resolved pickups are left out: this is "the remaining list" (user flow step 4).
-- Read-only.
local function export_pickups(session_dir, run_id, path)
  local output = io.open(path, 'w')
  if not output then
    event(session_dir, 'ERROR', run_id, 'Could not write the pickup list.')
    return
  end
  local count = 0
  for _, marker in ipairs(project_markers()) do
    if marker_kind(marker.name) == 'PICKUP' then
      local tag, note = split_pickup_body(marker_body(marker.name))
      output:write(string.format('%.6f|%s|%s\n', marker.pos, tag, note))
      count = count + 1
    end
  end
  output:close()
  event(session_dir, 'PICKUPS_EXPORTED', run_id, path, count)
end

-- Moves the edit cursor to the nearest open pickup after the cursor, wrapping to the earliest one when the cursor
-- is at or past every pickup, so pressing "Next pickup" keeps working once the narrator revisits an earlier spot.
local function next_pickup(session_dir, run_id)
  local pickups = {}
  for _, marker in ipairs(project_markers()) do
    if marker_kind(marker.name) == 'PICKUP' then
      pickups[#pickups + 1] = marker
    end
  end
  if #pickups == 0 then
    event(session_dir, 'ERROR', run_id, 'No pickups remain.')
    return
  end
  table.sort(pickups, function(a, b)
    return a.pos < b.pos
  end)
  local cursor, chosen = reaper.GetCursorPosition(), nil
  for _, marker in ipairs(pickups) do
    if marker.pos > cursor then
      chosen = marker
      break
    end
  end
  chosen = chosen or pickups[1]
  reaper.SetEditCurPos(chosen.pos, true, false)
  reaper.UpdateArrange()
  local tag, note = split_pickup_body(marker_body(chosen.name))
  event(session_dir, 'PICKUP_NEXT', run_id, chosen.pos, tag, note)
end

-- Renames the open pickup nearest `position` (within the duplicate tolerance) to `PICKUP_DONE:`, keeping its body,
-- in one undo step. An already-resolved pickup at that position is not an open pickup, so resolving it again finds
-- no match: resolve_pickup is idempotent the same way import_pickups is.
local function resolve_pickup(session_dir, run_id, position_arg)
  if not reaper.APIExists('SetProjectMarker3') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot rename markers.')
    return
  end
  local target = tonumber(position_arg)
  if not target then
    event(session_dir, 'ERROR', run_id, 'Send a pickup position to resolve.')
    return
  end
  local best, best_gap = nil, nil
  for _, marker in ipairs(project_markers()) do
    if marker_kind(marker.name) == 'PICKUP' then
      local gap = math.abs(marker.pos - target)
      if gap <= PICKUP_TOLERANCE and (not best_gap or gap < best_gap) then
        best, best_gap = marker, gap
      end
    end
  end
  if not best then
    event(session_dir, 'ERROR', run_id, 'No open pickup was found at that position.')
    return
  end
  local body = marker_body(best.name)
  reaper.Undo_BeginBlock2(0)
  reaper.SetProjectMarker3(0, best.idnum, false, best.pos, best.rgnend or 0, 'PICKUP_DONE: ' .. body, 0)
  reaper.Undo_EndBlock2(0, 'Narration Utils: resolve pickup', -1)
  reaper.UpdateArrange()
  local tag, note = split_pickup_body(body)
  event(session_dir, 'PICKUP_RESOLVED', run_id, best.pos, tag, note)
end

-- Reports remaining (`PICKUP:`) versus total (`PICKUP:` plus `PICKUP_DONE:`) pickups. Read-only.
local function count_pickups(session_dir, run_id)
  local remaining, total = 0, 0
  for _, marker in ipairs(project_markers()) do
    local kind = marker_kind(marker.name)
    if kind == 'PICKUP' then
      remaining, total = remaining + 1, total + 1
    elseif kind == 'PICKUP_DONE' then
      total = total + 1
    end
  end
  event(session_dir, 'PICKUPS_COUNTED', run_id, remaining, total)
end

return function(registry)
  registry.register('import_pickups', function(ctx, args)
    import_pickups(ctx.session_dir, args[1] or '', args[2] or '')
  end)
  registry.register('export_pickups', function(ctx, args)
    export_pickups(ctx.session_dir, args[1] or '', args[2] or '')
  end)
  registry.register('next_pickup', function(ctx, args)
    next_pickup(ctx.session_dir, args[1] or '')
  end)
  registry.register('resolve_pickup', function(ctx, args)
    resolve_pickup(ctx.session_dir, args[1] or '', args[2] or '')
  end)
  registry.register('count_pickups', function(ctx, args)
    count_pickups(ctx.session_dir, args[1] or '')
  end)
end
