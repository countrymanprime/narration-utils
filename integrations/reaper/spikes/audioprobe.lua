-- Reports which audio device REAPER has open right after it starts (no guard: this is what the guard exists for). Run with
-- run-reaper.ps1; the result is written to REAPER's resource directory (the scratch -Cfg folder).
local out = io.open(reaper.GetResourcePath() .. '/audioprobe.txt', 'wb')
local function log(...)
  local parts = {}
  for index = 1, select('#', ...) do
    parts[#parts + 1] = tostring((select(index, ...)))
  end
  out:write(table.concat(parts, ' '), '\n')
end
log('Audio_IsRunning', reaper.Audio_IsRunning())
for _, key in ipairs({ 'MODE', 'IDENT_IN', 'IDENT_OUT', 'BSIZE', 'SRATE', 'REAFIRE', 'ASIO_DRIVER' }) do
  log('GetAudioDeviceInfo', key, reaper.GetAudioDeviceInfo(key, ''))
end
log('inputs', reaper.GetNumAudioInputs(), 'outputs', reaper.GetNumAudioOutputs())
log('latency', reaper.GetInputOutputLatency())
out:close()
reaper.Main_OnCommand(40004, 0)
