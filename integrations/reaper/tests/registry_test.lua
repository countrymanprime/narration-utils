-- The command registry the bridge dispatches through, and the convention for adding a command in its own file.

local H = require('harness')

local function load_core()
  return dofile(H.join(host.reaper_dir, 'narration_bridge_core.lua'))
end

H.test('the registry maps names to handlers and lists them in order', function()
  local registry = load_core().new_registry()
  local function handler() end
  registry.register('zeta', handler)
  registry.register('alpha', handler)
  H.eq(registry.names(), { 'alpha', 'zeta' })
  H.truthy(registry.lookup('alpha') == handler, 'lookup returns the registered handler')
  H.eq(registry.lookup('missing'), nil)
end)

H.test('registering one command name twice is an error, so two features cannot silently shadow each other', function()
  local registry = load_core().new_registry()
  registry.register('prepare_compare', function() end)
  local ok, err = pcall(registry.register, 'prepare_compare', function() end)
  H.eq(ok, false)
  H.contains(err, 'prepare_compare')
end)

H.test('a handler must be a function', function()
  local registry = load_core().new_registry()
  local ok = pcall(registry.register, 'not_a_function', 'nope')
  H.eq(ok, false)
end)

H.test('the bridge registers exactly the commands the host and the docs know about', function()
  local s = H.session()
  H.eq(s.bridge.new_registry().names(), {
    'add_finding_marker',
    'add_take_fx',
    'apply_cleanup_trims',
    'apply_fx_chain',
    'arm_only',
    'chapter_track_state',
    'close',
    'configure_chapter_render',
    'count_pickups',
    'create_regions',
    'create_take',
    'export_compare_markers',
    'export_pickups',
    'import_pickups',
    'inspect_compare_results',
    'jump_to_compare_marker',
    'launch_cleanup_tool',
    'list_fx',
    'list_fx_chains',
    'loop_context',
    'navigate_item',
    'next_pickup',
    'pick_retake_lane',
    'ping',
    'play_position',
    'prepare_compare',
    'preview_cleanup_markers',
    'project_state',
    'punch_to',
    'read_line_ids',
    'record_start',
    'record_stop',
    'resolve_pickup',
    'set_active_take',
    'stamp_item_lines',
    'stop_loop',
  })
end)

H.test('every feature file the bridge loads is a Lua file in its folder, and the folder holds no unlisted feature', function()
  local s = H.session()
  -- The files that are not features: the launcher, the two shared helper modules, the bridge and its core.
  local infrastructure = {
    ['NarrationUtils_Launcher.lua'] = true,
    ['reaper_common_core.lua'] = true,
    ['reaper_common_process.lua'] = true,
    ['narration_ui_bridge.lua'] = true,
    ['narration_bridge_core.lua'] = true,
  }
  local listed = {}
  for _, name in ipairs(s.bridge.FEATURE_FILES) do
    listed[name] = true
  end
  H.truthy(#s.bridge.FEATURE_FILES >= 2, 'the bridge lists its feature files')
  local present = {}
  for _, name in ipairs(host.listdir(host.reaper_dir)) do
    present[name] = true
    if name:match('%.lua$') and not infrastructure[name] then
      H.truthy(listed[name], name .. ' is a Lua file the bridge does not load (add it to FEATURE_FILES)')
    end
  end
  for name in pairs(listed) do
    H.truthy(present[name], name .. ' is listed by the bridge but missing from the folder')
  end
end)

H.test('a handler receives the session, the fields after its name, and reports through ctx.event', function()
  local seen = {}
  local s = H.session({
    setup = function(registry)
      registry.register('probe', function(ctx, args)
        seen = { dir = ctx.session_dir, args = args }
        ctx.event('PROBED', args[1], args[2])
      end)
    end,
  })
  s:send('probe', 'run1', 'a b', 'x')
  H.eq(seen.dir, s.dir)
  H.eq(seen.args, { 'run1', 'a b', 'x' })
  H.eq(s:events(), { { 'PROBED', 'run1', 'a b' } })
end)

H.test('a command registered from a new file is dispatched like a built-in one', function()
  local s = H.session({
    setup = function(registry)
      registry.register('stop_now', function(ctx)
        ctx.stop()
      end)
    end,
  })
  s:send('stop_now')
  H.eq(#s.fake.deferred, 0, 'ctx.stop ends the loop, the way the close command does')
end)

H.test('an unexpected Lua error in a handler surfaces to REAPER, as it did before the registry', function()
  local s = H.session({
    setup = function(registry)
      registry.register('boom', function()
        error('handler exploded')
      end)
    end,
  })
  local ok = pcall(s.send, s, 'boom', 'run1')
  H.eq(ok, false)
end)
