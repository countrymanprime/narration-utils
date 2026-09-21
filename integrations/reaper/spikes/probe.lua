-- Guard (owner decision D3): refuse to run unless REAPER's resource path is the scratch -Cfg folder run-reaper.ps1 passed,
-- and the audio device is closed. A script that is started any other way stops here instead of touching real settings.
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

local dir = reaper.GetResourcePath()
local f = io.open(dir .. '/probe.txt', 'w')
local info = debug and debug.getinfo and debug.getinfo(1, 'S').source or 'no debug.getinfo'
local ok_ctx, ctx = reaper.get_action_context()
f:write(
  'version=',
  reaper.GetAppVersion(),
  '\n',
  'lua=',
  _VERSION,
  '\n',
  'os=',
  reaper.GetOS(),
  '\n',
  'resource=',
  dir,
  '\n',
  'source=',
  tostring(info),
  '\n',
  'ctx=',
  tostring(ctx),
  '\n'
)
f:close()
reaper.Main_OnCommand(40004, 0)
