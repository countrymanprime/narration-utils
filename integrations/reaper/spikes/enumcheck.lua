-- Does reaper.EnumerateFiles cache a directory listing? Observes the listing after files appear and disappear, with and
-- without the documented "index -1 clears the cache" call, across frames.
local BS = string.char(92)
local dir_root = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)'):gsub(BS, '/')
local dir = (dir_root .. '/enum'):gsub('/', BS)
reaper.RecursiveCreateDirectory(dir, 0)
local out = {}
local function log(text)
  out[#out + 1] = text
end
local function write(name)
  local handle = assert(io.open(dir .. BS .. name, 'wb'))
  handle:write('x')
  handle:close()
end
local function list(clear)
  if clear then
    reaper.EnumerateFiles(dir, -1)
  end
  local names, index = {}, 0
  while true do
    local name = reaper.EnumerateFiles(dir, index)
    if not name or name == '' then
      break
    end
    names[#names + 1] = name
    index = index + 1
  end
  return table.concat(names, ',')
end

-- clean start
for _, name in ipairs({ 'a.cmd', 'b.cmd', 'c.cmd' }) do
  os.remove(dir .. BS .. name)
end
local frame = 0
local phase = 0
local start = reaper.time_precise()
local function tick()
  frame = frame + 1
  if phase == 0 then
    log('frame ' .. frame .. ' empty dir, no clear: [' .. list(false) .. ']')
    write('a.cmd')
    log('frame ' .. frame .. ' after creating a.cmd, no clear: [' .. list(false) .. ']')
    log('frame ' .. frame .. ' after creating a.cmd, with clear: [' .. list(true) .. ']')
    phase = 1
  elseif phase == 1 then
    os.remove(dir .. BS .. 'a.cmd')
    write('b.cmd')
    log('frame ' .. frame .. ' a removed, b created, no clear: [' .. list(false) .. ']')
    log('frame ' .. frame .. ' same, with clear: [' .. list(true) .. ']')
    phase = 2
  elseif phase == 2 then
    os.remove(dir .. BS .. 'b.cmd')
    write('c.cmd')
    log('frame ' .. frame .. ' b removed, c created, no clear: [' .. list(false) .. ']')
    phase = 3
    start = reaper.time_precise()
  elseif phase == 3 then
    local waited = reaper.time_precise() - start
    if waited > 3 then
      log(string.format('frame %d after %.1f s without clearing: [%s]', frame, waited, list(false)))
      phase = 4
    end
  else
    os.remove(dir .. BS .. 'c.cmd')
    local handle = io.open(dir_root .. '/enum-report.txt', 'wb')
    handle:write(table.concat(out, '\n'), '\n')
    handle:close()
    reaper.Main_OnCommand(40004, 0)
    return
  end
  reaper.defer(tick)
end
reaper.defer(tick)
