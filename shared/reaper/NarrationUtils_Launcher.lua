-- Narration Utils - the sole REAPER action for the suite.
-- Launches the native shell app (shell/src-tauri), which hosts the React UI
-- and its own in-process server for its whole lifetime - closing the
-- shell's window is the only thing that stops it. Python only runs as a
-- short-lived subprocess the shell spawns for Story Bible builds and
-- transcript comparisons, never as a supervised server. REAPER itself has
-- no workflow UI; the bridge below only services requests from that
-- workspace.

local function script_dir()
  local _, path = reaper.get_action_context()
  return path:match("^(.*)[\\/]") or "."
end

local SHARED = script_dir()
local ok_core, common = pcall(dofile, SHARED .. "\\reaper_common_core.lua")
local ok_proc, process = pcall(dofile, SHARED .. "\\reaper_common_process.lua")
local ok_bridge, bridge = pcall(dofile, SHARED .. "\\narration_ui_bridge.lua")
if not ok_core or not ok_proc or not ok_bridge then
  reaper.ShowMessageBox("Could not load Narration Utils shared libraries from:\n" .. SHARED, "Narration Utils", 0)
  return
end

local REPO_ROOT = SHARED .. "\\..\\.."

local function project_context()
  local _, rpp = reaper.EnumProjects(-1, "")
  if not rpp or rpp == "" then return "", "Unsaved REAPER project" end
  local name = rpp:match("[^\\/]+$") or "REAPER project"
  name = name:match("^(.*)%.[^.]+$") or name
  return rpp:match("^(.*)[\\/][^\\/]-$") or "", name
end

-- All runtimes are owned by this checkout. The only REAPER configuration is
-- the launcher action itself; it never reads legacy ExtState paths or any
-- previous install location. The host is the native shell app (built from
-- shell/src-tauri); it shows the UI in its own window instead of a browser
-- tab, and shells out to the shared venv's Python only for the two "core"
-- tools below (Story Bible builds, transcript comparisons) - never as a
-- persistent server.
local shared_python = REPO_ROOT .. "\\.venv\\Scripts\\python.exe"
local manuscript_core = REPO_ROOT .. "\\tools\\manuscript-guide\\core"
local compare_core = REPO_ROOT .. "\\tools\\transcript-compare\\core"
local manuscript_python = shared_python
local manuscript_backend = manuscript_core .. "\\manuscript_guide.py"
local compare_python = shared_python
local compare_backend = compare_core .. "\\compare.py"
local ui_index = REPO_ROOT .. "\\shared\\ui\\dist\\index.html"

-- Prefer a release build of the shell; fall back to a debug build so
-- `cargo tauri dev`-produced binaries work without a separate release step
-- during development. Neither path is installed/versioned yet - see the
-- open "distribution path" question in the shell's migration plan.
local shell_release = REPO_ROOT .. "\\shell\\src-tauri\\target\\release\\narration-utils-shell.exe"
local shell_debug = REPO_ROOT .. "\\shell\\src-tauri\\target\\debug\\narration-utils-shell.exe"
local shell_exe = common.file_exists(shell_release) and shell_release or shell_debug

local project_folder, project_name = project_context()
local session_dir = reaper.GetResourcePath() .. "\\NarrationUtils\\sessions\\hub_" .. tostring(reaper.time_precise()):gsub("[%.]", "")
reaper.RecursiveCreateDirectory(session_dir .. "\\commands", 0)

if not common.file_exists(shared_python) or not common.file_exists(ui_index) then
  local quickstart = REPO_ROOT .. "\\scripts\\Quickstart.cmd"
  local answer = reaper.ShowMessageBox(
    "Narration Utils has not been set up in this checkout yet.\n\n"
      .. "Run scripts\\Quickstart.ps1 now? It builds the shared Python environment\n"
      .. "and downloads a couple of small local models - this can take a few\n"
      .. "minutes the first time, and needs Node.js/npm already installed.\n\n"
      .. "Diagnostic session:\n" .. session_dir,
    "Narration Utils setup required", 4)
  if answer == 6 then -- IDYES
    -- Shown, not hidden: this is a multi-minute operation (model downloads,
    -- an npm build) the user should be able to watch and, if something goes
    -- wrong, read the real error from directly.
    if process.run_hidden(session_dir, process.quote(quickstart), { wait = false, show_window = true, cwd = REPO_ROOT .. "\\scripts" }) then
      reaper.ShowMessageBox("Setup is running in a console window. Once it finishes, launch Narration Utils again.", "Narration Utils setup", 0)
    else
      reaper.ShowMessageBox("Could not start scripts\\Quickstart.cmd.\n\nRun it manually from:\n" .. REPO_ROOT .. "\\scripts", "Narration Utils setup required", 0)
    end
  end
  return
end

if not common.file_exists(shell_exe) then
  reaper.ShowMessageBox(
    "The Narration Utils shell app has not been built yet.\n\n"
      .. "From this checkout, run:\n  cd shell\n  npm run build\n\n"
      .. "(or `npm run dev` while iterating on it), then launch Narration Utils again.",
    "Narration Utils setup required", 0)
  return
end

local function quote(value) return process.quote(value) end
local SERVER_PORT = 48767

-- No probe/reuse step here anymore: the shell exe owns single-instance
-- detection itself (tauri-plugin-single-instance) and simply forwards to
-- its already-running window instead of spawning a second backend, so
-- every launch just spawns the shell unconditionally.
local command = quote(shell_exe)
  .. " --repo-root " .. quote(REPO_ROOT)
  .. " --session-dir " .. quote(session_dir)
  .. " --project-folder " .. quote(project_folder)
  .. " --project-name " .. quote(project_name)
  .. " --daw " .. quote("REAPER")
  .. " --manuscript-python " .. quote(manuscript_python)
  .. " --manuscript-backend " .. quote(manuscript_backend)
  .. " --compare-python " .. quote(compare_python)
  .. " --compare-backend " .. quote(compare_backend)
  .. " --port " .. tostring(SERVER_PORT)

-- Run from REPO_ROOT so the shell's own relative asset lookups resolve
-- correctly. show_window = true: unlike the Python/browser-tab setup this
-- replaces, the shell has its own real GUI window that needs to actually
-- appear.
--
-- No startup handshake to poll for here anymore: binding the port and
-- showing the UI all happen inside that one process now, so there's no
-- second process whose readiness this script needs to observe. If startup
-- fails (e.g. the port is already in use), the shell reports the error
-- directly in its own window instead of through a marker file in
-- session_dir.
if not process.run_hidden(session_dir, command, { wait = false, show_window = true, cwd = REPO_ROOT }) then
  reaper.ShowMessageBox("Could not open Narration Utils.", "Narration Utils", 0)
  return
end

bridge.run(session_dir)
