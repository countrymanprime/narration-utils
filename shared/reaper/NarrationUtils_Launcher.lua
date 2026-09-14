-- Narration Utils - the sole REAPER action for the suite.
-- Opens the persistent React/Python workspace in the user's default browser.
-- REAPER itself has no workflow UI; the bridge below only services requests
-- from that workspace.

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
-- previous install location. The host is the shared venv's Python running
-- shared/server (see shared/server/main.py) - it opens the UI in the user's
-- default browser instead of a native window.
local shared_python = REPO_ROOT .. "\\.venv\\Scripts\\python.exe"
local server_main = REPO_ROOT .. "\\shared\\server\\main.py"
local manuscript_core = REPO_ROOT .. "\\tools\\manuscript-guide\\core"
local compare_core = REPO_ROOT .. "\\tools\\transcript-compare\\core"
local manuscript_python = shared_python
local manuscript_backend = manuscript_core .. "\\manuscript_guide.py"
local compare_python = shared_python
local compare_backend = compare_core .. "\\compare.py"
local ui_index = REPO_ROOT .. "\\shared\\ui\\dist\\index.html"

local project_folder, project_name = project_context()
local session_dir = reaper.GetResourcePath() .. "\\NarrationUtils\\sessions\\hub_" .. tostring(reaper.time_precise()):gsub("[%.]", "")
reaper.RecursiveCreateDirectory(session_dir .. "\\commands", 0)

if not common.file_exists(shared_python) or not common.file_exists(server_main)
  or not common.file_exists(ui_index) then
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

local function quote(value) return process.quote(value) end
local command = quote(shared_python) .. " -m shared.server.main"
  .. " --session-dir " .. quote(session_dir)
  .. " --project-folder " .. quote(project_folder)
  .. " --project-name " .. quote(project_name)
  .. " --daw " .. quote("REAPER")
  .. " --manuscript-python " .. quote(manuscript_python)
  .. " --manuscript-backend " .. quote(manuscript_backend)
  .. " --compare-python " .. quote(compare_python)
  .. " --compare-backend " .. quote(compare_backend)

-- Run from REPO_ROOT so "-m shared.server.main" resolves as a package.
if not process.run_hidden(session_dir, command, { wait = false, show_window = false, cwd = REPO_ROOT }) then
  reaper.ShowMessageBox("Could not open Narration Utils.", "Narration Utils", 0)
  return
end

-- The host reports startup outcomes as one of two marker files (see
-- shared/server/main.py): "startup.ready" once the API handshake actually
-- succeeds, or "startup.failure" with a human-readable reason.
-- Unlike the old preflight/timeout race, this now distinguishes three
-- outcomes instead of silently going quiet in the ambiguous case: success,
-- an explicit failure, and "still nothing after the deadline" - which is
-- itself surfaced instead of leaving the user with no feedback at all.
local startup_deadline = reaper.time_precise() + 20
local function watch_startup()
  local ready = io.open(session_dir .. "\\startup.ready", "r")
  if ready then ready:close(); return end
  local failure = io.open(session_dir .. "\\startup.failure", "r")
  if failure then
    local message = failure:read("*a") or "Narration Utils could not start."
    failure:close()
    reaper.ShowMessageBox(message .. "\n\nDiagnostic session:\n" .. session_dir, "Narration Utils setup required", 0)
    return
  end
  if reaper.time_precise() < startup_deadline then
    reaper.defer(watch_startup)
    return
  end
  reaper.ShowMessageBox(
    "Narration Utils is taking longer than expected to start.\n\nIt may still open - if not, check:\n"
      .. session_dir .. "\\host.log",
    "Narration Utils", 0)
end
reaper.defer(watch_startup)

bridge.run(session_dir)
