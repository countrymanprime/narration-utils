-- File-session adapter for the React-owned Narration Utils workspace.
-- No UI lives here: this module only reads REAPER selection state, applies
-- take markers, and moves the edit cursor on commands from the Python host.

local M = {}
local SEP = package.config:sub(1, 1)
local function join(base, child)
  return base .. SEP .. child
end

local function encode(value)
  return tostring(value or ''):gsub('[^%w%-_%.~]', function(c)
    return string.format('%%%02X', string.byte(c))
  end)
end
local function decode(value)
  return (tostring(value or ''):gsub('%%(%x%x)', function(hex)
    return string.char(tonumber(hex, 16))
  end))
end
local function split(line, count)
  local fields, start = {}, 1
  while #fields < count - 1 do
    local at = line:find('|', start, true)
    if not at then
      break
    end
    fields[#fields + 1], start = decode(line:sub(start, at - 1)), at + 1
  end
  fields[#fields + 1] = decode(line:sub(start):gsub('[\r\n]+$', ''))
  return fields
end
local function event(session_dir, tag, ...)
  local values = { tag }
  for _, value in ipairs({ ... }) do
    values[#values + 1] = encode(value)
  end
  local handle = io.open(join(session_dir, 'events.log'), 'a')
  if handle then
    handle:write(table.concat(values, '|') .. '\n')
    handle:close()
  end
end
local function command_files(directory)
  local names, index = {}, 0
  while true do
    local name = reaper.EnumerateFiles(directory, index)
    if not name or name == '' then
      break
    end
    if name:match('%.cmd$') then
      names[#names + 1] = name
    end
    index = index + 1
  end
  table.sort(names)
  return names
end
local function file_exists(path)
  local f = io.open(path, 'rb')
  if f then
    f:close()
    return true
  end
  return false
end
local function dirname(path)
  return path:match('^(.*)[\\/][^\\/]-$') or ''
end
local function safe_name(value)
  return (value:gsub('[<>:"/\\|?*]', '_'))
end
local function color(hex)
  local r, g, b = tonumber((hex or ''):sub(1, 2), 16) or 0, tonumber((hex or ''):sub(3, 4), 16) or 0, tonumber((hex or ''):sub(5, 6), 16) or 0
  -- ColorToNative returns an RGB value below bit 24; adding the custom-color
  -- flag is equivalent to setting that bit and keeps this bridge Lua 5.1-safe.
  return reaper.ColorToNative(r, g, b) + 0x1000000
end
local function pipe_fields(value, count)
  local out, start = {}, 1
  while #out < count - 1 do
    local at = value:find('|', start, true)
    if not at then
      break
    end
    out[#out + 1], start = value:sub(start, at - 1), at + 1
  end
  out[#out + 1] = value:sub(start)
  return out
end

local function prepare_compare(session_dir, runs, run_id)
  if not reaper.APIExists('SetTakeMarker') then
    event(session_dir, 'ERROR', 'This REAPER version cannot add take markers.')
    return
  end
  local _, rpp = reaper.EnumProjects(-1, '')
  local project_folder = rpp and dirname(rpp) or ''
  if project_folder == '' then
    event(session_dir, 'ERROR', 'Save the REAPER project before starting Transcript Compare.')
    return
  end
  local manuscript = join(join(join(project_folder, 'narration-utils'), 'manuscript'), 'manuscript.json')
  if not file_exists(manuscript) then
    event(session_dir, 'ERROR', 'Import a manuscript in Narration Utils before starting Transcript Compare.')
    return
  end

  local track, raw_items = nil, {}
  local selected = reaper.CountSelectedMediaItems(0)
  if selected > 0 then
    track = reaper.GetMediaItem_Track(reaper.GetSelectedMediaItem(0, 0))
    for index = 0, selected - 1 do
      local item = reaper.GetSelectedMediaItem(0, index)
      if reaper.GetMediaItem_Track(item) == track then
        raw_items[#raw_items + 1] = { item = item, pos = reaper.GetMediaItemInfo_Value(item, 'D_POSITION') }
      end
    end
  elseif reaper.CountSelectedTracks(0) > 0 then
    track = reaper.GetSelectedTrack(0, 0)
    for index = 0, reaper.CountTrackMediaItems(track) - 1 do
      local item = reaper.GetTrackMediaItem(track, index)
      raw_items[#raw_items + 1] = { item = item, pos = reaper.GetMediaItemInfo_Value(item, 'D_POSITION') }
    end
  else
    event(session_dir, 'ERROR', 'Select audio item(s), or select a track, then start Transcript Compare.')
    return
  end
  if #raw_items == 0 then
    event(session_dir, 'ERROR', 'The selected track has no audio items.')
    return
  end
  table.sort(raw_items, function(a, b)
    return a.pos < b.pos
  end)
  local _, track_name = reaper.GetTrackName(track)
  local manifest, mapping = {}, {}
  for _, entry in ipairs(raw_items) do
    local take = reaper.GetActiveTake(entry.item)
    if take and not reaper.TakeIsMIDI(take) then
      local source = reaper.GetMediaItemTake_Source(take)
      local source_file = reaper.GetMediaSourceFileName(source, '')
      if source_file ~= '' then
        local startoffs = reaper.GetMediaItemTakeInfo_Value(take, 'D_STARTOFFS')
        local rate = reaper.GetMediaItemTakeInfo_Value(take, 'D_PLAYRATE')
        if rate == 0 then
          rate = 1
        end
        local index = #manifest
        mapping[index] = { item = entry.item, take = take, pos = entry.pos, startoffs = startoffs, rate = rate }
        manifest[#manifest + 1] = string.format('%d|%s|%.6f|%.6f', index, source_file, startoffs, reaper.GetMediaItemInfo_Value(entry.item, 'D_LENGTH') * rate)
      end
    end
  end
  if #manifest == 0 then
    event(session_dir, 'ERROR', 'No resolvable audio sources were found in the selection.')
    return
  end
  local manifest_path = join(session_dir, 'manifest_' .. run_id .. '.txt')
  local output = io.open(manifest_path, 'w')
  if not output then
    event(session_dir, 'ERROR', 'Could not write the REAPER audio manifest.')
    return
  end
  output:write(table.concat(manifest, '\n') .. '\n')
  output:close()
  local data_dir, diffs = join(project_folder, 'TranscriptCompare'), join(join(project_folder, 'TranscriptCompare'), 'diffs')
  reaper.RecursiveCreateDirectory(diffs, 0)
  local diff_path = join(diffs, safe_name(track_name) .. '_' .. run_id .. '.diff')
  runs[run_id] = { mapping = mapping, track = track_name, diff_path = diff_path, rows = {} }
  event(session_dir, 'COMPARE_PREPARED', run_id, manifest_path, manuscript, track_name, diff_path, tostring(#manifest))
end

local function marker_kind(name)
  local prefix = tostring(name or ''):match('^%s*([%a_]+)%s*:')
  return prefix and prefix:upper() or ''
end
local function existing(take, kind, srcpos)
  local count = reaper.GetNumTakeMarkers(take)
  for index = 0, count - 1 do
    local marker_pos, marker_name = reaper.GetTakeMarker(take, index)
    if marker_kind(marker_name) == tostring(kind or ''):upper() and math.abs(marker_pos - srcpos) <= 0.15 then
      return marker_name
    end
  end
  return nil
end
local function inspect_results(session_dir, runs, run_id, path)
  local run = runs[run_id]
  if not run then
    event(session_dir, 'ERROR', 'Transcript Compare context expired; prepare a new comparison.')
    return
  end
  local input = io.open(path, 'r')
  if not input then
    event(session_dir, 'ERROR', 'Transcript results were not found.')
    return
  end
  local summary, total, duplicates = '', 0, 0
  for line in input:lines() do
    local tag, body = line:match('^([A-Z_]+)|(.*)$')
    if tag == 'SUMMARY' then
      summary = body
    elseif tag == 'MARKER' then
      -- 12 fields: compare.py appends <confidence>|<timing_gap_seconds>
      -- after <audio_context> (field 10) - the count here must match or
      -- pipe_fields dumps the trailing fields into fields[10], corrupting
      -- audio_context. Not yet forwarded to COMPARE_MARKER below; they
      -- exist for future UI work (see docs/utilities/transcript-compare.md).
      local fields = pipe_fields(body, 12)
      local item_index, srcpos = tonumber(fields[1]), tonumber(fields[2])
      local entry = item_index and run.mapping[item_index]
      if entry and srcpos then
        local project_time, row_id = entry.pos + (srcpos - entry.startoffs) / entry.rate, tostring(item_index) .. '@' .. string.format('%.6f', srcpos)
        local existing_name = existing(entry.take, fields[3], srcpos)
        local marker_state = existing_name and 'existing' or 'pending'
        if existing_name then
          duplicates = duplicates + 1
        end
        total = total + 1
        run.rows[row_id] = { item = entry.item, project_time = project_time, state = marker_state }
        event(
          session_dir,
          'COMPARE_MARKER',
          run_id,
          row_id,
          fields[3] or '',
          fields[4] or '',
          fields[5] or '',
          fields[6] or '',
          project_time,
          item_index,
          fields[7] or '',
          fields[8] or '0',
          fields[9] or '',
          fields[10] or '',
          marker_state,
          existing_name or '',
          srcpos
        )
      end
    end
  end
  input:close()
  event(session_dir, 'COMPARE_INSPECTED', run_id, summary ~= '' and summary or (tostring(total) .. ' discrepancy(s) found.'), total, duplicates)
end

local function export_results(session_dir, runs, run_id, path, misread, skipped, extra)
  local run = runs[run_id]
  if not run then
    event(session_dir, 'ERROR', 'Transcript Compare context expired; prepare a new comparison.')
    return
  end
  local input = io.open(path, 'r')
  if not input then
    event(session_dir, 'ERROR', 'Transcript results were not found.')
    return
  end
  local colors = { MISREAD = color(misread), SKIPPED = color(skipped), EXTRA = color(extra) }
  local added, duplicate_count = 0, 0
  for line in input:lines() do
    local tag, body = line:match('^([A-Z_]+)|(.*)$')
    if tag == 'MARKER' then
      -- Kept in sync with the 12-field count in inspect_results() above.
      local fields = pipe_fields(body, 12)
      local item_index, srcpos = tonumber(fields[1]), tonumber(fields[2])
      local entry = item_index and run.mapping[item_index]
      local row_id = item_index and srcpos and (tostring(item_index) .. '@' .. string.format('%.6f', srcpos)) or ''
      local row = run.rows[row_id]
      if entry and srcpos and row then
        if row.state == 'pending' then
          local existing_name = existing(entry.take, fields[3], srcpos)
          if existing_name then
            row.state = 'existing'
            duplicate_count = duplicate_count + 1
            event(session_dir, 'COMPARE_EXPORT_MARKER', run_id, row_id, 'existing', existing_name)
          else
            reaper.SetTakeMarker(entry.take, -1, fields[4] or '', srcpos, colors[fields[3]] or 0)
            row.state = 'exported'
            added = added + 1
            event(session_dir, 'COMPARE_EXPORT_MARKER', run_id, row_id, 'exported', '')
          end
        elseif row.state == 'existing' then
          duplicate_count = duplicate_count + 1
        end
      end
    end
  end
  input:close()
  reaper.UpdateArrange()
  if added > 0 then
    reaper.Undo_OnStateChange('Transcript Compare: export take markers')
  end
  event(session_dir, 'COMPARE_EXPORTED', run_id, added, duplicate_count)
end

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

function M.run(session_dir)
  local commands_dir, active, runs = join(session_dir, 'commands'), true, {}
  local function tick()
    for _, name in ipairs(command_files(commands_dir)) do
      local path = join(commands_dir, name)
      local handle = io.open(path, 'r')
      local line = handle and handle:read('*l') or ''
      if handle then
        handle:close()
      end
      os.remove(path)
      local command = split(line, 8)
      if command[1] ~= '1' then
        event(session_dir, 'ERROR', 'Unsupported hub protocol')
      elseif command[2] == 'prepare_compare' then
        prepare_compare(session_dir, runs, command[3] or '')
      elseif command[2] == 'inspect_compare_results' then
        inspect_results(session_dir, runs, command[3] or '', command[4] or '')
      elseif command[2] == 'export_compare_markers' then
        export_results(session_dir, runs, command[3] or '', command[4] or '', command[5] or 'FF4040', command[6] or 'FFC000', command[7] or '40A0FF')
      elseif command[2] == 'jump_to_compare_marker' then
        local run, row = runs[command[3] or ''], nil
        if run then
          row = run.rows[command[4] or '']
        end
        if row then
          reaper.SelectAllMediaItems(0, false)
          reaper.SetMediaItemSelected(row.item, true)
          reaper.SetEditCurPos(row.project_time, true, false)
          reaper.UpdateArrange()
        else
          event(session_dir, 'ERROR', 'Marker location is no longer available.')
        end
      elseif command[2] == 'stamp_item_lines' then
        stamp_item_lines(session_dir, command[3] or '', command[4] or '', command[5] == '1')
      elseif command[2] == 'read_line_ids' then
        read_line_ids(session_dir, command[3] or '', command[4] or '')
      elseif command[2] == 'create_chapter_regions' then
        create_chapter_regions(session_dir, command[3] or '', command[4] or '', command[5] or '')
      elseif command[2] == 'close' then
        active = false
      else
        event(session_dir, 'ERROR', 'Unsupported workspace command')
      end
    end
    if active then
      reaper.defer(tick)
    end
  end
  reaper.defer(tick)
end

return M
