-- NarrationUtils_Launcher.lua loaded the way REAPER loads it, from an installed bundle layout
-- (<bundle>/resources/reaper/*.lua next to <bundle>/narration-utils-shell), so a renamed or unlisted Lua file
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

-- Builds the bundle, points the fake REAPER's action context at the launcher and returns the fake and its paths.
local function bundle(options)
  options = options or {}
  local root = host.tmpdir()
  local scripts = H.join(H.join(root, 'resources'), 'reaper')
  copy_scripts(scripts)
  if options.shell ~= false then
    H.write_file(H.join(root, 'narration-utils-shell'), 'not really an executable')
  end
  local fake = Fake.new(host)
  fake.os_name = 'Linux64'
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

H.test('the launcher starts the shell with the session, project and DAW arguments, then runs the bridge', function()
  local fake, root, scripts = bundle()
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  H.eq(#calls_named(fake, 'ShowMessageBox'), 0, 'no setup dialog')
  local launches = calls_named(fake, 'ExecProcess')
  H.eq(#launches, 1)
  local command = launches[1].command
  local session_root = H.join(H.join(fake.resource_path, 'NarrationUtils'), 'sessions')
  H.contains(command, H.join(H.join(H.join(scripts, '..'), '..'), 'narration-utils-shell'), 'the shell sits two folders above the scripts')
  H.contains(command, '--session-dir')
  H.contains(command, session_root .. package.config:sub(1, 1) .. 'hub_1001')
  H.contains(command, "--project-folder '" .. H.join(root, 'Projects') .. "'")
  H.contains(command, "--project-name 'Book'")
  H.contains(command, "--daw 'REAPER'")
  H.eq(command:find('--repo-root', 1, true), nil, 'a release bundle passes no development paths')
  H.eq(#fake.deferred, 1, 'the bridge loop is running')
  H.eq(host.listdir(H.join(H.join(session_root, 'hub_1001'), 'commands')), {}, 'the command folder exists')
end)

H.test('the launcher reads the shell path the app wrote beside it', function()
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
end)

H.test('without a built shell the launcher explains setup and starts nothing', function()
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

H.test('a missing feature file is reported before the shell starts', function()
  local fake, _, scripts = bundle()
  os.remove(H.join(scripts, 'narration_compare.lua'))
  dofile(H.join(scripts, 'NarrationUtils_Launcher.lua'))
  local boxes = calls_named(fake, 'ShowMessageBox')
  H.eq(#boxes, 1)
  H.contains(boxes[1].text, 'Could not load Narration Utils shared libraries')
  H.contains(boxes[1].text, 'narration_compare.lua', 'the message names the file that failed to load')
  H.eq(#calls_named(fake, 'ExecProcess'), 0)
end)
