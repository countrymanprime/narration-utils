-- NarrationUtils_Launcher.lua loaded the way REAPER loads it, from an installed bundle layout
-- (<bundle>/resources/reaper/*.lua next to <bundle>/narration-utils), so a renamed or unlisted Lua file
-- that the launcher `dofile`s fails here and not on a narrator's machine.

local H = require('harness')
local Fake = require('fake_reaper')

local function copy_scripts(target)
  host.makedirs(target)
  for _, name in ipairs(host.listdir(host.reaper_dir)) do
    if name:match('%.lua$') then
      H.write_file(H.join(target, name), assert(H.read_file(H.join(host.reaper_dir, name))))
    end
  end
end

-- The program is `narration-utils`, and `narration-utils.exe` on Windows (the release zip holds exactly that file, scripts/release/assets.mjs).
local function app_name(os_name)
  return os_name:find('Win') and 'narration-utils.exe' or 'narration-utils'
end

-- Builds the bundle, points the fake REAPER's action context at the launcher and returns the fake and its paths.
local function bundle(options)
  options = options or {}
  local root = host.tmpdir()
  local scripts = H.join(H.join(root, 'resources'), 'reaper')
  local os_name = options.os_name or 'Linux64'
  copy_scripts(scripts)
  if options.shell ~= false then
    H.write_file(H.join(root, app_name(os_name)), 'not really an executable')
  end
  local fake = Fake.new(host)
  fake.os_name = os_name
  fake.resource_path = H.join(root, 'REAPER')
  fake.action_path = H.join(scripts, 'NarrationUtils_Launcher.lua')
  fake.project_path = H.join(H.join(root, 'Projects'), 'Book.rpp')
  reaper = fake.reaper
  return fake, root, scripts
end

local function calls_named(fake, name)
  local out = {}
  for _, call in ipairs(fake.calls) do
    if call.name == name then
      out[#out + 1] = call
    end
  end
  return out
end

H.test('the launcher starts the app with the session, project and DAW arguments, then runs the bridge', function()
  local fake, root, scripts = bundle()
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  H.eq(#calls_named(fake, 'ShowMessageBox'), 0, 'no setup dialog')
  local launches = calls_named(fake, 'ExecProcess')
  H.eq(#launches, 1)
  local command = launches[1].command
  local session_root = H.join(H.join(fake.resource_path, 'NarrationUtils'), 'sessions')
  H.contains(command, H.join(H.join(H.join(scripts, '..'), '..'), 'narration-utils'), 'the app sits two folders above the scripts')
  H.contains(command, '--session-dir')
  H.contains(command, session_root .. package.config:sub(1, 1) .. 'hub_1001')
  H.contains(command, "--project-folder '" .. H.join(root, 'Projects') .. "'")
  H.contains(command, "--project-name 'Book'")
  H.contains(command, "--project-file '" .. H.join(H.join(root, 'Projects'), 'Book.rpp') .. "'")
  H.contains(command, "--daw 'REAPER'")
  H.eq(command:find('--repo-root', 1, true), nil, 'a release bundle passes no development paths')
  H.eq(#fake.deferred, 1, 'the bridge loop is running')
  H.eq(host.listdir(H.join(H.join(session_root, 'hub_1001'), 'commands')), {}, 'the command folder exists')
end)

H.test('the launcher reads the app path the app wrote beside it, whatever the program is called', function()
  local fake, root, scripts = bundle({ shell = false })
  local elsewhere = H.join(root, 'Program Files')
  host.makedirs(elsewhere)
  H.write_file(H.join(elsewhere, 'narration-utils-shell'), 'x')
  H.write_file(H.join(scripts, 'narration-utils-app-path.txt'), H.join(elsewhere, 'narration-utils-shell') .. '\n')
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  H.contains(calls_named(fake, 'ExecProcess')[1].command, H.join(elsewhere, 'narration-utils-shell'))
end)

H.test('an unsaved project launches with an empty project folder and a placeholder name', function()
  local fake, _, scripts = bundle()
  fake.project_path = ''
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  local command = calls_named(fake, 'ExecProcess')[1].command
  H.contains(command, "--project-folder ''")
  H.contains(command, "--project-name 'Unsaved REAPER project'")
  -- W5: an unsaved REAPER project has no file to link, so the app gets an
  -- empty --project-file and falls back to the picker instead of guessing.
  H.contains(command, "--project-file ''")
end)

-- PRD project-workspace-and-daw-link.prd.md Phase 5: the launcher passes the
-- exact rpp path as --project-file so the app can map it back to whichever
-- project's manifest links it (W5), even when that project's folder is not
-- the rpp's own containing folder (W4).
H.test('the launcher passes the exact rpp path as --project-file', function()
  local fake, _, scripts = bundle()
  fake.project_path = H.join(H.join(H.join(fake.resource_path, '..'), 'Elsewhere'), 'Novel.rpp')
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  local command = calls_named(fake, 'ExecProcess')[1].command
  H.contains(command, "--project-file '" .. fake.project_path .. "'")
  -- --project-folder still carries the rpp's own containing folder, unchanged:
  -- the Go side is what maps --project-file back to the linked project (W4/W5),
  -- not the launcher.
  H.contains(command, "--project-folder '" .. H.join(H.join(fake.resource_path, '..'), 'Elsewhere') .. "'")
end)

H.test('without a built app the launcher explains setup and starts nothing', function()
  local fake, _, scripts = bundle({ shell = false })
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  local boxes = calls_named(fake, 'ShowMessageBox')
  H.eq(#boxes, 1)
  H.eq(boxes[1].title, 'Narration Utils setup required')
  H.eq(#calls_named(fake, 'ExecProcess'), 0)
  H.eq(#fake.deferred, 0, 'the bridge never starts')
end)

H.test('a launcher beside missing libraries says so instead of failing silently', function()
  local fake, _, scripts = bundle()
  os.remove(H.join(scripts, 'narration_ui_bridge.lua'))
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  local boxes = calls_named(fake, 'ShowMessageBox')
  H.eq(#boxes, 1)
  H.contains(boxes[1].text, 'Could not load Narration Utils shared libraries')
  H.eq(#calls_named(fake, 'ExecProcess'), 0)
end)

H.test('a missing feature file is reported before the app starts', function()
  local fake, _, scripts = bundle()
  os.remove(H.join(scripts, 'narration_compare.lua'))
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  local boxes = calls_named(fake, 'ShowMessageBox')
  H.eq(#boxes, 1)
  H.contains(boxes[1].text, 'Could not load Narration Utils shared libraries')
  H.contains(boxes[1].text, 'narration_compare.lua', 'the message names the file that failed to load')
  H.eq(#calls_named(fake, 'ExecProcess'), 0)
end)

-- What the launcher runs to start the app. On macOS and Linux that is reaper.ExecProcess (recorded by the fake). On Windows it is a
-- one-line VBScript run by wscript through os.execute, which this test must not run: os.execute is replaced for the call, and the
-- script the launcher wrote is read back instead.
local function launch_command(fake, scripts)
  if not fake.os_name:find('Win') then
    dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
    local launches = calls_named(fake, 'ExecProcess')
    return #launches == 1 and launches[1].command or nil
  end
  local real_execute, captured = os.execute, nil
  os.execute = function(command)
    captured = command
    return true
  end
  local ok, failure = pcall(dofile, H.join(scripts, 'NarrationUtils_Launcher.lua'))
  os.execute = real_execute
  assert(ok, failure)
  if not captured then
    return nil
  end
  local script_path = assert(captured:match('//Nologo%s+"?([^"]+)"?$'), captured)
  return assert(H.read_file(script_path))
end

H.test('on Windows the bundle program is narration-utils.exe', function()
  local fake, _, scripts = bundle({ os_name = 'Win64' })
  local command = launch_command(fake, scripts)
  H.eq(#calls_named(fake, 'ShowMessageBox'), 0, 'no setup dialog')
  H.truthy(command, 'the app was started')
  H.contains(command, H.join(H.join(H.join(scripts, '..'), '..'), 'narration-utils.exe'))
end)

H.test('the old program name is not looked for any more', function()
  local fake, root, scripts = bundle({ shell = false })
  H.write_file(H.join(root, 'narration-utils-shell'), 'a build from before the rename')
  H.eq(launch_command(fake, scripts), nil, 'the old name does not start')
  H.eq(#calls_named(fake, 'ShowMessageBox'), 1)
end)

local function write_in(path, dirname, content)
  host.makedirs(dirname)
  H.write_file(path, content)
end

-- A checkout keeps the launcher at <repo>/integrations/reaper, so the bundle root and the repository root are the same folder and the
-- built program is found under apps/desktop/build/bin.
local function checkout(os_name, built)
  local root = host.tmpdir()
  local scripts = H.join(H.join(root, 'integrations'), 'reaper')
  copy_scripts(scripts)
  local windows = os_name:find('Win') ~= nil
  local venv = H.join(H.join(root, '.venv'), windows and 'Scripts' or 'bin')
  write_in(H.join(venv, windows and 'python.exe' or 'python'), venv, 'python')
  if built then
    local bin = H.join(H.join(H.join(root, 'apps'), 'desktop'), 'build/bin')
    write_in(H.join(bin, app_name(os_name)), bin, 'not really an executable')
  end
  local fake = Fake.new(host)
  fake.os_name = os_name
  fake.resource_path = H.join(root, 'REAPER')
  fake.action_path = H.join(scripts, 'NarrationUtils_Launcher.lua')
  fake.project_path = H.join(H.join(root, 'Projects'), 'Book.rpp')
  reaper = fake.reaper
  return fake, root, scripts
end

H.test('a checkout runs the program the build leaves in apps/desktop/build/bin', function()
  for _, os_name in ipairs({ 'Linux64', 'Win64' }) do
    local fake, _, scripts = checkout(os_name, true)
    local command = launch_command(fake, scripts)
    H.eq(#calls_named(fake, 'ShowMessageBox'), 0, os_name .. ': no setup dialog')
    H.truthy(command, os_name .. ': the app was started')
    local repo = H.join(H.join(scripts, '..'), '..')
    H.contains(command, H.join(H.join(H.join(H.join(repo, 'apps'), 'desktop'), 'build/bin'), app_name(os_name)), os_name .. ': the built program')
    H.contains(command, '--repo-root', os_name .. ': a checkout passes its development paths')
  end
end)

H.test('a checkout with no built program says so', function()
  local fake, _, scripts = checkout('Win64', false)
  H.eq(launch_command(fake, scripts), nil)
  local boxes = calls_named(fake, 'ShowMessageBox')
  H.eq(#boxes, 1)
  H.contains(boxes[1].text, 'has not been built yet')
  H.eq(boxes[1].text:find('shell app', 1, true), nil, 'the dialog does not use the internal name')
end)
