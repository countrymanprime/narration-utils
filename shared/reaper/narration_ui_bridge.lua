-- File-session adapter for the React-owned Narration Utils workspace.
-- No UI lives here: this module only reads REAPER selection state, applies
-- take markers, and moves the edit cursor on commands from the Python host.

local M = {}

local function encode(value)
  return tostring(value or ""):gsub("[^%w%-_%.~]", function(c) return string.format("%%%02X", string.byte(c)) end)
end
local function decode(value)
  return (tostring(value or ""):gsub("%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end
local function split(line, count)
  local fields, start = {}, 1
  while #fields < count - 1 do
    local at = line:find("|", start, true)
    if not at then break end
    fields[#fields + 1], start = decode(line:sub(start, at - 1)), at + 1
  end
  fields[#fields + 1] = decode(line:sub(start):gsub("[\r\n]+$", ""))
  return fields
end
local function event(session_dir, tag, ...)
  local values = { tag }
  for _, value in ipairs({ ... }) do values[#values + 1] = encode(value) end
  local handle = io.open(session_dir .. "\\events.log", "a")
  if handle then handle:write(table.concat(values, "|") .. "\n"); handle:close() end
end
local function command_files(directory)
  local names, index = {}, 0
  while true do
    local name = reaper.EnumerateFiles(directory, index)
    if not name or name == "" then break end
    if name:match("%.cmd$") then names[#names + 1] = name end
    index = index + 1
  end
  table.sort(names)
  return names
end
local function file_exists(path) local f = io.open(path, "rb"); if f then f:close(); return true end return false end
local function dirname(path) return path:match("^(.*)[\\/][^\\/]-$") or "" end
local function safe_name(value) return (value:gsub('[<>:"/\\|?*]', "_")) end
local function color(hex)
  local r, g, b = tonumber((hex or ""):sub(1, 2), 16) or 0, tonumber((hex or ""):sub(3, 4), 16) or 0, tonumber((hex or ""):sub(5, 6), 16) or 0
  return reaper.ColorToNative(r, g, b) | 0x1000000
end
local function pipe_fields(value, count)
  local out, start = {}, 1
  while #out < count - 1 do
    local at = value:find("|", start, true)
    if not at then break end
    out[#out + 1], start = value:sub(start, at - 1), at + 1
  end
  out[#out + 1] = value:sub(start)
  return out
end

local function prepare_compare(session_dir, runs, run_id)
  if not reaper.APIExists("SetTakeMarker") then event(session_dir, "ERROR", "This REAPER version cannot add take markers."); return end
  local _, rpp = reaper.EnumProjects(-1, "")
  local project_folder = rpp and dirname(rpp) or ""
  if project_folder == "" then event(session_dir, "ERROR", "Save the REAPER project before starting Transcript Compare."); return end
  local docx = project_folder .. "\\Manuscript.docx"
  if not file_exists(docx) then event(session_dir, "ERROR", "Select a manuscript in Narration Utils before starting Transcript Compare."); return end

  local track, raw_items = nil, {}
  local selected = reaper.CountSelectedMediaItems(0)
  if selected > 0 then
    track = reaper.GetMediaItem_Track(reaper.GetSelectedMediaItem(0, 0))
    for index = 0, selected - 1 do
      local item = reaper.GetSelectedMediaItem(0, index)
      if reaper.GetMediaItem_Track(item) == track then raw_items[#raw_items + 1] = { item = item, pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION") } end
    end
  elseif reaper.CountSelectedTracks(0) > 0 then
    track = reaper.GetSelectedTrack(0, 0)
    for index = 0, reaper.CountTrackMediaItems(track) - 1 do
      local item = reaper.GetTrackMediaItem(track, index)
      raw_items[#raw_items + 1] = { item = item, pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION") }
    end
  else event(session_dir, "ERROR", "Select audio item(s), or select a track, then start Transcript Compare."); return end
  if #raw_items == 0 then event(session_dir, "ERROR", "The selected track has no audio items."); return end
  table.sort(raw_items, function(a, b) return a.pos < b.pos end)
  local _, track_name = reaper.GetTrackName(track)
  local manifest, mapping = {}, {}
  for _, entry in ipairs(raw_items) do
    local take = reaper.GetActiveTake(entry.item)
    if take and not reaper.TakeIsMIDI(take) then
      local source = reaper.GetMediaItemTake_Source(take)
      local source_file = reaper.GetMediaSourceFileName(source, "")
      if source_file ~= "" then
        local startoffs = reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS")
        local rate = reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE"); if rate == 0 then rate = 1 end
        local index = #manifest
        mapping[index] = { item = entry.item, take = take, pos = entry.pos, startoffs = startoffs, rate = rate }
        manifest[#manifest + 1] = string.format("%d|%s|%.6f|%.6f", index, source_file, startoffs, reaper.GetMediaItemInfo_Value(entry.item, "D_LENGTH") * rate)
      end
    end
  end
  if #manifest == 0 then event(session_dir, "ERROR", "No resolvable audio sources were found in the selection."); return end
  local manifest_path = session_dir .. "\\manifest_" .. run_id .. ".txt"
  local output = io.open(manifest_path, "w")
  if not output then event(session_dir, "ERROR", "Could not write the REAPER audio manifest."); return end
  output:write(table.concat(manifest, "\n") .. "\n"); output:close()
  local data_dir, diffs = dirname(docx) .. "\\TranscriptCompare", dirname(docx) .. "\\TranscriptCompare\\diffs"
  reaper.RecursiveCreateDirectory(diffs, 0)
  local diff_path = diffs .. "\\" .. safe_name(track_name) .. "_" .. run_id .. ".diff"
  runs[run_id] = { mapping = mapping, track = track_name, diff_path = diff_path, rows = {} }
  event(session_dir, "COMPARE_PREPARED", run_id, manifest_path, docx, track_name, diff_path)
end

local function marker_kind(name)
  local prefix = tostring(name or ""):match("^%s*([%a_]+)%s*:")
  return prefix and prefix:upper() or ""
end
local function existing(take, kind, srcpos)
  local count = reaper.GetNumTakeMarkers(take)
  for index = 0, count - 1 do
    local marker_pos, marker_name = reaper.GetTakeMarker(take, index)
    if marker_kind(marker_name) == tostring(kind or ""):upper() and math.abs(marker_pos - srcpos) <= 0.15 then return marker_name end
  end
  return nil
end
local function inspect_results(session_dir, runs, run_id, path)
  local run = runs[run_id]
  if not run then event(session_dir, "ERROR", "Transcript Compare context expired; prepare a new comparison."); return end
  local input = io.open(path, "r")
  if not input then event(session_dir, "ERROR", "Transcript results were not found."); return end
  local summary, total, duplicates = "", 0, 0
  for line in input:lines() do
    local tag, body = line:match("^([A-Z_]+)|(.*)$")
    if tag == "SUMMARY" then summary = body
    elseif tag == "MARKER" then
      local fields = pipe_fields(body, 10); local item_index, srcpos = tonumber(fields[1]), tonumber(fields[2]); local entry = item_index and run.mapping[item_index]
      if entry and srcpos then
        local project_time, row_id = entry.pos + (srcpos - entry.startoffs) / entry.rate, tostring(item_index) .. "@" .. string.format("%.6f", srcpos)
        local existing_name = existing(entry.take, fields[3], srcpos)
        local marker_state = existing_name and "existing" or "pending"
        if existing_name then duplicates = duplicates + 1 end
        total = total + 1
        run.rows[row_id] = { item = entry.item, project_time = project_time, state = marker_state }
        event(session_dir, "COMPARE_MARKER", run_id, row_id, fields[3] or "", fields[4] or "", fields[5] or "", fields[6] or "", project_time, item_index, fields[7] or "", fields[8] or "0", fields[9] or "", fields[10] or "", marker_state, existing_name or "", srcpos)
      end
    end
  end
  input:close()
  event(session_dir, "COMPARE_INSPECTED", run_id, summary ~= "" and summary or (tostring(total) .. " discrepancy(s) found."), total, duplicates)
end

local function export_results(session_dir, runs, run_id, path, misread, skipped, extra)
  local run = runs[run_id]
  if not run then event(session_dir, "ERROR", "Transcript Compare context expired; prepare a new comparison."); return end
  local input = io.open(path, "r")
  if not input then event(session_dir, "ERROR", "Transcript results were not found."); return end
  local colors = { MISREAD = color(misread), SKIPPED = color(skipped), EXTRA = color(extra) }
  local added, duplicate_count = 0, 0
  for line in input:lines() do
    local tag, body = line:match("^([A-Z_]+)|(.*)$")
    if tag == "MARKER" then
      local fields = pipe_fields(body, 10); local item_index, srcpos = tonumber(fields[1]), tonumber(fields[2]); local entry = item_index and run.mapping[item_index]
      local row_id = item_index and srcpos and (tostring(item_index) .. "@" .. string.format("%.6f", srcpos)) or ""
      local row = run.rows[row_id]
      if entry and srcpos and row then
        if row.state == "pending" then
          local existing_name = existing(entry.take, fields[3], srcpos)
          if existing_name then
            row.state = "existing"; duplicate_count = duplicate_count + 1
            event(session_dir, "COMPARE_EXPORT_MARKER", run_id, row_id, "existing", existing_name)
          else
            reaper.SetTakeMarker(entry.take, -1, fields[4] or "", srcpos, colors[fields[3]] or 0)
            row.state = "exported"; added = added + 1
            event(session_dir, "COMPARE_EXPORT_MARKER", run_id, row_id, "exported", "")
          end
        elseif row.state == "existing" then
          duplicate_count = duplicate_count + 1
        end
      end
    end
  end
  input:close(); reaper.UpdateArrange(); if added > 0 then reaper.Undo_OnStateChange("Transcript Compare: export take markers") end
  event(session_dir, "COMPARE_EXPORTED", run_id, added, duplicate_count)
end

function M.run(session_dir)
  local commands_dir, active, runs = session_dir .. "\\commands", true, {}
  local function tick()
    for _, name in ipairs(command_files(commands_dir)) do
      local path = commands_dir .. "\\" .. name; local handle = io.open(path, "r"); local line = handle and handle:read("*l") or ""; if handle then handle:close() end; os.remove(path)
      local command = split(line, 8)
      if command[1] ~= "1" then event(session_dir, "ERROR", "Unsupported hub protocol")
      elseif command[2] == "prepare_compare" then prepare_compare(session_dir, runs, command[3] or "")
      elseif command[2] == "inspect_compare_results" then inspect_results(session_dir, runs, command[3] or "", command[4] or "")
      elseif command[2] == "export_compare_markers" then export_results(session_dir, runs, command[3] or "", command[4] or "", command[5] or "FF4040", command[6] or "FFC000", command[7] or "40A0FF")
      elseif command[2] == "jump_to_compare_marker" then
        local run, row = runs[command[3] or ""], nil; if run then row = run.rows[command[4] or ""] end
        if row then reaper.SelectAllMediaItems(0, false); reaper.SetMediaItemSelected(row.item, true); reaper.SetEditCurPos(row.project_time, true, false); reaper.UpdateArrange() else event(session_dir, "ERROR", "Marker location is no longer available.") end
      elseif command[2] == "close" then active = false
      else event(session_dir, "ERROR", "Unsupported workspace command") end
    end
    if active then reaper.defer(tick) end
  end
  reaper.defer(tick)
end

return M
