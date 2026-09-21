-- File-session adapter for the React-owned Narration Utils workspace.
-- No UI lives here: this module only reads REAPER selection state, applies
-- take markers, and moves the edit cursor on commands from the Go host.
--
-- This file owns the command loop and the registry that dispatches to the
-- commands; every command lives in a feature file listed in FEATURE_FILES
-- (narration_compare.lua, narration_line_identity.lua). To add a command, put
-- it in a new narration_<feature>.lua that returns `function(registry)` and
-- calls `registry.register(name, function(ctx, args) ... end)`, list the file
-- below and in scripts/release/reaper-files.mjs, and write its harness tests.
-- See docs/architecture/reaper-bridge.md.

local M = {}

-- The feature files, loaded once next to this file. A missing or broken one fails
-- the load, so the launcher reports it before it starts the app.
M.FEATURE_FILES = { 'narration_compare.lua', 'narration_line_identity.lua' }

local function own_directory()
  local source = debug and debug.getinfo and debug.getinfo(1, 'S').source or ''
  local path = source:match('^@(.+)$')
  if not path then
    -- The launcher sits in this folder and is the running action, so its path names it.
    local _, action_path = reaper.get_action_context()
    path = action_path
  end
  return (path or ''):match('^(.*)[\\/][^\\/]-$') or '.'
end

local directory = own_directory()
local core = dofile(directory .. package.config:sub(1, 1) .. 'narration_bridge_core.lua')
local features = {}
for _, name in ipairs(M.FEATURE_FILES) do
  local chunk = assert(loadfile(core.join(directory, name)))
  local register = chunk(core)
  assert(type(register) == 'function', name .. ' must return function(registry)')
  features[#features + 1] = register
end

-- A registry holding every built-in command. Each call gives fresh feature state (the Transcript Compare runs).
function M.new_registry()
  local registry = core.new_registry()
  for _, register in ipairs(features) do
    register(registry)
  end
  registry.register('close', function(ctx)
    ctx.stop()
  end)
  return registry
end

function M.run(session_dir, registry)
  registry = registry or M.new_registry()
  local commands_dir, active = core.join(session_dir, 'commands'), true
  local ctx = {
    session_dir = session_dir,
    event = function(tag, ...)
      core.event(session_dir, tag, ...)
    end,
    stop = function()
      active = false
    end,
  }
  local function tick()
    for _, name in ipairs(core.command_files(commands_dir)) do
      local path = core.join(commands_dir, name)
      local handle = io.open(path, 'r')
      local line = handle and handle:read('*l') or ''
      if handle then
        handle:close()
      end
      os.remove(path)
      local command = core.split(line, 8)
      if command[1] ~= '1' then
        ctx.event('ERROR', 'Unsupported hub protocol')
      else
        local handler = registry.lookup(command[2])
        if handler then
          local args = {}
          for index = 3, #command do
            args[#args + 1] = command[index]
          end
          handler(ctx, args)
        else
          ctx.event('ERROR', 'Unsupported workspace command')
        end
      end
    end
    if active then
      reaper.defer(tick)
    end
  end
  reaper.defer(tick)
end

return M
