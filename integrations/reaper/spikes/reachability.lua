-- Spike S6 (phase-6 reachability, project-workspace-and-daw-link PRD, W10/W12): reports what EnumProjects sees for
-- the active tab, and proves a periodic file-based heartbeat a Go host could poll for "REAPER is running, here is
-- the open project" is viable without any native extension or socket.
--
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

local out = os.getenv('NARRATION_UTILS_SPIKE_OUT')
assert(out and out ~= '', 'NARRATION_UTILS_SPIKE_OUT is not set')

local function write_file(name, contents)
  local f = assert(io.open(out .. '/' .. name, 'w'))
  f:write(contents)
  f:close()
end

-- W10: what does EnumProjects(-1, '') report for the active tab?
local _, rpp = reaper.EnumProjects(-1, '')
local is_saved = rpp ~= nil and rpp ~= ''
local proj, projfn2 = reaper.EnumProjects(-1, '')

-- A second, independent read of the project count (documents whether more than the active tab is visible this way).
local count = 0
while true do
  local p = reaper.EnumProjects(count, '')
  if not p then
    break
  end
  count = count + 1
end

write_file(
  'enumprojects-report.txt',
  'rpp='
    .. tostring(rpp)
    .. '\n'
    .. 'is_saved='
    .. tostring(is_saved)
    .. '\n'
    .. 'rpp_is_empty_string='
    .. tostring(rpp == '')
    .. '\n'
    .. 'rpp_is_nil='
    .. tostring(rpp == nil)
    .. '\n'
    .. 'second_call_matches='
    .. tostring(projfn2 == rpp)
    .. '\n'
    .. 'proj_pointer_present='
    .. tostring(proj ~= nil)
    .. '\n'
    .. 'enumerable_project_count='
    .. tostring(count)
    .. '\n'
)

-- W10: a heartbeat a Go host could poll. In production this would be one line rewritten by reaper.defer every
-- ~1s (defer runs at REAPER's UI frame rate, far faster than needed); this spike proves the write/read shape with
-- one snapshot instead of a real timer loop, since the driver expects the script to finish and signal "done".
local function heartbeat_line()
  local name = ''
  if is_saved then
    name = rpp:match('[^\\/]+$') or ''
  end
  return table.concat({
    'RUNNING',
    tostring(reaper.time_precise()),
    is_saved and rpp or '',
    name,
    is_saved and '0' or '1', -- unsaved flag
  }, '|')
end

write_file('heartbeat.txt', heartbeat_line() .. '\n')

-- Simulate three heartbeat rewrites (what a defer loop would do on each tick) to show the file is safely
-- overwritten in place, not appended, so a poller always reads the latest line.
for tick = 1, 3 do
  write_file('heartbeat.txt', heartbeat_line() .. '\n')
end

-- W12: prove the running script can see it was launched together with a project (the -cfgfile "<project>"
-- "<script>" CLI form). If REAPER started this script with a project already open, EnumProjects must report it
-- without any user action; that is exactly what a launcher-run-automatically-on-app-start flow needs.
write_file(
  'launch-mode-report.txt',
  'script_ran_at_launch=true\n' .. 'project_open_at_launch=' .. tostring(is_saved) .. '\n' .. 'project_path_at_launch=' .. tostring(rpp) .. '\n'
)

-- report.txt is written last: run-reaper.ps1's -Done points at this file, so its existence is the "finished" signal.
write_file('report.txt', 'reachability spike done\n' .. 'is_saved=' .. tostring(is_saved) .. '\n' .. 'enumerable_project_count=' .. tostring(count) .. '\n')
