-- The verification pass, Part A (docs/operations/reaper-verification-pass.md; booth actions enablement PRD Phase 6): the
-- unattended rows, run in a real REAPER against the real bridge. It builds a scratch project from make_media.py's tones,
-- starts the real bridge loop (narration_ui_bridge.lua from NARRATION_UTILS_REAPER_DIR) on a scratch session folder,
-- and sends each row's commands through the same file protocol the Go host uses, then checks what REAPER reads back.
-- The rows themselves are pass_part_a_lib.lua's, proved against the harness's fake by tests/pass_part_a_test.lua.
-- Rows A6-A8b are spike_ep0_workspace.lua's: run-pass-part-a.ps1 runs it first and this script merges its report.
--
-- Safety (owner decision D3):
--   - it stops unless REAPER's resource path is the scratch -Cfg folder and the audio device is closed;
--   - it opens no project of the owner's: the project is built and saved in -Out, and every file it writes goes through
--     assert_scratch (inside -Out or -Cfg, never under "REAPER Media");
--   - it never records: CSurf_OnRecord is replaced by a counter before the bridge loads, so a record_start that should
--     have been refused is counted and fails A5 instead of recording. Playback (A3, A5, A9b) runs with the device
--     closed, so nothing is heard or captured.
--
-- Writes pass-part-a-results.md (the table to paste into #510) and pass-part-a-log.txt into -Out, with paths removed,
-- then pass-part-a-done.txt (run-reaper.ps1's -Done marker), and quits REAPER.

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
local CFG = assert(os.getenv('NARRATION_UTILS_SPIKE_CFG'), 'set NARRATION_UTILS_SPIKE_CFG (run-reaper.ps1 does)')
local REAPER_DIR = assert(os.getenv('NARRATION_UTILS_REAPER_DIR'), 'set NARRATION_UTILS_REAPER_DIR (run-reaper.ps1 does)')
local EP0_REPORT = os.getenv('NARRATION_UTILS_PASS_EP0_REPORT') or ''
local REV = os.getenv('NARRATION_UTILS_PASS_REV') or 'unknown'
local SEP = package.config:sub(1, 1)

local function own_directory()
  local source = debug.getinfo(1, 'S').source or ''
  local file = source:match('^@(.+)$')
  if not file then
    local _, action_path = reaper.get_action_context()
    file = action_path
  end
  return (file or ''):match('^(.*)[\\/][^\\/]-$') or '.'
end
local lib = dofile(own_directory() .. SEP .. 'pass_part_a_lib.lua')

local ROOTS = { PACK, CFG }
local function path(name)
  return lib.assert_scratch(PACK .. SEP .. name, ROOTS)
end
local function write_file(file, text)
  local handle = assert(io.open(lib.assert_scratch(file, ROOTS), 'wb'))
  handle:write(text)
  handle:close()
end
local function read_file(file)
  local handle = io.open(file, 'rb')
  if not handle then
    return nil
  end
  local text = handle:read('a')
  handle:close()
  return text
end

-- Part A never records (D28 leaves the one test recording to Part B).
local record_requests = 0
reaper.CSurf_OnRecord = function()
  record_requests = record_requests + 1
end

local report = lib.new_report()
local started_at = reaper.time_precise()

-- The fixture ------------------------------------------------------------------------------------------------------

local function guid_of_item(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
  return guid
end
local function guid_of_take(take)
  local _, guid = reaper.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
  return guid
end

-- The page's scratch project: "Chapter 1" with a two-take item at 0 s, an item trimmed to start 0.5 s into its source at
-- 4 s, one at play rate 1.5 at 8 s and the cleanup item at 12 s; "Chapter 2" with one item; "Pickups" empty; one region.
-- Saved into -Out, then opened from there, so it has a path and its undo history starts empty. Answers ctx.fx.
local function build_fixture()
  local media = PACK .. SEP .. 'media' .. SEP
  for _, name in ipairs({ 'take_a.wav', 'take_b.wav', 'take_c.wav' }) do
    assert(read_file(media .. name), 'missing ' .. name .. ': run make_media.py into <out>/media first (run-pass-part-a.ps1 does)')
  end
  local rpp = path('pass-part-a.rpp')
  reaper.Main_OnCommand(40023, 0) -- File: New project
  reaper.Main_SaveProjectEx(0, rpp, 0)
  for index, name in ipairs({ 'Chapter 1', 'Chapter 2', 'Pickups' }) do
    reaper.InsertTrackAtIndex(index - 1, true)
    reaper.GetSetMediaTrackInfo_String(reaper.GetTrack(0, index - 1), 'P_NAME', name, true)
  end
  local function add_item(track, file, position, length)
    local item = reaper.AddMediaItemToTrack(track)
    reaper.SetMediaItemInfo_Value(item, 'D_POSITION', position)
    reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', length)
    local take = reaper.AddTakeToMediaItem(item)
    reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile(media .. file))
    return item, take
  end
  local chapter1, chapter2 = reaper.GetTrack(0, 0), reaper.GetTrack(0, 1)
  local multi, first_take = add_item(chapter1, 'take_a.wav', 0, 3)
  local second_take = reaper.AddTakeToMediaItem(multi)
  reaper.SetMediaItemTake_Source(second_take, reaper.PCM_Source_CreateFromFile(media .. 'take_b.wav'))
  reaper.SetActiveTake(first_take)
  local _, trimmed_take = add_item(chapter1, 'take_c.wav', 4, 2.5)
  reaper.SetMediaItemTakeInfo_Value(trimmed_take, 'D_STARTOFFS', 0.5)
  local fast, fast_take = add_item(chapter1, 'take_a.wav', 8, 2)
  reaper.SetMediaItemTakeInfo_Value(fast_take, 'D_PLAYRATE', 1.5)
  local cleanup, cleanup_take = add_item(chapter1, 'take_c.wav', 12, 3)
  add_item(chapter2, 'take_b.wav', 0, 3)
  reaper.AddProjectMarker2(0, true, 20, 25, 'Fixture region', -1, 0)
  local fx = {
    ch1 = reaper.GetTrackGUID(chapter1),
    ch2 = reaper.GetTrackGUID(chapter2),
    pickups = reaper.GetTrackGUID(reaper.GetTrack(0, 2)),
    multi = guid_of_item(multi),
    fast = guid_of_item(fast),
    cleanup = guid_of_item(cleanup),
    cleanup_take = guid_of_take(cleanup_take),
  }
  reaper.UpdateArrange()
  reaper.Main_SaveProjectEx(0, rpp, 0)
  reaper.Main_openProject('noprompt:' .. rpp)
  local _, open_path = reaper.EnumProjects(-1, '')
  assert((open_path or ''):lower() == rpp:lower(), 'the scratch project did not open from -Out: ' .. tostring(open_path))
  fx.project = lib.assert_scratch(open_path, ROOTS)
  return fx
end

-- The probe: the rows' view of REAPER, with REAPER's own undo, save and state chunks --------------------------------

local probe
probe = lib.new_probe(reaper, {
  undo_label = function()
    return reaper.Undo_CanUndo2(0) or ''
  end,
  undo = function()
    local label = reaper.Undo_CanUndo2(0) or ''
    reaper.Undo_DoUndo2(0)
    return label
  end,
  pause = function()
    reaper.OnPauseButton()
  end,
  audio_closed = function()
    return reaper.Audio_IsRunning() == 0
  end,
  record_requests = function()
    return record_requests
  end,
  move_item = function(guid, delta)
    local item = assert(probe.item(guid), 'no item ' .. guid)
    reaper.Undo_BeginBlock2(0)
    reaper.SetMediaItemInfo_Value(item, 'D_POSITION', reaper.GetMediaItemInfo_Value(item, 'D_POSITION') + delta)
    reaper.Undo_EndBlock2(0, 'Part A: move an item', -1)
    reaper.UpdateArrange()
  end,
  add_marker = function(at, name)
    reaper.Undo_BeginBlock2(0)
    reaper.AddProjectMarker2(0, false, at, 0, name, -1, 0)
    reaper.Undo_EndBlock2(0, 'Part A: add a marker', -1)
  end,
  -- Saves the open project in place: it is the scratch copy in -Out, checked again before every save.
  save = function()
    local _, open_path = reaper.EnumProjects(-1, '')
    lib.assert_scratch(open_path, ROOTS)
    reaper.Main_SaveProject(0, false)
  end,
  write_payload = function(name, lines)
    reaper.RecursiveCreateDirectory(path('payloads'), 0)
    local file = path('payloads' .. SEP .. name)
    write_file(file, table.concat(lines, '\n') .. '\n')
    return file
  end,
  file_size = function(file)
    local handle = io.open(file, 'rb')
    if not handle then
      return nil
    end
    local size = handle:seek('end')
    handle:close()
    return size
  end,
  in_view = function(at)
    local first, last = reaper.GetSet_ArrangeView2(0, false, 0, 0, 0, 0)
    return at >= first and at <= last
  end,
  -- Every track's state chunk (the master's too) but `except`'s, without REC lines unless arms count and without SEL
  -- lines unless the selection counts, then every marker and region.
  witness = function(options)
    local out = {}
    local function add(track)
      if options.except and probe.normalize(reaper.GetTrackGUID(track)) == probe.normalize(options.except) then
        return
      end
      local _, chunk = reaper.GetTrackStateChunk(track, '', false)
      for line in chunk:gmatch('[^\r\n]+') do
        local key = line:match('^%s*(%S+)')
        if not ((options.arms == false and key == 'REC') or (options.selection == false and key == 'SEL')) then
          out[#out + 1] = line
        end
      end
    end
    add(reaper.GetMasterTrack(0))
    for index = 0, reaper.CountTracks(0) - 1 do
      add(reaper.GetTrack(0, index))
    end
    if options.markers ~= false then
      local index = 0
      while true do
        local found, is_region, first, last, name, number, color = reaper.EnumProjectMarkers3(0, index)
        if not found or found == 0 then
          break
        end
        out[#out + 1] = string.format('marker %s %.6f %.6f %s %s %s', tostring(is_region), first, last, name, number, color)
        index = index + 1
      end
    end
    return table.concat(out, '\n')
  end,
})

-- The bridge, and the host side of its file protocol ---------------------------------------------------------------

local function start_bridge()
  local session_dir = path('session')
  reaper.RecursiveCreateDirectory(session_dir .. SEP .. 'commands', 0)
  local events_file = session_dir .. SEP .. 'events.log'
  os.remove(events_file)
  local bridge = dofile(REAPER_DIR .. SEP .. 'narration_ui_bridge.lua')
  bridge.run(session_dir)

  local reader = lib.event_reader(function()
    return read_file(events_file)
  end)
  local heartbeats, sent = {}, 0
  local function poll()
    local others = {}
    for _, fields in ipairs(reader.poll()) do
      if fields[1] == 'PROJECT_STATUS' then
        heartbeats[#heartbeats + 1] = fields
      else
        others[#others + 1] = fields
      end
    end
    return others
  end
  local ctx = { sleep = lib.sleep }
  -- Writes the command beside its final name and renames it into place, so the bridge never reads half a line; waits
  -- until the bridge has taken it (it deletes each file it reads) and answers the run's events.
  function ctx.send(command, ...)
    sent = sent + 1
    local run = 'pa' .. sent
    local final = session_dir .. SEP .. 'commands' .. SEP .. string.format('%08d.cmd', sent)
    write_file(final .. '.tmp', lib.command_line(command, run, ...) .. '\n')
    assert(os.rename(final .. '.tmp', final))
    local deadline = reaper.time_precise() + 5
    while read_file(final) and reaper.time_precise() < deadline do
      lib.sleep(0.05)
    end
    local out = {}
    for _, fields in ipairs(poll()) do
      if fields[2] == run then
        out[#out + 1] = fields
      end
    end
    return out
  end
  -- The first PROJECT_STATUS appended after the call (the bridge sends one every 1.5 s).
  function ctx.heartbeat()
    poll()
    heartbeats = {}
    local deadline = reaper.time_precise() + 5
    while reaper.time_precise() < deadline do
      lib.sleep(0.1)
      poll()
      if #heartbeats > 0 then
        return table.remove(heartbeats, 1)
      end
    end
    return nil
  end
  return ctx
end

-- The run -----------------------------------------------------------------------------------------------------------

local function finish(ok, err)
  if not ok then
    report:log('ERROR ' .. tostring(err))
  end
  local meta = {
    version = reaper.GetAppVersion(),
    os = reaper.GetOS(),
    lua = _VERSION,
    rev = REV,
    date = os.date('!%Y-%m-%d %H:%M UTC'),
    seconds = reaper.time_precise() - started_at,
  }
  local scrub = { { PACK, '<out>' }, { CFG, '<cfg>' }, { REAPER_DIR, '<repo>/integrations/reaper' } }
  local markdown = report:markdown(meta)
  if not ok then
    markdown = markdown .. '\n### Driver error\n\n```text\n' .. tostring(err) .. '\n```\n'
  end
  write_file(path('pass-part-a-results.md'), lib.scrub(markdown, scrub))
  write_file(path('pass-part-a-log.txt'), lib.scrub(table.concat(report.lines, '\n') .. '\n', scrub))
  -- Written last: run-reaper.ps1's -Done points at it.
  write_file(path('pass-part-a-done.txt'), 'done\n')
  reaper.Main_OnCommand(40004, 0) -- File: Quit REAPER
end

lib.run_async(function()
  report:log(table.concat({ 'version', reaper.GetAppVersion(), 'os', reaper.GetOS(), _VERSION, 'rev', REV }, ' '))
  local fx = build_fixture()
  local ctx = start_bridge()
  ctx.fx = fx
  ctx.daw = probe
  lib.run_rows(ctx, report)
  lib.merge_checks(report, EP0_REPORT ~= '' and read_file(EP0_REPORT) or nil, { 'A6', 'A7', 'A8', 'A8b' }, 'the workspace spike report is missing')
  report:log('')
  report:log(string.format('record requests (must be 0): %d', record_requests))
end, reaper.defer, reaper.time_precise, finish)
