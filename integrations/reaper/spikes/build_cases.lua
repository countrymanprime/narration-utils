-- Spike S0, part 1: builds the "cases" fixture project with the REAPER API, saves it, reloads it and saves it again
-- (the no-op re-save pair), and records what the API returns (fake-fidelity observations) in report.txt.
-- Run by run-reaper.ps1 inside an isolated REAPER (-cfgfile). Media are the synthetic tones from make_media.py.

-- run-reaper.ps1 sets this to the scratch folder that holds media/ and receives the saved projects and the report.
local PACK = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)')
PACK = PACK:gsub(string.char(92), '/')
local function native(path)
  return (path:gsub('/', string.char(92)))
end
local report = {}
local function log(...)
  local parts = {}
  for index = 1, select('#', ...) do
    parts[#parts + 1] = tostring((select(index, ...)))
  end
  report[#report + 1] = table.concat(parts, ' ')
end
local function finish()
  local handle = io.open(PACK .. '/report.txt', 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
  reaper.Main_OnCommand(40004, 0) -- File: Quit REAPER
end

local ok, err = xpcall(function()
  reaper.Main_OnCommand(40023, 0) -- File: New project
  log('version', reaper.GetAppVersion(), 'os', reaper.GetOS())
  reaper.GetSetProjectInfo_String(0, 'RENDER_FILE', 'renders', true)
  reaper.Main_SaveProjectEx(0, native(PACK .. '/saved-cases.rpp'), 0) -- so REAPER knows the project folder before media are added
  reaper.GetSetProjectInfo_String(0, 'RECORD_PATH', 'media', true)

  local function add_track(name)
    local index = reaper.CountTracks(0)
    reaper.InsertTrackAtIndex(index, true)
    local track = reaper.GetTrack(0, index)
    reaper.GetSetMediaTrackInfo_String(track, 'P_NAME', name, true)
    return track
  end
  local function add_item(track, file, position, length, take_name)
    local item = reaper.AddMediaItemToTrack(track)
    reaper.SetMediaItemInfo_Value(item, 'D_POSITION', position)
    reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', length)
    local take = reaper.AddTakeToMediaItem(item)
    reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile('media/' .. file))
    reaper.GetSetMediaItemTakeInfo_String(take, 'P_NAME', take_name or file, true)
    return item, take
  end

  -- 1. Multi-take item: three takes, the second active.
  local multi = add_track('Multi-take')
  local item, take_a = add_item(multi, 'take_a.wav', 0, 3, 'take A')
  local take_b = reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take_b, reaper.PCM_Source_CreateFromFile('media/take_b.wav'))
  reaper.GetSetMediaItemTakeInfo_String(take_b, 'P_NAME', 'take B', true)
  local take_c = reaper.AddTakeToMediaItem(item)
  reaper.SetMediaItemTake_Source(take_c, reaper.PCM_Source_CreateFromFile('media/take_c.wav'))
  reaper.GetSetMediaItemTakeInfo_String(take_c, 'P_NAME', 'take C', true)
  reaper.SetActiveTake(take_b)
  reaper.SetMediaItemTakeInfo_Value(take_c, 'D_VOL', 0.5)
  reaper.GetSetMediaItemInfo_String(item, 'P_NOTES', 'Narrator note: keep take B', true)
  log('multi-take: takes', reaper.CountTakes(item), 'active index', reaper.GetMediaItemInfo_Value(item, 'I_CURTAKE'))

  -- 2. Muted item next to an audible one, on a muted track.
  local muted = add_track('Muted')
  local muted_item = add_item(muted, 'take_a.wav', 4, 3, 'muted item')
  reaper.SetMediaItemInfo_Value(muted_item, 'B_MUTE', 1)
  add_item(muted, 'take_b.wav', 8, 3, 'audible item')
  reaper.SetMediaTrackInfo_Value(muted, 'B_MUTE', 1)

  -- 3. SECTION source: written as a chunk, because the API has no direct constructor for it.
  local section = add_track('Section')
  local section_item = add_item(section, 'take_c.wav', 12, 1.5, 'section of take C')
  local _, chunk = reaper.GetItemStateChunk(section_item, '', false)
  local wrapped, replaced = chunk:gsub('(<SOURCE WAVE.-\n>)', function(source)
    return '<SOURCE SECTION\nLENGTH 1.5\nSTARTPOS 0.5\nOVERLAP 0.01\n' .. source .. '\n>'
  end)
  log('section: chunk source blocks rewritten', replaced)
  reaper.SetItemStateChunk(section_item, wrapped, false)

  -- 4. Play rate, source offset and stretch markers.
  local rate = add_track('Rate and stretch')
  local rate_item, rate_take = add_item(rate, 'take_a.wav', 14, 2.4, 'rate 1.25')
  reaper.SetMediaItemTakeInfo_Value(rate_take, 'D_PLAYRATE', 1.25)
  reaper.SetMediaItemTakeInfo_Value(rate_take, 'D_STARTOFFS', 0.5)
  reaper.SetMediaItemTakeInfo_Value(rate_take, 'B_PPITCH', 0)
  log('stretch marker index', reaper.SetTakeStretchMarker(rate_take, -1, 0.4, 0.5), reaper.SetTakeStretchMarker(rate_take, -1, 1.6, 1.4))
  log('stretch markers', reaper.GetTakeNumStretchMarkers(rate_take), 'rate', reaper.GetMediaItemTakeInfo_Value(rate_take, 'D_PLAYRATE'))

  -- 5. FX chains: track FX and take FX from REAPER's own plug-ins.
  local fx = add_track('FX chains')
  local _, fx_take = add_item(fx, 'take_b.wav', 17, 2, 'take with FX')
  log('track FX', reaper.TrackFX_AddByName(fx, 'ReaEQ', false, -1), reaper.TrackFX_AddByName(fx, 'ReaComp', false, -1))
  log('take FX', reaper.TakeFX_AddByName(fx_take, 'ReaGate', -1), reaper.TakeFX_AddByName(fx_take, 'ReaXcomp', -1))

  -- 6. Item and take extension data (the line identity keys), on items that will also be split and duplicated by the
  --    checklist run; here it only proves the round trip through a save.
  local stamped = add_track('Stamped')
  local stamped_item, stamped_take = add_item(stamped, 'take_a.wav', 20, 3, 'stamped line')
  log('P_EXT missing key', reaper.GetSetMediaItemInfo_String(stamped_item, 'P_EXT:narration_utils_line_id', '', false))
  log('P_EXT set item', reaper.GetSetMediaItemInfo_String(stamped_item, 'P_EXT:narration_utils_line_id', 'line-000001', true))
  log('P_EXT set item text', reaper.GetSetMediaItemInfo_String(stamped_item, 'P_EXT:narration_utils_line_text', 'The first line, with | a pipe.', true))
  log('P_EXT set take', reaper.GetSetMediaItemTakeInfo_String(stamped_take, 'P_EXT:narration_utils_take_note', 'take-level value', true))
  log('P_EXT read item', reaper.GetSetMediaItemInfo_String(stamped_item, 'P_EXT:narration_utils_line_id', '', false))
  log('P_EXT read take', reaper.GetSetMediaItemTakeInfo_String(stamped_take, 'P_EXT:narration_utils_take_note', '', false))
  log('item GUID', reaper.GetSetMediaItemInfo_String(stamped_item, 'GUID', '', false))
  log('track GUID', reaper.GetSetMediaTrackInfo_String(stamped, 'GUID', '', false))

  -- Values a manuscript line really contains: double quotes, a backslash, a percent sign, non-ASCII, a very long line.
  local tricky_item = add_item(stamped, 'take_b.wav', 24, 3, 'tricky values')
  local tricky = 'She said "hello", then left.' .. string.char(92) .. ' Caf' .. string.char(195, 169) .. ' 100% done; it' .. string.char(39) .. 's fine.'
  local long = string.rep('word ', 600) .. 'end'
  local set_ok = reaper.GetSetMediaItemInfo_String(tricky_item, 'P_EXT:narration_utils_line_text', tricky, true)
  reaper.GetSetMediaItemInfo_String(tricky_item, 'P_EXT:narration_utils_line_id', 'line-000002', true)
  reaper.GetSetMediaItemInfo_String(tricky_item, 'P_EXT:narration_utils_long', long, true)
  local _, read_back = reaper.GetSetMediaItemInfo_String(tricky_item, 'P_EXT:narration_utils_line_text', '', false)
  local _, read_long = reaper.GetSetMediaItemInfo_String(tricky_item, 'P_EXT:narration_utils_long', '', false)
  log('P_EXT tricky value set', set_ok, 'read back identical', read_back == tricky, 'long value length', #long, 'read back identical', read_long == long)
  local newline_ok = reaper.GetSetMediaItemInfo_String(tricky_item, 'P_EXT:narration_utils_multiline', 'first line' .. string.char(10) .. 'second line', true)
  local _, read_multiline = reaper.GetSetMediaItemInfo_String(tricky_item, 'P_EXT:narration_utils_multiline', '', false)
  log('P_EXT value with a newline: set', newline_ok, 'read back', (read_multiline:gsub(string.char(10), '<LF>')))

  -- 7. Project markers (PICKUP: convention) and chapter regions.
  local red = reaper.ColorToNative(255, 64, 64) + 0x1000000
  log('ColorToNative(255,64,64)', reaper.ColorToNative(255, 64, 64))
  log('marker index', reaper.AddProjectMarker2(0, false, 6.5, 0, 'PICKUP: re-record "the wind" (mispronounced)', -1, red))
  log('marker index', reaper.AddProjectMarker2(0, false, 12.25, 0, 'PICKUP: breath at 12.25', -1, red))
  log('marker index', reaper.AddProjectMarker2(0, false, 21.0, 0, 'PICKUP_DONE: line 1 re-recorded', -1, 0))
  log('region index', reaper.AddProjectMarker2(0, true, 0, 11.9, 'Chapter 1', -1, 0))
  log('region index', reaper.AddProjectMarker2(0, true, 12, 19.9, 'Chapter 2', -1, reaper.ColorToNative(255, 136, 0) + 0x1000000))
  log('region index', reaper.AddProjectMarker2(0, true, 20, 23, 'Chapter 3', -1, 0))
  log('AddRegionOrMarker exists', reaper.APIExists('AddRegionOrMarker'))
  local count, markers, regions = reaper.CountProjectMarkers(0)
  log('markers', markers, 'regions', regions)
  for index = 0, count - 1 do
    log('EnumProjectMarkers3', index, reaper.EnumProjectMarkers3(0, index))
  end
  log('EnumProjectMarkers3 past the end', reaper.EnumProjectMarkers3(0, count))
  log('EnumProjects(-1)', reaper.EnumProjects(-1, ''))

  -- API shapes the harness fake mimics.
  local first = reaper.GetMediaItem(0, 0)
  log(
    'GetMediaItem order',
    reaper.GetMediaItemInfo_Value(reaper.GetMediaItem(0, 0), 'D_POSITION'),
    reaper.GetMediaItemInfo_Value(reaper.GetMediaItem(0, 1), 'D_POSITION')
  )
  log('GetTrackName', reaper.GetTrackName(multi))
  log('GetMediaSourceFileName', reaper.GetMediaSourceFileName(reaper.GetMediaItemTake_Source(take_a), ''))
  log('SetTakeMarker returns', reaper.SetTakeMarker(take_a, -1, 'z-late', 2.5, 0), reaper.SetTakeMarker(take_a, -1, 'a-early', 0.5, 0))
  for index = 0, reaper.GetNumTakeMarkers(take_a) - 1 do
    log('GetTakeMarker', index, reaper.GetTakeMarker(take_a, index))
  end
  log('GetTakeMarker invalid index', reaper.GetTakeMarker(take_a, 99))
  log('first item GUID via GetSetMediaItemInfo_String', reaper.GetSetMediaItemInfo_String(first, 'GUID', '', false))
  -- The take markers were only for the API observations; remove them so the fixture stays about the cases above.
  for index = reaper.GetNumTakeMarkers(take_a) - 1, 0, -1 do
    reaper.DeleteTakeMarker(take_a, index)
  end

  reaper.UpdateArrange()
  log('save cases', reaper.Main_SaveProjectEx(0, native(PACK .. '/saved-cases.rpp'), 0))
  log('reload', reaper.Main_openProject('noprompt:' .. native(PACK .. '/saved-cases.rpp')))
  log('re-save', reaper.Main_SaveProjectEx(0, native(PACK .. '/resave-noop.rpp'), 0))
end, debug.traceback)
if not ok then
  log('ERROR', err)
end
finish()
