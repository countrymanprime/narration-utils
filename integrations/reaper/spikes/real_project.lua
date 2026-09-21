-- Spike S0, part 3: what stamping and saving do to a REAL project. Run with `-Project <a COPY of a narrator's .rpp in a temp
-- folder>` (see README.md: never the original). The script re-saves the open copy unchanged (to <out>/real-resaved.rpp),
-- then stamps its first items through the real bridge, reads them back, saves again (<out>/real-stamped.rpp) and writes
-- <out>/real-report.txt. Compare the two saved files: stamping should add only extension blocks to the resaved one.

local BS = string.char(92)
local function native(path)
  return (path:gsub('/', BS))
end
local OUT = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)'):gsub(BS, '/')
local REPO_REAPER = assert(os.getenv('NARRATION_UTILS_REAPER_DIR'), 'set NARRATION_UTILS_REAPER_DIR (run-reaper.ps1 does)'):gsub(BS, '/')
local STAMP_COUNT = 5
local report = {}
local function log(text)
  report[#report + 1] = text
end
local function finish()
  local handle = io.open(OUT .. '/real-report.txt', 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
  reaper.Main_OnCommand(40004, 0)
end

local session_dir = native(OUT .. '/session')
local sent, read_offset = 0, 0
local function encode(value)
  return (tostring(value):gsub('[^%w%-_%.~]', function(char)
    return string.format('%%%02X', string.byte(char))
  end))
end
local function send(command, ...)
  sent = sent + 1
  local fields = { '1', command, ... }
  for index, value in ipairs(fields) do
    fields[index] = encode(value)
  end
  local final = session_dir .. BS .. 'commands' .. BS .. string.format('%08d.cmd', sent)
  local handle = assert(io.open(final .. '.tmp', 'wb'))
  handle:write(table.concat(fields, '|'), '\n')
  handle:close()
  assert(os.rename(final .. '.tmp', final))
end
local function new_event_lines()
  local handle = io.open(session_dir .. BS .. 'events.log', 'rb')
  if not handle then
    return {}
  end
  local text = handle:read('a'):gsub('\r\n', '\n')
  handle:close()
  local fresh = text:sub(read_offset + 1)
  read_offset = #text
  local out = {}
  for line in fresh:gmatch('[^\n]+') do
    out[#out + 1] = line
  end
  return out
end
local function frames(count)
  for _ = 1, count do
    coroutine.yield()
  end
end
local function run(command, expect_tag, ...)
  new_event_lines()
  send(command, ...)
  local collected = {}
  for _ = 1, 200 do
    frames(1)
    for _, line in ipairs(new_event_lines()) do
      collected[#collected + 1] = line
    end
    for _, line in ipairs(collected) do
      if line:find('^' .. expect_tag) or line:find('^ERROR') then
        return collected
      end
    end
  end
  return collected
end

local body = function()
  local _, opened = reaper.EnumProjects(-1, '')
  log('opened ' .. tostring(opened:match('[^\\/]+$')) .. '  REAPER ' .. reaper.GetAppVersion())
  local tracks, items = reaper.CountTracks(0), reaper.CountMediaItems(0)
  local _, markers, regions = reaper.CountProjectMarkers(0)
  log(string.format('tracks %d, items %d, markers %d, regions %d', tracks, items, markers, regions))
  local offline = 0
  for index = 0, items - 1 do
    local take = reaper.GetActiveTake(reaper.GetMediaItem(0, index))
    if take and not reaper.TakeIsMIDI(take) then
      local source = reaper.GetMediaItemTake_Source(take)
      local file = reaper.GetMediaSourceFileName(source, '')
      local handle = file ~= '' and io.open(file, 'rb')
      if handle then
        handle:close()
      else
        offline = offline + 1
      end
    end
  end
  log(string.format('items whose media file is not present here: %d of %d (the copy holds only the .rpp)', offline, items))
  local stamped_before = 0
  for index = 0, items - 1 do
    if select(2, reaper.GetSetMediaItemInfo_String(reaper.GetMediaItem(0, index), 'P_EXT:narration_utils_line_id', '', false)) ~= '' then
      stamped_before = stamped_before + 1
    end
  end
  log('items already carrying a line id: ' .. stamped_before)

  -- 1. An unchanged re-save, so the diff against the stamped save isolates what stamping adds.
  reaper.RecursiveCreateDirectory(native(OUT), 0)
  reaper.Main_SaveProjectEx(0, native(OUT .. '/real-resaved.rpp'), 0)
  log('re-saved unchanged as real-resaved.rpp')

  -- 2. Stamp the first items (by GUID) through the real bridge, read them back.
  reaper.RecursiveCreateDirectory(session_dir .. BS .. 'commands', 0)
  local bridge = dofile(REPO_REAPER .. '/narration_ui_bridge.lua')
  bridge.run(session_dir)
  frames(3)
  local payload_lines, guids = {}, {}
  for index = 0, math.min(STAMP_COUNT, items) - 1 do
    local item = reaper.GetMediaItem(0, index)
    local _, guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
    guids[#guids + 1] = guid
    payload_lines[#payload_lines + 1] = string.format('%s|line-%06d|Line %d of the copy.', guid, index + 1, index + 1)
  end
  local payload = native(OUT .. '/real-stamp.txt')
  local handle = assert(io.open(payload, 'wb'))
  handle:write(table.concat(payload_lines, '\n'), '\n')
  handle:close()
  log('GUID format of the first item: ' .. tostring(guids[1]))
  local events = run('stamp_item_lines', 'LINES_STAMPED', 'r1', payload, '0')
  log('stamp events: ' .. table.concat(events, ' ; '))
  local lines_file = native(OUT .. '/real-lines.txt')
  events = run('read_line_ids', 'LINES_READ', 'r2', lines_file)
  log('read events: ' .. table.concat(events, ' ; '))
  reaper.Main_SaveProjectEx(0, native(OUT .. '/real-stamped.rpp'), 0)
  log('saved with the stamps as real-stamped.rpp')
  events = run('close', 'NONE')
end

local co = coroutine.create(function()
  local ok, err = xpcall(body, debug.traceback)
  if not ok then
    log('ERROR ' .. tostring(err))
  end
  finish()
end)
local function step()
  if coroutine.status(co) ~= 'dead' then
    local ok, err = coroutine.resume(co)
    if not ok then
      log('DRIVER ERROR ' .. tostring(err))
      finish()
      return
    end
    reaper.defer(step)
  end
end
reaper.defer(step)
