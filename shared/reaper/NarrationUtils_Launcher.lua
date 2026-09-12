-- Narration Utils - the sole REAPER action for the suite.
-- Opens a persistent Python/Tk workspace instead of a transient gfx menu.

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
local function pythonw_for(python_exe)
  local replacement, count = python_exe:gsub("[Pp]ython%.exe$", "pythonw.exe")
  return count > 0 and replacement or python_exe
end

local function project_context()
  local _, rpp = reaper.EnumProjects(-1, "")
  if not rpp or rpp == "" then return "", "Unsaved REAPER project" end
  return rpp:match("^(.*)[\\/][^\\/]-$") or "", rpp:match("[^\\/]+$") or "REAPER project"
end

local manuscript_core = REPO_ROOT .. "\\tools\\manuscript-guide\\core"
local compare_core = REPO_ROOT .. "\\tools\\transcript-compare\\core"
local manuscript_python = common.get_ext("ManuscriptGuide", "python_exe", manuscript_core .. "\\.venv\\Scripts\\python.exe")
local manuscript_backend = common.get_ext("ManuscriptGuide", "backend", manuscript_core .. "\\manuscript_guide.py")
local compare_python = common.get_ext("TranscriptCompare", "python_exe", compare_core .. "\\.venv\\Scripts\\python.exe")
local compare_backend = common.get_ext("TranscriptCompare", "compare_script", compare_core .. "\\compare.py")

local host_python = manuscript_python
if not common.file_exists(host_python) then host_python = compare_python end
if not common.file_exists(host_python) then
  reaper.ShowMessageBox("Narration Utils could not find a configured Python executable.\n\nInstall either tool's virtual environment, then run this launcher again.", "Narration Utils", 0)
  return
end

local project_folder, project_name = project_context()
local session_dir = reaper.GetResourcePath() .. "\\NarrationUtils\\sessions\\hub_" .. tostring(reaper.time_precise()):gsub("[%.]", "")
reaper.RecursiveCreateDirectory(session_dir .. "\\commands", 0)
local hub = SHARED .. "\\..\\python\\narration_hub.py"
local function quote(value) return process.quote(value) end
local command = quote(pythonw_for(host_python)) .. " " .. quote(hub)
  .. " --session-dir " .. quote(session_dir)
  .. " --project-folder " .. quote(project_folder)
  .. " --project-name " .. quote(project_name)
  .. " --manuscript-python " .. quote(manuscript_python)
  .. " --manuscript-backend " .. quote(manuscript_backend)
  .. " --compare-python " .. quote(compare_python)
  .. " --compare-backend " .. quote(compare_backend)
  .. " --seed " .. quote("ManuscriptGuide|spacy_model|" .. common.get_ext("ManuscriptGuide", "spacy_model", "en_core_web_sm"))
  .. " --seed " .. quote("TranscriptCompare|model_size|" .. common.get_ext("TranscriptCompare", "model_size", "small"))
  .. " --seed " .. quote("TranscriptCompare|color_misread|" .. common.get_ext("TranscriptCompare", "color_misread", "FF4040"))
  .. " --seed " .. quote("TranscriptCompare|color_skipped|" .. common.get_ext("TranscriptCompare", "color_skipped", "FFC000"))
  .. " --seed " .. quote("TranscriptCompare|color_extra|" .. common.get_ext("TranscriptCompare", "color_extra", "40A0FF"))

if not process.run_hidden(session_dir, command, { wait = false, show_window = true, cwd = SHARED .. "\\..\\python" }) then
  reaper.ShowMessageBox("Could not open Narration Utils.", "Narration Utils", 0)
  return
end

local function dispatch_compare(model, chunk, workers)
  -- Existing adapter is authoritative for manifests, marker import, undo,
  -- cancellation, and duplicate protection while it is progressively moved
  -- behind this controller.
  NARRATION_UTILS_HUB_MODEL_SIZE = model
  local seconds = { ["30 seconds"] = 30, ["1 minute"] = 60, ["5 minutes"] = 300, ["15 minutes"] = 900, ["1 hour"] = 3600 }
  NARRATION_UTILS_HUB_CHUNK_SECONDS = seconds[chunk] or 0
  NARRATION_UTILS_HUB_WORKERS = workers == "Auto" and 0 or tonumber(workers) or 0
  NARRATION_UTILS_SCRIPT_PATH = REPO_ROOT .. "\\tools\\transcript-compare\\daws\\reaper\\TranscriptCompare_Run.lua"
  dofile(NARRATION_UTILS_SCRIPT_PATH)
  NARRATION_UTILS_SCRIPT_PATH = nil
  NARRATION_UTILS_HUB_MODEL_SIZE = nil
  NARRATION_UTILS_HUB_CHUNK_SECONDS = nil
  NARRATION_UTILS_HUB_WORKERS = nil
end

bridge.run(session_dir, dispatch_compare)
