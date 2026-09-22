-- Manual verification for Phase 7 (project-workspace-and-daw-link PRD, ADR 0092/W10): loads the REAL
-- narration_ui_bridge.lua (not a spike simulation) against a real REAPER session directory, lets its tick loop run
-- for a few real seconds, then reads events.log back and reports how many PROJECT_STATUS heartbeats were appended
-- and what they said, so the periodic-rewrite behavior described in dawfacts.go/daw.Reachability can be checked
-- against real REAPER instead of only the Lua harness fake.
--
-- Run with run-reaper.ps1 -Script verify_p7_heartbeat.lua -Project <a COPY of a narrator's .rpp in a temp folder>
-- (never the original; see README.md).

-- Guard (owner decision D3): refuse to run unless REAPER's resource path is the scratch -Cfg folder run-reaper.ps1
-- passed, and the audio device is closed. A script started any other way stops here instead of touching real settings.
do
  local BACKSLASH = string.char(92)
  local wanted = os.getenv('NARRATION_UTILS_SPIKE_CFG')
  local actual = reaper.GetResourcePath()
  assert(wanted and wanted ~= '', 'NARRATION_UTILS_SPIKE_CFG is not set: start this script with run-reaper.ps1')
  assert(actual:gsub(BACKSLASH, '/'):lower() == wanted:gsub(BACKSLASH, '/'):lower(), 'REAPER is not using the isolated -cfgfile: ' .. actual)
  reaper.Audio_Quit()
  assert(reaper.Audio_IsRunning() == 0, 'the audio device could not be closed')
end

local BS = string.char(92)
local OUT = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)'):gsub(BS, '/')
local REPO_REAPER = assert(os.getenv('NARRATION_UTILS_REAPER_DIR'), 'set NARRATION_UTILS_REAPER_DIR (run-reaper.ps1 does)'):gsub(BS, '/')

local function native(path)
  return (path:gsub('/', BS))
end
local function write_file(name, contents)
  local handle = assert(io.open(OUT .. '/' .. name, 'wb'))
  handle:write(contents)
  handle:close()
end

local session_dir = native(OUT .. '/session')
-- bridge.New (apps/desktop/internal/bridge/bridge.go) always creates commands/ before the Lua side ever runs;
-- reproduce that here since nothing else in this spike drives the real Go host.
reaper.RecursiveCreateDirectory(session_dir .. BS .. 'commands', 0)
-- The real production module, loaded exactly like NarrationUtils_Launcher.lua loads it.
local bridge = dofile(REPO_REAPER .. '/narration_ui_bridge.lua')
bridge.run(session_dir)

-- Wait about 3.2 real seconds (HEARTBEAT_INTERVAL_SECONDS is 1.5, so this should cross it twice: an immediate
-- heartbeat on the first tick, then roughly one more at ~1.5s and ~3.0s) without blocking REAPER: each watchdog
-- call re-queues itself with reaper.defer until enough wall time has passed, then reads events.log once.
local watch_started_at = reaper.time_precise()
local WAIT_SECONDS = 3.2
local function watchdog()
  if reaper.time_precise() - watch_started_at < WAIT_SECONDS then
    reaper.defer(watchdog)
    return
  end
  local handle = io.open(session_dir .. BS .. 'events.log', 'rb')
  local content = handle and handle:read('a') or ''
  if handle then
    handle:close()
  end
  local heartbeats, lines = {}, {}
  for line in content:gmatch('[^\r\n]+') do
    lines[#lines + 1] = line
    if line:match('^PROJECT_STATUS|') then
      heartbeats[#heartbeats + 1] = line
    end
  end
  write_file(
    'heartbeat-report.txt',
    table.concat({
      'total_lines=' .. #lines,
      'project_status_count=' .. #heartbeats,
      'waited_seconds=' .. tostring(reaper.time_precise() - watch_started_at),
      'heartbeats:',
      table.concat(heartbeats, '\n'),
    }, '\n')
  )
  -- report.txt is written last: run-reaper.ps1's -Done points at this file, so its existence is the "finished" signal.
  write_file('report.txt', 'p7 heartbeat verify done\nproject_status_count=' .. #heartbeats .. '\n')
end
reaper.defer(watchdog)
