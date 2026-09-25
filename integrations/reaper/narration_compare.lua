-- Transcript Compare over the bridge: prepare_compare, inspect_compare_results, export_compare_markers and
-- jump_to_compare_marker. Loaded by narration_ui_bridge.lua, which passes the shared helpers as the chunk argument.

local core = ...
local join, dirname, file_exists, safe_name, color, pipe_fields, event =
  core.join, core.dirname, core.file_exists, core.safe_name, core.color, core.pipe_fields, core.event

local function prepare_compare(session_dir, runs, run_id)
  if not reaper.APIExists('SetTakeMarker') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot add take markers.')
    return
  end
  local _, rpp = reaper.EnumProjects(-1, '')
  local project_folder = rpp and dirname(rpp) or ''
  if project_folder == '' then
    event(session_dir, 'ERROR', run_id, 'Save the REAPER project before starting Transcript Compare.')
    return
  end
  local manuscript = join(join(join(project_folder, 'narration-utils'), 'manuscript'), 'manuscript.json')
  if not file_exists(manuscript) then
    event(session_dir, 'ERROR', run_id, 'Import a manuscript in Narration Utils before starting Transcript Compare.')
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
    event(session_dir, 'ERROR', run_id, 'Select audio item(s), or select a track, then start Transcript Compare.')
    return
  end
  if #raw_items == 0 then
    event(session_dir, 'ERROR', run_id, 'The selected track has no audio items.')
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
        -- The identity is read now, with the audio it describes: a row reported later names these GUIDs even if the
        -- narrator edits meanwhile, so going to it by GUID either finds this audio or reports it stale.
        local _, item_guid = reaper.GetSetMediaItemInfo_String(entry.item, 'GUID', '', false)
        local _, take_guid = reaper.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
        mapping[index] = {
          item = entry.item,
          take = take,
          pos = entry.pos,
          startoffs = startoffs,
          rate = rate,
          item_guid = item_guid or '',
          take_guid = take_guid or '',
          track_guid = reaper.GetTrackGUID(track) or '',
        }
        manifest[#manifest + 1] = string.format('%d|%s|%.6f|%.6f', index, source_file, startoffs, reaper.GetMediaItemInfo_Value(entry.item, 'D_LENGTH') * rate)
      end
    end
  end
  if #manifest == 0 then
    event(session_dir, 'ERROR', run_id, 'No resolvable audio sources were found in the selection.')
    return
  end
  local manifest_path = join(session_dir, 'manifest_' .. run_id .. '.txt')
  local output = io.open(manifest_path, 'w')
  if not output then
    event(session_dir, 'ERROR', run_id, 'Could not write the REAPER audio manifest.')
    return
  end
  output:write(table.concat(manifest, '\n') .. '\n')
  output:close()
  local data_dir, diffs = join(project_folder, 'TranscriptCompare'), join(join(project_folder, 'TranscriptCompare'), 'diffs')
  reaper.RecursiveCreateDirectory(diffs, 0)
  local diff_path = join(diffs, safe_name(track_name) .. '_' .. run_id .. '.diff')
  runs[run_id] = { mapping = mapping, track = track_name, diff_path = diff_path, rows = {} }
  -- The comparison's baseline for the "changed since comparison" label (follow-through PRD Phase 13): REAPER's own edit
  -- counter, read with the audio it describes. A REAPER without the call answers the six fields it always did.
  if reaper.APIExists('GetProjectStateChangeCount') then
    local changes = tostring(reaper.GetProjectStateChangeCount(0))
    event(session_dir, 'COMPARE_PREPARED', run_id, manifest_path, manuscript, track_name, diff_path, tostring(#manifest), changes)
  else
    event(session_dir, 'COMPARE_PREPARED', run_id, manifest_path, manuscript, track_name, diff_path, tostring(#manifest))
  end
end

local existing = core.existing_take_marker
local function inspect_results(session_dir, runs, run_id, path)
  local run = runs[run_id]
  if not run then
    event(session_dir, 'ERROR', run_id, 'Transcript Compare context expired; prepare a new comparison.')
    return
  end
  local input = io.open(path, 'r')
  if not input then
    event(session_dir, 'ERROR', run_id, 'Transcript results were not found.')
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
          srcpos,
          -- Appended, never reordered (review-dashboard PRD Phase 6): the host navigates a finding by these GUIDs.
          entry.item_guid,
          entry.take_guid,
          entry.track_guid
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
    event(session_dir, 'ERROR', run_id, 'Transcript Compare context expired; prepare a new comparison.')
    return
  end
  local input = io.open(path, 'r')
  if not input then
    event(session_dir, 'ERROR', run_id, 'Transcript results were not found.')
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

return function(registry)
  local runs = {}
  registry.register('prepare_compare', function(ctx, args)
    prepare_compare(ctx.session_dir, runs, args[1] or '')
  end)
  registry.register('inspect_compare_results', function(ctx, args)
    inspect_results(ctx.session_dir, runs, args[1] or '', args[2] or '')
  end)
  registry.register('export_compare_markers', function(ctx, args)
    export_results(ctx.session_dir, runs, args[1] or '', args[2] or '', args[3] or 'FF4040', args[4] or 'FFC000', args[5] or '40A0FF')
  end)
  registry.register('jump_to_compare_marker', function(ctx, args)
    local run, row = runs[args[1] or ''], nil
    if run then
      row = run.rows[args[2] or '']
    end
    if row then
      reaper.SelectAllMediaItems(0, false)
      reaper.SetMediaItemSelected(row.item, true)
      reaper.SetEditCurPos(row.project_time, true, false)
      reaper.UpdateArrange()
    else
      event(ctx.session_dir, 'ERROR', args[1] or '', 'Marker location is no longer available.')
    end
  end)
end
