-- Narration Utils - the sole REAPER action for the suite.
-- Launches the native Go/Wails shell app. Closing the shell's window is the only thing that stops it. Python only runs as a
-- short-lived subprocess the shell spawns for Story Bible builds and
-- transcript comparisons, never as a supervised server. REAPER itself has
-- no workflow UI; the bridge below only services requests from that
-- workspace.

local function script_dir()
  local _, path = reaper.get_action_context()
  return path:match('^(.*)[\\/]') or '.'
end

local SHARED = script_dir()
local SEP = package.config:sub(1, 1)
local function join(base, child)
  return base .. SEP .. child
end
local ok_core, common = pcall(dofile, join(SHARED, 'reaper_common_core.lua'))
local ok_proc, process = pcall(dofile, join(SHARED, 'reaper_common_process.lua'))
local ok_bridge, bridge = pcall(dofile, join(SHARED, 'narration_ui_bridge.lua'))
if not ok_core or not ok_proc or not ok_bridge then
  reaper.ShowMessageBox('Could not load Narration Utils shared libraries from:\n' .. SHARED, 'Narration Utils', 0)
  return
end

local REPO_ROOT = join(join(SHARED, '..'), '..')
-- In a release bundle this file lives under
--   <app>/resources/reaper/NarrationUtils_Launcher.lua
-- so the Wails executable is two directories above it. A developer checkout
-- keeps the older relative layout and explicitly supplies its Python tools.
local BUNDLE_ROOT = join(join(SHARED, '..'), '..')

-- Embedded Wails resources are materialized in a per-user cache.  The Go
-- host writes the installed executable path beside this script, so an action
-- imported from Settings continues to work after the app moves or updates.
-- This remains an explicit REAPER import: the app never installs actions.
local configured_shell = common.read_file(SHARED .. SEP .. 'narration-utils-app-path.txt'):gsub('[\r\n]+$', '')

local function project_context()
  local _, rpp = reaper.EnumProjects(-1, '')
  if not rpp or rpp == '' then
    return '', 'Unsaved REAPER project'
  end
  local name = rpp:match('[^\\/]+$') or 'REAPER project'
  name = name:match('^(.*)%.[^.]+$') or name
  return rpp:match('^(.*)[\\/][^\\/]-$') or '', name
end

-- The only REAPER configuration is this launcher action. A release bundle
-- owns immutable sidecars inside the Wails executable; a checkout provides
-- explicit development paths. Neither mode starts a browser server.
local is_windows = reaper.GetOS():find('Win') ~= nil
local shared_python = is_windows and join(join(join(REPO_ROOT, '.venv'), 'Scripts'), 'python.exe') or join(join(REPO_ROOT, '.venv'), 'bin/python')
local manuscript_core = join(join(join(REPO_ROOT, 'sidecars'), 'manuscript-guide'), 'core')
local compare_core = join(join(join(REPO_ROOT, 'sidecars'), 'transcript-compare'), 'core')
local manuscript_python = shared_python
local manuscript_backend = join(manuscript_core, 'manuscript_guide.py')
local compare_python = shared_python
local compare_backend = join(compare_core, 'compare.py')
local shell_name = is_windows and 'narration-utils-shell.exe' or 'narration-utils-shell'
local bundled_shell = configured_shell ~= '' and configured_shell or join(BUNDLE_ROOT, shell_name)
local checkout_shell = join(join(join(join(REPO_ROOT, 'apps'), 'desktop'), 'build/bin'), shell_name)
local release_mode = common.file_exists(bundled_shell)
local shell_exe = release_mode and bundled_shell or checkout_shell

local project_folder, project_name = project_context()
local session_dir = join(join(join(reaper.GetResourcePath(), 'NarrationUtils'), 'sessions'), 'hub_' .. tostring(reaper.time_precise()):gsub('[%.]', ''))
reaper.RecursiveCreateDirectory(join(session_dir, 'commands'), 0)

if not release_mode and not common.file_exists(shared_python) then
  reaper.ShowMessageBox(
    'Narration Utils has not been set up in this checkout yet.\n\n'
      .. 'From the repository root, run:\n\n'
      .. '  pnpm run bootstrap\n\n'
      .. 'It creates the local Python environment and builds the workspace.\n'
      .. 'Optional spaCy models and Piper voices are not downloaded at setup.\n\n'
      .. 'Diagnostic session:\n'
      .. session_dir,
    'Narration Utils setup required',
    0
  )
  return
end

if not common.file_exists(shell_exe) then
  reaper.ShowMessageBox(
    'The Narration Utils shell app has not been built yet.\n\n' .. 'From this checkout, run:\n  pnpm run bootstrap\n\n' .. 'Then launch Narration Utils again.',
    'Narration Utils setup required',
    0
  )
  return
end

local function quote(value)
  return process.quote(value)
end
-- No probe/reuse step here anymore: the shell exe owns single-instance
-- detection itself and simply forwards to
-- its already-running window instead of spawning a second backend, so
-- every launch just spawns the shell unconditionally.
local command = quote(shell_exe)
  .. ' --session-dir '
  .. quote(session_dir)
  .. ' --project-folder '
  .. quote(project_folder)
  .. ' --project-name '
  .. quote(project_name)
  .. ' --daw '
  .. quote('REAPER')

if not release_mode then
  command = command
    .. ' --repo-root '
    .. quote(REPO_ROOT)
    .. ' --manuscript-python '
    .. quote(manuscript_python)
    .. ' --manuscript-backend '
    .. quote(manuscript_backend)
    .. ' --compare-python '
    .. quote(compare_python)
    .. ' --compare-backend '
    .. quote(compare_backend)
end

-- Run from REPO_ROOT so the shell's own relative asset lookups resolve
-- correctly. show_window = true: unlike the Python/browser-tab setup this
-- replaces, the shell has its own real GUI window that needs to actually
-- appear.
--
-- No startup handshake to poll for here anymore: showing the native window
-- all happens inside that one process now, so there's no
-- second process whose readiness this script needs to observe. If startup
-- fails, the shell reports the error
-- directly in its own window instead of through a marker file in
-- session_dir.
if
  not process.run_hidden(session_dir, command, { wait = false, show_window = true, cwd = release_mode and common.dirname(shell_exe, BUNDLE_ROOT) or REPO_ROOT })
then
  reaper.ShowMessageBox('Could not open Narration Utils.', 'Narration Utils', 0)
  return
end

bridge.run(session_dir)
