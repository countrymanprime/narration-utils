-- Review-dashboard PRD Phase 6 check: the real navigate_item, loop_context, stop_loop and ping commands
-- (narration_navigation.lua, loaded through the real narration_ui_bridge.lua registry) and the GUIDs COMPARE_MARKER now
-- carries, against a real REAPER, in a scratch project built from synthetic tones. Answers what the harness's fake
-- cannot: whether REAPER's own time selection, loop points and repeat read back as set and restored, whether any of it
-- makes an undo point or dirties the project, and whether the time selection and the loop points are linked.
--
-- Playback is NOT started (owner decision D3: no script plays or records): OnPlayButton is replaced by a recorder
-- before the bridge loads, so the check sees that the bridge asks REAPER to play without any audio device being used.
-- Hearing the loop, and REAPER's own stop button, are left to the owner (docs/architecture/reaper-navigation.md).
--
-- Research tool, not product code. Run by run-reaper.ps1 (-Cfg an isolated resource folder, -Out a scratch folder
-- holding media/ from make_media.py); it never opens or saves anything outside -Out.

do
  local BACKSLASH = string.char(92)
  local wanted = os.getenv('NARRATION_UTILS_SPIKE_CFG')
  local actual = reaper.GetResourcePath()
  assert(wanted and wanted ~= '', 'NARRATION_UTILS_SPIKE_CFG is not set: start this script with run-reaper.ps1')
  assert(actual:gsub(BACKSLASH, '/'):lower() == wanted:gsub(BACKSLASH, '/'):lower(), 'REAPER is not using the isolated -cfgfile: ' .. actual)
  reaper.Audio_Quit()
  assert(reaper.Audio_IsRunning() == 0, 'the audio device could not be closed')
end

local PACK = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)')
local REAPER_DIR = assert(os.getenv('NARRATION_UTILS_REAPER_DIR'), 'set NARRATION_UTILS_REAPER_DIR (run-reaper.ps1 does)')
local SEP = package.config:sub(1, 1)
local function path(name)
  return PACK .. SEP .. name
end

local report, passed, failed = {}, 0, 0
local function log(...)
  local parts = {}
  for index = 1, select('#', ...) do
    parts[#parts + 1] = tostring((select(index, ...)))
  end
  report[#report + 1] = table.concat(parts, ' ')
end
local function check(label, ok, detail)
  if ok then
    passed = passed + 1
  else
    failed = failed + 1
  end
  log((ok and 'PASS ' or 'FAIL ') .. label .. (detail and (' :: ' .. tostring(detail)) or ''))
end
local function finish()
  log('')
  log(string.format('%d passed, %d failed', passed, failed))
  local handle = io.open(path('navigation-check-report.txt'), 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
  reaper.Main_OnCommand(40004, 0) -- File: Quit REAPER
end

-- No playback: record the bridge's request instead (D3).
local play_requests = 0
reaper.OnPlayButton = function()
  play_requests = play_requests + 1
end

local function close_to(a, b)
  return math.abs(a - b) < 0.0005
end
local function time_selection()
  return reaper.GetSet_LoopTimeRange2(0, false, false, 0, 0, false)
end
local function loop_points()
  return reaper.GetSet_LoopTimeRange2(0, false, true, 0, 0, false)
end
local function range_text(first, last)
  return string.format('%.3f..%.3f', first, last)
end

local function undo_label()
  return reaper.Undo_CanUndo2(0) or ''
end
local function find_item(guid)
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    local _, candidate = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
    if candidate == guid then
      return item
    end
  end
  return nil
end

local ok, err = xpcall(function()
  log('version', reaper.GetAppVersion(), 'os', reaper.GetOS(), _VERSION)

  -- A scratch project: one track, two 3 s items from the synthetic tones, saved into -Out and opened from there (so it
  -- has a path, and the undo history starts empty).
  local rpp = path('navigation.rpp')
  reaper.Main_OnCommand(40023, 0) -- File: New project
  reaper.Main_SaveProjectEx(0, rpp, 0)
  reaper.InsertTrackAtIndex(0, true)
  local function add_item(track, file, position)
    local item = reaper.AddMediaItemToTrack(track)
    reaper.SetMediaItemInfo_Value(item, 'D_POSITION', position)
    reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', 3)
    local take = reaper.AddTakeToMediaItem(item)
    reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile(path('media' .. SEP .. file)))
    return item, take
  end
  local built_item, built_take = add_item(reaper.GetTrack(0, 0), 'take_a.wav', 10)
  local built_neighbour = add_item(reaper.GetTrack(0, 0), 'take_b.wav', 13)
  local _, item_guid = reaper.GetSetMediaItemInfo_String(built_item, 'GUID', '', false)
  local _, take_guid = reaper.GetSetMediaItemTakeInfo_String(built_take, 'GUID', '', false)
  local _, neighbour_guid = reaper.GetSetMediaItemInfo_String(built_neighbour, 'GUID', '', false)
  reaper.Main_SaveProjectEx(0, rpp, 0)
  reaper.Main_openProject('noprompt:' .. rpp)
  local _, open_path = reaper.EnumProjects(-1, '')
  check('0 the scratch project is open from -Out', open_path:lower() == rpp:lower(), open_path)
  local track = reaper.GetTrack(0, 0)
  local item, neighbour = assert(find_item(item_guid), 'item lost on reopen'), assert(find_item(neighbour_guid), 'neighbour lost on reopen')
  reaper.SelectAllMediaItems(0, false)

  -- The narrator's own state: a time selection, repeat off. Setting one range shows whether REAPER links the other.
  reaper.GetSet_LoopTimeRange2(0, true, true, 0.5, 2.5, false)
  local ts_seen = { time_selection() }
  log('time selection after setting only the loop points to 0.5..2.5:', range_text(ts_seen[1], ts_seen[2]))
  reaper.GetSet_LoopTimeRange2(0, true, false, 1, 2, false)
  local lp_seen = { loop_points() }
  log('loop points after setting only the time selection to 1..2:', range_text(lp_seen[1], lp_seen[2]))
  reaper.GetSetRepeat(0)
  local baseline_ts, baseline_loop = { time_selection() }, { loop_points() }
  log(
    'baseline: time selection',
    range_text(baseline_ts[1], baseline_ts[2]),
    'loop points',
    range_text(baseline_loop[1], baseline_loop[2]),
    'repeat',
    reaper.GetSetRepeat(-1),
    'undo',
    "'" .. undo_label() .. "'",
    'dirty',
    reaper.IsProjectDirty(0)
  )

  -- The real bridge registry, with the real feature files.
  local bridge = dofile(REAPER_DIR .. SEP .. 'narration_ui_bridge.lua')
  local registry = bridge.new_registry()
  local core = dofile(REAPER_DIR .. SEP .. 'narration_bridge_core.lua')
  local events_path = path('events.log')
  os.remove(events_path)
  local read_offset = 0
  local function send(name, ...)
    local handler = assert(registry.lookup(name), name .. ' is not registered')
    handler({ session_dir = PACK, event = function() end, stop = function() end }, { ... })
    local handle = io.open(events_path, 'rb')
    local text = handle and handle:read('a') or ''
    if handle then
      handle:close()
    end
    local fresh = text:sub(read_offset + 1)
    read_offset = #text
    local events = {}
    for line in fresh:gmatch('[^\r\n]+') do
      events[#events + 1] = core.split(line, 32)
    end
    return events
  end
  local function first(events)
    return events[1] and table.concat(events[1], '|') or 'NO EVENT'
  end
  -- Runs a command and checks it left the undo history as it found it.
  local function send_without_undo(label, name, ...)
    local before = undo_label()
    local events = send(name, ...)
    check(label .. ' ... makes no undo point', undo_label() == before, "'" .. before .. "' -> '" .. undo_label() .. "'")
    return events
  end

  local pong = send('ping', 'p1')
  check('1 ping answers PONG with version 1, no loop, not playing', first(pong) == 'PONG|p1|1|0|0', first(pong))

  local looped = send_without_undo('2', 'loop_context', 'l1', item_guid, take_guid, '0.5', '2.5')
  local ts, lp = { time_selection() }, { loop_points() }
  check('2 loop_context answers LOOP_STARTED 10.5..12.5', first(looped) == 'LOOP_STARTED|l1|' .. item_guid .. '|10.500000|12.500000', first(looped))
  check('2 ... REAPER reads the time selection back as 10.5..12.5', close_to(ts[1], 10.5) and close_to(ts[2], 12.5), range_text(ts[1], ts[2]))
  check('2 ... and the loop points', close_to(lp[1], 10.5) and close_to(lp[2], 12.5), range_text(lp[1], lp[2]))
  check('2 ... repeat is on', reaper.GetSetRepeat(-1) == 1, reaper.GetSetRepeat(-1))
  check('2 ... the edit cursor is at the window start', close_to(reaper.GetCursorPosition(), 10.5), reaper.GetCursorPosition())
  check('2 ... the bridge asked REAPER to play once (not executed, D3)', play_requests == 1, play_requests)
  log('   project dirty after loop_context:', reaper.IsProjectDirty(0))
  local pong_looping = send('ping', 'p2')
  check('2 ... ping reports the loop held', first(pong_looping) == 'PONG|p2|1|1|0', first(pong_looping))

  send_without_undo('3', 'loop_context', 'l2', item_guid, take_guid, '1', '2')
  ts = { time_selection() }
  check('3 a second loop re-targets to 11..12', close_to(ts[1], 11) and close_to(ts[2], 12), range_text(ts[1], ts[2]))

  local stopped = send_without_undo('4', 'stop_loop', 's1')
  ts, lp = { time_selection() }, { loop_points() }
  check('4 stop_loop answers LOOP_STOPPED with all three restored', first(stopped) == 'LOOP_STOPPED|s1|3|0', first(stopped))
  check("4 ... the time selection is the narrator's again", close_to(ts[1], baseline_ts[1]) and close_to(ts[2], baseline_ts[2]), range_text(ts[1], ts[2]))
  check("4 ... the loop points are the narrator's again", close_to(lp[1], baseline_loop[1]) and close_to(lp[2], baseline_loop[2]), range_text(lp[1], lp[2]))
  check('4 ... repeat is off again', reaper.GetSetRepeat(-1) == 0, reaper.GetSetRepeat(-1))

  send('loop_context', 'l3', item_guid, take_guid, '0.5', '2.5')
  reaper.GetSet_LoopTimeRange2(0, true, false, 20, 21, false) -- the narrator selects something else meanwhile
  local kept = send('stop_loop', 's2')
  ts = { time_selection() }
  check('5 a time selection the narrator changed during the loop is kept', close_to(ts[1], 20) and close_to(ts[2], 21), range_text(ts[1], ts[2]))
  check('5 ... and reported as kept (linked loop points with it), repeat restored', first(kept) == 'LOOP_STOPPED|s2|1|2', first(kept))

  local nothing = send('stop_loop', 's3')
  check('6 stop_loop with no loop running changes nothing', first(nothing) == 'LOOP_STOPPED|s3|0|0', first(nothing))

  local stale = send_without_undo('7', 'navigate_item', 'n1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}', '', '1.5')
  check(
    '7 a GUID that is not in the project is FINDING_STALE item',
    first(stale) == 'FINDING_STALE|n1|{FFFFFFFF-0000-4000-8000-00000000FFFF}|item',
    first(stale)
  )
  check('7 ... and nothing is selected', reaper.CountSelectedMediaItems(0) == 0, reaper.CountSelectedMediaItems(0))

  reaper.SetMediaItemSelected(neighbour, true)
  local went = send_without_undo('8', 'navigate_item', 'n2', item_guid, take_guid, '1.5')
  check('8 navigate_item answers NAVIGATED at 11.5 s', first(went) == 'NAVIGATED|n2|' .. item_guid .. '|11.500000', first(went))
  check('8 ... the edit cursor is at 11.5 s', close_to(reaper.GetCursorPosition(), 11.5), reaper.GetCursorPosition())
  check(
    '8 ... only the finding item is selected',
    reaper.IsMediaItemSelected(item) and not reaper.IsMediaItemSelected(neighbour) and reaper.CountSelectedMediaItems(0) == 1
  )
  log('   project dirty after navigate_item:', reaper.IsProjectDirty(0))

  local wrong_take = send('navigate_item', 'n3', item_guid, '{FFFFFFFF-0000-4000-8000-0000000000AA}', '1.5')
  check(
    '9 a take GUID not on the item is FINDING_STALE take',
    first(wrong_take) == 'FINDING_STALE|n3|{FFFFFFFF-0000-4000-8000-0000000000AA}|take',
    first(wrong_take)
  )
  local outside = send('navigate_item', 'n4', item_guid, take_guid, '5')
  check(
    '10 a spot past the end of the item is FINDING_STALE range, never the neighbour',
    first(outside) == 'FINDING_STALE|n4|' .. item_guid .. '|range',
    first(outside)
  )
  check('10 ... the cursor stayed at 11.5 s', close_to(reaper.GetCursorPosition(), 11.5), reaper.GetCursorPosition())

  -- Moving the item moves the finding with it: the time is a source time.
  reaper.SetMediaItemInfo_Value(item, 'D_POSITION', 30)
  local moved = send('navigate_item', 'n5', item_guid, take_guid, '1.5')
  check('11 after the item moved to 30 s the finding is at 31.5 s', first(moved) == 'NAVIGATED|n5|' .. item_guid .. '|31.500000', first(moved))
  reaper.SetMediaItemInfo_Value(item, 'D_POSITION', 10)

  -- The GUIDs on COMPARE_MARKER, through the real compare commands with a hand-made results file.
  local manuscript_dir = path('narration-utils') .. SEP .. 'manuscript'
  reaper.RecursiveCreateDirectory(manuscript_dir, 0)
  local manuscript = io.open(manuscript_dir .. SEP .. 'manuscript.json', 'wb')
  manuscript:write('{"version":1}')
  manuscript:close()
  local prepared = send('prepare_compare', 'c1')
  check('12 prepare_compare prepares the selected item', prepared[1] and prepared[1][1] == 'COMPARE_PREPARED', first(prepared))
  local results = io.open(path('results_c1.txt'), 'wb')
  results:write('MARKER|0|1.500000|MISREAD|MISREAD: alice|Alice|Alyss|Chapter 1|4|script|audio|high|0.3\n')
  results:close()
  local inspected = send('inspect_compare_results', 'c1', path('results_c1.txt'))
  local marker = inspected[1] or {}
  local track_guid = reaper.GetTrackGUID(track)
  check(
    '12 COMPARE_MARKER ends with the item, take and track GUIDs',
    marker[17] == item_guid and marker[18] == take_guid and marker[19] == track_guid,
    table.concat(marker, '|')
  )
  local went_back = send('navigate_item', 'n6', marker[17] or '', marker[18] or '', marker[16] or '')
  check('12 ... and navigate_item goes to that marker by them', first(went_back) == 'NAVIGATED|n6|' .. item_guid .. '|11.500000', first(went_back))

  -- Why navigate_item selects item by item: which selection call makes an undo point.
  local before = undo_label()
  reaper.SetMediaItemSelected(neighbour, true)
  log('probe: SetMediaItemSelected undo', "'" .. before .. "' -> '" .. undo_label() .. "'")
  before = undo_label()
  reaper.SelectAllMediaItems(0, false)
  log('probe: SelectAllMediaItems undo', "'" .. before .. "' -> '" .. undo_label() .. "'")
  log('GUID shapes:', item_guid, take_guid, track_guid)
end, debug.traceback)
if not ok then
  failed = failed + 1
  log('ERROR', err)
end
finish()
