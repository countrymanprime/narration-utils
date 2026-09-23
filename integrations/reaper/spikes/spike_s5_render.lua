-- Spike S5 (Phase 10, docs/prds/reaper-automation-follow-through.prd.md): render details.
-- Verifies, against a real REAPER: RENDER_STATS/RENDER_STATS_SUMMARY key format, $region naming in RENDER_PATTERN for
-- per-region ("chapter") rendering, the current IDs of the actions research section 2 and 6 named, and whether a
-- render can be previewed/validated without writing files. Run by run-reaper.ps1 inside an isolated REAPER
-- (-cfgfile), against a scratch project built here with the synthetic media from make_media.py. Renders only to the
-- scratch NARRATION_UTILS_SPIKE_OUT folder (never the project's own folder); the caller deletes that folder after
-- reading report.txt.

-- Guard (owner decision D3): refuse to run unless REAPER's resource path is the scratch -Cfg folder run-reaper.ps1
-- passed, and the audio device is closed. A script that is started any other way stops here instead of touching real
-- settings.
do
  local BACKSLASH = string.char(92)
  local wanted = os.getenv('NARRATION_UTILS_SPIKE_CFG')
  local actual = reaper.GetResourcePath()
  assert(wanted and wanted ~= '', 'NARRATION_UTILS_SPIKE_CFG is not set: start this script with run-reaper.ps1')
  assert(actual:gsub(BACKSLASH, '/'):lower() == wanted:gsub(BACKSLASH, '/'):lower(), 'REAPER is not using the isolated -cfgfile: ' .. actual)
  -- REAPER opens the default Windows audio device (WaveOut, Sound Mapper) on start even when the first-run prompt is
  -- answered No. Nothing is recorded or played, but close it at once and prove it is closed.
  reaper.Audio_Quit()
  assert(reaper.Audio_IsRunning() == 0, 'the audio device could not be closed')
end

local BS = string.char(92)
local PACK = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)'):gsub(BS, '/')
local function native(path)
  return (path:gsub('/', BS))
end

local report = {}
local function log(...)
  local parts = {}
  for index = 1, select('#', ...) do
    parts[#parts + 1] = tostring((select(index, ...)))
  end
  report[#report + 1] = table.concat(parts, ' ')
end
-- Flush after every stage so a hang or crash later (e.g. an action that shows a modal dialog) still leaves the
-- earlier, safer findings on disk instead of losing everything to an unwritten report.
local function flush()
  local handle = io.open(PACK .. '/report.txt', 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
end
local function finish()
  flush()
  reaper.Main_OnCommand(40004, 0) -- File: Quit REAPER
end

local function list_dir(dir)
  reaper.EnumerateFiles(dir, -1) -- clear the cache (ADR 0068): otherwise a file created after the first call is invisible.
  local names, index = {}, 0
  while true do
    local name = reaper.EnumerateFiles(dir, index)
    if not name or name == '' then
      break
    end
    names[#names + 1] = name
    index = index + 1
  end
  return names
end

local ok, err = xpcall(function()
  log('=== S5 render spike ===', 'version', reaper.GetAppVersion(), 'os', reaper.GetOS())

  ------------------------------------------------------------------
  -- 1. Action IDs: research section 2 and 6 cited these by an older action-list snapshot. Verify each against this
  --    REAPER's own action list via kbd_getTextFromCmd, which is the authoritative name for a given numeric ID
  --    (empty/false means the ID is not a valid action in this build).
  ------------------------------------------------------------------
  local candidates = {
    { id = 1013, note = 'Record' },
    { id = 1016, note = 'Stop' },
    { id = 40044, note = 'Play/stop' },
    { id = 40252, note = 'Record mode: normal' },
    { id = 40076, note = 'Record mode: time-selection auto-punch' },
    { id = 40253, note = 'Record mode: selected-item auto-punch' },
    { id = 40364, note = 'Toggle metronome' },
    { id = 40363, note = 'Metronome and pre-roll settings' },
    { id = 41818, note = 'Pre-roll on play' },
    { id = 41819, note = 'Pre-roll on record' },
    { id = 40012, note = 'Split items at edit cursor' },
    { id = 42230, note = 'Render project, using the most recent render settings' },
    { id = 41823, note = 'Add project to render queue' },
    { id = 40209, note = 'Apply track/take FX to items' },
    { id = 42437, note = 'Dry run of selected items (loudness stats)' },
  }
  local ok_section, section = pcall(reaper.SectionFromUniqueID, 0)
  log('SectionFromUniqueID(0) ok', ok_section, 'section', tostring(section))
  for _, c in ipairs(candidates) do
    local text = 'ERROR'
    local call_ok, result = pcall(reaper.kbd_getTextFromCmd, c.id, section)
    if call_ok then
      text = (result == nil or result == '') and '(empty: no such action in this build)' or result
    else
      text = 'kbd_getTextFromCmd failed: ' .. tostring(result)
    end
    log('action', c.id, 'expected', c.note, 'kbd_getTextFromCmd ->', text)
  end
  flush()

  ------------------------------------------------------------------
  -- 2. API surface: does this REAPER build actually expose the functions the research doc guessed at (some names in
  --    the task brief, e.g. Render_EnumerateOutputMode, are not in the official ReaScript API list; confirm rather
  --    than assume).
  ------------------------------------------------------------------
  local api_names = {
    'GetSetProjectInfo_String',
    'GetSetProjectInfo',
    'Render_Execute',
    'Render_EnumerateOutputMode',
    'RenderFileSection',
    'SetRegionRenderMatrix',
    'EnumRegionRenderMatrix',
    'ResolveWildcards',
    'AddRegionOrMarker',
    'AddProjectMarker2',
    'CF_GetCommandText', -- SWS; expected absent in an isolated -cfgfile with no extensions installed
  }
  for _, name in ipairs(api_names) do
    log('APIExists', name, reaper.APIExists(name))
  end
  flush()

  ------------------------------------------------------------------
  -- 3. Build a scratch project: one track, three items, three regions with matching bounds ("chapters").
  ------------------------------------------------------------------
  reaper.Main_OnCommand(40023, 0) -- File: New project
  reaper.Main_SaveProjectEx(0, native(PACK .. '/saved-s5.rpp'), 0) -- so REAPER knows the project folder before media are added
  reaper.GetSetProjectInfo_String(0, 'RECORD_PATH', 'media', true)

  local track_index = reaper.CountTracks(0)
  reaper.InsertTrackAtIndex(track_index, true)
  local track = reaper.GetTrack(0, track_index)
  reaper.GetSetMediaTrackInfo_String(track, 'P_NAME', 'Narration', true)

  local chapters = {
    { name = 'Chapter 1', start = 0, len = 3 },
    { name = 'Chapter 2', start = 4, len = 3 },
    { name = 'Chapter 3', start = 8, len = 3 },
  }
  local media_files = { 'take_a.wav', 'take_b.wav', 'take_c.wav' }
  for index, chapter in ipairs(chapters) do
    local item = reaper.AddMediaItemToTrack(track)
    reaper.SetMediaItemInfo_Value(item, 'D_POSITION', chapter.start)
    reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', chapter.len)
    local take = reaper.AddTakeToMediaItem(item)
    reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile('media/' .. media_files[index]))
    reaper.GetSetMediaItemTakeInfo_String(take, 'P_NAME', chapter.name, true)
    local end_pos = chapter.start + chapter.len
    local region_index = reaper.AddProjectMarker2(0, true, chapter.start, end_pos, chapter.name, -1, 0)
    log('region added', chapter.name, 'index', region_index, 'bounds', chapter.start, end_pos)
  end
  reaper.UpdateArrange()
  local count, markers, regions = reaper.CountProjectMarkers(0)
  log('project markers', count, 'markers', markers, 'regions', regions)
  flush()

  ------------------------------------------------------------------
  -- 4. Configure render: bounds = all regions, pattern = $region, output = a scratch renders/ folder (never the
  --    project's own folder or the owner's REAPER Media directory).
  ------------------------------------------------------------------
  local renders_dir = PACK .. '/renders'
  reaper.RecursiveCreateDirectory(native(renders_dir), 0)
  local before_read_format = { reaper.GetSetProjectInfo_String(0, 'RENDER_FORMAT', '', false) }
  log('RENDER_FORMAT before any change', before_read_format[1], before_read_format[2])
  reaper.GetSetProjectInfo_String(0, 'RENDER_FILE', native(renders_dir), true)
  reaper.GetSetProjectInfo_String(0, 'RENDER_PATTERN', '$region', true)
  reaper.GetSetProjectInfo(0, 'RENDER_BOUNDSFLAG', 3, true) -- 3 = all regions
  reaper.GetSetProjectInfo(0, 'RENDER_ADDTOPROJ', 0, true)

  local read_pattern_ok, read_pattern = reaper.GetSetProjectInfo_String(0, 'RENDER_PATTERN', '', false)
  log('RENDER_PATTERN read back (literal, not resolved per-region)', read_pattern_ok, read_pattern)
  local read_file_ok, read_file = reaper.GetSetProjectInfo_String(0, 'RENDER_FILE', '', false)
  log('RENDER_FILE read back', read_file_ok, read_file)
  local targets_ok, targets = reaper.GetSetProjectInfo_String(0, 'RENDER_TARGETS', '', false)
  log('RENDER_TARGETS (predicted output files) before any render', targets_ok, targets)

  local resolve_ok, resolved = pcall(reaper.ResolveWildcards, 0, 0, '$region')
  log('ResolveWildcards(0,0,"$region") at t=0 (expect empty/undefined outside a render pass)', resolve_ok, tostring(resolved))
  flush()

  ------------------------------------------------------------------
  -- 5. Dry-run experiment: call the RENDER_STATS getter with a dry-run action id WITHOUT invoking Main_OnCommand, so
  --    an unattended run cannot block on a modal render/progress dialog. This tests whether the getter alone can
  --    preview/validate a render without writing files.
  ------------------------------------------------------------------
  local before_dry_run = list_dir(native(renders_dir))
  local stats_dry_ok, stats_dry = reaper.GetSetProjectInfo_String(0, 'RENDER_STATS', '42437', false)
  local stats_dry_sum_ok, stats_dry_sum = reaper.GetSetProjectInfo_String(0, 'RENDER_STATS_SUMMARY', '42437', false)
  local after_dry_run = list_dir(native(renders_dir))
  log('RENDER_STATS getter with action id 42437, no Main_OnCommand invoked', stats_dry_ok, stats_dry)
  log('RENDER_STATS_SUMMARY getter with action id 42437, no Main_OnCommand invoked', stats_dry_sum_ok, stats_dry_sum)
  log('renders dir before dry-run getter call', table.concat(before_dry_run, ','))
  log('renders dir after dry-run getter call (unchanged means no file was written)', table.concat(after_dry_run, ','))
  flush()

  ------------------------------------------------------------------
  -- 6. Real render (the only file-writing step): action 42230, "File: Render project, using the most recent render
  --    settings" (documented as headless, no dialog). Output goes only to the scratch renders/ folder created above;
  --    the caller deletes NARRATION_UTILS_SPIKE_OUT afterward.
  ------------------------------------------------------------------
  local before_real = list_dir(native(renders_dir))
  reaper.Main_OnCommand(42230, 0)
  local after_real = list_dir(native(renders_dir))
  log('renders dir before the real render (action 42230)', table.concat(before_real, ','))
  log('renders dir after the real render (action 42230)', table.concat(after_real, ','))

  local stats_ok, stats = reaper.GetSetProjectInfo_String(0, 'RENDER_STATS', '42230', false)
  local stats_sum_ok, stats_sum = reaper.GetSetProjectInfo_String(0, 'RENDER_STATS_SUMMARY', '42230', false)
  log('RENDER_STATS after the real render, action id 42230', stats_ok, stats)
  log('RENDER_STATS_SUMMARY after the real render, action id 42230', stats_sum_ok, stats_sum)
  local stats_empty_ok, stats_empty = reaper.GetSetProjectInfo_String(0, 'RENDER_STATS', '', false)
  log('RENDER_STATS after the real render, empty action id', stats_empty_ok, stats_empty)

  local targets_after_ok, targets_after = reaper.GetSetProjectInfo_String(0, 'RENDER_TARGETS', '', false)
  log('RENDER_TARGETS after the real render', targets_after_ok, targets_after)
  flush()

  ------------------------------------------------------------------
  -- 7. Clean up the rendered files now, inside REAPER, before quitting (belt-and-braces; the caller also deletes the
  --    whole scratch NARRATION_UTILS_SPIKE_OUT folder).
  ------------------------------------------------------------------
  for _, name in ipairs(after_real) do
    local removed = os.remove(native(renders_dir) .. BS .. name)
    log('removed rendered file', name, removed)
  end
end, debug.traceback)
if not ok then
  log('ERROR', err)
end
finish()
