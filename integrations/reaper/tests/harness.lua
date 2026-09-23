-- The bridge test harness: a tiny test registry, assertions, and a `session` that drives narration_ui_bridge.lua
-- through the same file protocol the Go host uses (`commands/NNNNNNNN.cmd` in, `events.log` out) against a fake
-- `reaper` table. Test files `require('harness')`, register tests with `H.test`, and the runner calls `H.run()`.

local Fake = require('fake_reaper')

local H = {}
local SEP = package.config:sub(1, 1)
local tests = {}
local sessions = {}
local INSTRUCTION_BUDGET = 200000000

function H.join(base, child)
  return base .. SEP .. child
end

-- Reads a whole file, or returns nil when it does not exist.
function H.read_file(path)
  local handle = io.open(path, 'rb')
  if not handle then
    return nil
  end
  local content = handle:read('a')
  handle:close()
  return content
end

-- Reads a file the bridge wrote in text mode: on Windows Lua writes CRLF, and the Go host trims the CR the same way.
function H.read_text(path)
  local content = H.read_file(path)
  return content and (content:gsub('\r\n', '\n'))
end

function H.write_file(path, content)
  local handle = assert(io.open(path, 'wb'))
  handle:write(content)
  handle:close()
end

function H.lines(text)
  local out = {}
  for line in (text or ''):gmatch('[^\n]+') do
    out[#out + 1] = line
  end
  return out
end

-- Percent encoding identical to bridge.go's PercentEncode (RFC 3986 unreserved characters pass through).
function H.encode(value)
  return (tostring(value):gsub('[^%w%-_%.~]', function(char)
    return string.format('%%%02X', string.byte(char))
  end))
end

function H.decode(value)
  return (value:gsub('%%(%x%x)', function(hex)
    return string.char(tonumber(hex, 16))
  end))
end

-- Assertions -----------------------------------------------------------------------------------------------------

local function show(value, seen)
  if type(value) ~= 'table' then
    return type(value) == 'string' and string.format('%q', value) or tostring(value)
  end
  seen = seen or {}
  if seen[value] then
    return '<cycle>'
  end
  seen[value] = true
  local keys = {}
  for key in pairs(value) do
    keys[#keys + 1] = key
  end
  table.sort(keys, function(a, b)
    return tostring(a) < tostring(b)
  end)
  local parts = {}
  for _, key in ipairs(keys) do
    parts[#parts + 1] = (type(key) == 'number' and '' or tostring(key) .. '=') .. show(value[key], seen)
  end
  return '{' .. table.concat(parts, ', ') .. '}'
end

local function same(a, b)
  if type(a) ~= type(b) then
    return false
  end
  if type(a) ~= 'table' then
    return a == b
  end
  for key, value in pairs(a) do
    if not same(value, b[key]) then
      return false
    end
  end
  for key in pairs(b) do
    if a[key] == nil then
      return false
    end
  end
  return true
end

function H.eq(actual, expected, label)
  if not same(actual, expected) then
    error(string.format('%sexpected %s\n     got %s', label and (label .. ': ') or '', show(expected), show(actual)), 2)
  end
end

function H.truthy(value, label)
  if not value then
    error((label or 'expected a truthy value') .. ' (got ' .. tostring(value) .. ')', 2)
  end
end

function H.contains(text, needle, label)
  if not tostring(text):find(needle, 1, true) then
    error(string.format('%sexpected %s to contain %q', label and (label .. ': ') or '', show(text), needle), 2)
  end
end

-- Registry -------------------------------------------------------------------------------------------------------

function H.test(name, fn)
  tests[#tests + 1] = { name = name, fn = fn }
end

-- Runs the registered tests, each in a fresh session directory. Returns passed, failed, and a report string.
function H.run(file_label)
  local passed, failed, report = 0, 0, {}
  for _, entry in ipairs(tests) do
    sessions = {}
    -- A mutated bridge can loop forever; the instruction budget turns that into a failing test.
    debug.sethook(function()
      error('test exceeded its instruction budget (endless loop?)')
    end, '', INSTRUCTION_BUDGET)
    local ok, err = xpcall(function()
      entry.fn()
      for _, session in ipairs(sessions) do
        H.eq(session.fake.open_undo_blocks, 0, 'every Undo_BeginBlock2 must be closed by Undo_EndBlock2')
      end
    end, function(message)
      return tostring(message) .. '\n' .. debug.traceback('', 2)
    end)
    debug.sethook()
    if ok then
      passed = passed + 1
    else
      failed = failed + 1
      report[#report + 1] = string.format('FAIL %s :: %s\n  %s', file_label, entry.name, (tostring(err):gsub('\n', '\n  ')))
    end
  end
  return passed, failed, table.concat(report, '\n')
end

-- Session --------------------------------------------------------------------------------------------------------

local Session = {}
Session.__index = Session

-- Builds a fake REAPER, installs it as the global `reaper`, loads the bridge module fresh from the source directory
-- and starts it on a new session directory (the same call the launcher makes).
function H.session(options)
  options = options or {}
  local session_dir = host.tmpdir()
  local fake = Fake.new(host)
  fake.project_path = options.project_path == nil and '' or options.project_path
  fake.resource_path = session_dir
  reaper = fake.reaper
  local self = setmetatable({ fake = fake, dir = session_dir, sent = 0, read_offset = 0 }, Session)
  host.makedirs(H.join(session_dir, 'commands'))
  local bridge = dofile(H.join(host.reaper_dir, 'narration_ui_bridge.lua'))
  -- `setup(registry)` may register extra commands before the loop starts (a test double, or a new feature under test).
  local registry = options.setup and bridge.new_registry() or nil
  if registry then
    options.setup(registry)
  end
  bridge.run(session_dir, registry)
  self.bridge = bridge
  sessions[#sessions + 1] = self
  return self
end

-- Writes one command file (protocol version 1) and runs one bridge tick, like the host sending it and REAPER's
-- next defer cycle picking it up. Returns nothing; read results with :events().
function Session:send(command, ...)
  return self:send_raw(H.encode('1') .. '|' .. H.encode(command) .. self:encode_args(...))
end

function Session:encode_args(...)
  local out = {}
  for _, value in ipairs({ ... }) do
    out[#out + 1] = '|' .. H.encode(value)
  end
  return table.concat(out)
end

-- Writes an exact command line, so a test can send a malformed or unsupported one.
function Session:send_raw(line)
  self.sent = self.sent + 1
  local path = H.join(H.join(self.dir, 'commands'), string.format('%08d.cmd', self.sent))
  H.write_file(path, line .. '\n')
  self:tick()
end

function Session:tick()
  self.fake:pump()
end

-- Every event appended since the last call, each as a list of percent-decoded fields, except the reachability
-- heartbeat (PROJECT_STATUS, narration_ui_bridge.lua's tick loop, Phase 7/ADR 0092): it is appended on every
-- session's first tick regardless of what the test is driving, so it would otherwise show up as a stray trailing
-- event in every test file's exact event-list assertions. reachability_test.lua, which tests the heartbeat itself,
-- reads the raw log through all_events() instead.
function Session:events()
  local out = {}
  for _, event in ipairs(self:all_events()) do
    if event[1] ~= 'PROJECT_STATUS' then
      out[#out + 1] = event
    end
  end
  return out
end

-- Every event appended since the last call to events() or all_events(), including PROJECT_STATUS.
function Session:all_events()
  local text = H.read_text(H.join(self.dir, 'events.log')) or ''
  local fresh = text:sub(self.read_offset + 1)
  self.read_offset = #text
  local out = {}
  for _, line in ipairs(H.lines(fresh)) do
    local fields = {}
    for part in (line .. '|'):gmatch('(.-)|') do
      fields[#fields + 1] = H.decode(part)
    end
    out[#out + 1] = fields
  end
  return out
end

-- The path of a file inside the session directory.
function Session:path(name)
  return H.join(self.dir, name)
end

-- Names still waiting in commands/ (the bridge deletes each command it reads).
function Session:pending_commands()
  return host.listdir(H.join(self.dir, 'commands'))
end

return H
