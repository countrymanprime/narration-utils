-- Shared helpers and the command registry of the REAPER bridge (narration_ui_bridge.lua and the feature files it
-- loads: narration_compare.lua, narration_line_identity.lua). The protocol helpers here match bridge.go: fields are
-- percent-encoded and separated by `|`, and events are appended to events.log one line at a time.

local M = {}
local SEP = package.config:sub(1, 1)
local function join(base, child)
  return base .. SEP .. child
end

local function encode(value)
  return tostring(value or ''):gsub('[^%w%-_%.~]', function(c)
    return string.format('%%%02X', string.byte(c))
  end)
end
local function decode(value)
  return (tostring(value or ''):gsub('%%(%x%x)', function(hex)
    return string.char(tonumber(hex, 16))
  end))
end
local function split(line, count)
  local fields, start = {}, 1
  while #fields < count - 1 do
    local at = line:find('|', start, true)
    if not at then
      break
    end
    fields[#fields + 1], start = decode(line:sub(start, at - 1)), at + 1
  end
  fields[#fields + 1] = decode(line:sub(start):gsub('[\r\n]+$', ''))
  return fields
end
local function event(session_dir, tag, ...)
  local values = { tag }
  for _, value in ipairs({ ... }) do
    values[#values + 1] = encode(value)
  end
  local handle = io.open(join(session_dir, 'events.log'), 'a')
  if handle then
    handle:write(table.concat(values, '|') .. '\n')
    handle:close()
  end
end
-- reaper.EnumerateFiles caches a directory's listing until it is called with index -1: without that, a file created
-- after the first call is not listed and a removed one still is (seen in REAPER 7.80), so a command would be read late
-- or as a ghost. The clear comes first on every call.
local function command_files(directory)
  reaper.EnumerateFiles(directory, -1)
  local names, index = {}, 0
  while true do
    local name = reaper.EnumerateFiles(directory, index)
    if not name or name == '' then
      break
    end
    if name:match('%.cmd$') then
      names[#names + 1] = name
    end
    index = index + 1
  end
  table.sort(names)
  return names
end
local function file_exists(path)
  local f = io.open(path, 'rb')
  if f then
    f:close()
    return true
  end
  return false
end
local function dirname(path)
  return path:match('^(.*)[\\/][^\\/]-$') or ''
end
local function safe_name(value)
  return (value:gsub('[<>:"/\\|?*]', '_'))
end
local function color(hex)
  local r, g, b = tonumber((hex or ''):sub(1, 2), 16) or 0, tonumber((hex or ''):sub(3, 4), 16) or 0, tonumber((hex or ''):sub(5, 6), 16) or 0
  -- ColorToNative returns an RGB value below bit 24; adding the custom-color
  -- flag is equivalent to setting that bit and keeps this bridge Lua 5.1-safe.
  return reaper.ColorToNative(r, g, b) + 0x1000000
end
local function pipe_fields(value, count)
  local out, start = {}, 1
  while #out < count - 1 do
    local at = value:find('|', start, true)
    if not at then
      break
    end
    out[#out + 1], start = value:sub(start, at - 1), at + 1
  end
  out[#out + 1] = value:sub(start)
  return out
end

-- A take marker's issue prefix: "MISREAD: ..." is MISREAD. Case-insensitive, empty when the name has none.
local function marker_kind(name)
  local prefix = tostring(name or ''):match('^%s*([%a_]+)%s*:')
  return prefix and prefix:upper() or ''
end
-- The name of a marker `take` already has for `kind` near `srcpos`, or nil: the same issue prefix within 0.15 s of source
-- time (docs/architecture/daw-integration.md). Transcript Compare's export and the Review page's approved marker
-- (narration_navigation.lua) both skip a marker this finds, so neither ever doubles one.
local function existing_take_marker(take, kind, srcpos)
  local count = reaper.GetNumTakeMarkers(take)
  for index = 0, count - 1 do
    local marker_pos, marker_name = reaper.GetTakeMarker(take, index)
    if marker_kind(marker_name) == tostring(kind or ''):upper() and math.abs(marker_pos - srcpos) <= 0.15 then
      return marker_name
    end
  end
  return nil
end

-- The registry maps a command name to a handler `handler(ctx, args)`: `ctx` carries the session directory, `event`
-- (append an event to events.log) and `stop` (end the loop); `args` are the command's fields after its name. A
-- name may be registered once, so two features cannot silently shadow each other's command.
function M.new_registry()
  local commands = {}
  local registry = {}
  function registry.register(name, handler)
    if type(name) ~= 'string' or name == '' then
      error('a bridge command needs a name', 2)
    end
    if type(handler) ~= 'function' then
      error('bridge command ' .. name .. ' needs a handler function', 2)
    end
    if commands[name] then
      error('bridge command ' .. name .. ' is already registered', 2)
    end
    commands[name] = handler
  end
  function registry.lookup(name)
    return commands[name]
  end
  function registry.names()
    local out = {}
    for name in pairs(commands) do
      out[#out + 1] = name
    end
    table.sort(out)
    return out
  end
  return registry
end

M.SEP = SEP
M.join = join
M.encode = encode
M.decode = decode
M.split = split
M.event = event
M.command_files = command_files
M.file_exists = file_exists
M.dirname = dirname
M.safe_name = safe_name
M.color = color
M.pipe_fields = pipe_fields
M.marker_kind = marker_kind
M.existing_take_marker = existing_take_marker

return M
