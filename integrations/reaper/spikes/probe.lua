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
