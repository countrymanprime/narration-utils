-- File-session adapter for the React-owned Narration Utils workspace.
-- No UI lives here: this module only reads REAPER selection state, applies
-- take markers, and moves the edit cursor on commands from the Go host.
--
-- This file owns the command loop and the registry that dispatches to the
-- commands; every command lives in a feature file listed in FEATURE_FILES
-- (narration_cleanup.lua, narration_compare.lua, narration_line_identity.lua, narration_pickups.lua,
-- narration_render.lua, narration_project_state.lua, narration_retake_lanes.lua, narration_take_review.lua, narration_navigation.lua,
-- narration_track_state.lua, narration_transport.lua, narration_workspace.lua, narration_regions.lua,
-- narration_punch.lua).
-- To add a command, put it in a new narration_<feature>.lua that returns
-- `function(registry)` and calls `registry.register(name, function(ctx, args) ... end)`,
-- list the file below and in scripts/release/reaper-files.mjs, and write its
-- harness tests. See docs/architecture/reaper-bridge.md.

local M = {}

-- The feature files, loaded once next to this file. A missing or broken one fails
-- the load, so the launcher reports it before it starts the app.
M.FEATURE_FILES = {
  'narration_cleanup.lua',
  'narration_compare.lua',
  'narration_line_identity.lua',
  'narration_pickups.lua',
  'narration_render.lua',
  'narration_project_state.lua',
  'narration_retake_lanes.lua',
  'narration_take_review.lua',
  'narration_navigation.lua',
  'narration_track_state.lua',
  'narration_transport.lua',
  'narration_workspace.lua',
  'narration_punch.lua',
  'narration_regions.lua',
}

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

-- How often the reachability heartbeat (PROJECT_STATUS) is appended, in reaper.time_precise() seconds (Phase 7,
-- ADR 0092 W10): frequent enough that the Go host's own poll (transcriptLoop, 150ms) notices REAPER closing
-- quickly, rare enough not to grow events.log without bound over a long session.
M.HEARTBEAT_INTERVAL_SECONDS = 1.5

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
  -- last_heartbeat_at is nil until the first tick, so the very first tick always sends one immediately: the app
  -- should not wait a full interval after REAPER starts before it can tell REAPER is running.
  local last_heartbeat_at = nil
  local function heartbeat()
    local now = reaper.time_precise()
    if last_heartbeat_at and (now - last_heartbeat_at) < M.HEARTBEAT_INTERVAL_SECONDS then
      return
    end
    last_heartbeat_at = now
    -- EnumProjects(-1, '') returns the active tab's path for a saved project and the exact empty string (never
    -- nil) for an unsaved one (spike S6, docs/research/reaper-spike-s6-daw-reachability.md); the run field
    -- (second argument to ctx.event) is deliberately empty, the broadcast shape events.go's fan-out already
    -- delivers to every subscriber regardless of which run they own (Subscription.wants).
    local _, rpp = reaper.EnumProjects(-1, '')
    rpp = rpp or ''
    -- The fourth field is REAPER's edit counter (GetProjectStateChangeCount), appended for DAW chapter-track auto-sync
    -- Phase 4, so the host can tell the project changed before it is saved. It is empty on a REAPER without the call,
    -- and wire.go treats it as optional, so an older script's three-field heartbeat still passes.
    local change_count = reaper.APIExists('GetProjectStateChangeCount') and reaper.GetProjectStateChangeCount(0) or ''
    ctx.event('PROJECT_STATUS', '', rpp, rpp == '' and '1' or '0', change_count)
  end
  local function tick()
    for _, name in ipairs(core.command_files(commands_dir)) do
      local path = core.join(commands_dir, name)
      local handle = io.open(path, 'r')
      -- A file that cannot be opened is already gone (a listing can be stale): nothing to run, nothing to report.
      if handle then
        local line = handle:read('*l') or ''
        handle:close()
        os.remove(path)
        local command = core.split(line, 8)
        if command[1] ~= '1' then
          ctx.event('ERROR', '', 'Unsupported hub protocol')
        else
          local handler = registry.lookup(command[2])
          if handler then
            local args = {}
            for index = 3, #command do
              args[#args + 1] = command[index]
            end
            handler(ctx, args)
          else
            ctx.event('ERROR', command[3] or '', 'Unsupported workspace command')
          end
        end
      end
    end
    heartbeat()
    if active then
      reaper.defer(tick)
    end
  end
  reaper.defer(tick)
end

return M
