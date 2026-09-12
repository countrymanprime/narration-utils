-- TranscriptCompare - Configure
-- Sets where the Python backend lives, then opens the shared settings
-- window for everything else (Whisper model, take-marker colors) with
-- separate "Global Defaults" and "This Project" tabs. Run this once after
-- installing, or again any time you move the project folder or want
-- different defaults.

local EXT = "TranscriptCompare"

-- NARRATION_UTILS_SCRIPT_PATH is set by NarrationUtils_Launcher.lua before
-- dofile()-ing this script: reaper.get_action_context() always reports the
-- currently-running *action*'s path, which is the launcher's own path when
-- dispatched that way, not this file's - so the launcher hands over this
-- file's real path explicitly instead.
local function own_script_path()
  return NARRATION_UTILS_SCRIPT_PATH or select(2, reaper.get_action_context())
end

local function shared_reaper_dir()
  local script_dir = own_script_path():match("^(.*)[\\/]") or "."
  return script_dir .. "\\..\\..\\..\\..\\shared\\reaper"
end

local SHARED = shared_reaper_dir()
local ok_core, common = pcall(dofile, SHARED .. "\\reaper_common_core.lua")
local ok_proc, process = pcall(dofile, SHARED .. "\\reaper_common_process.lua")
local ok_pycfg, pyconfig = pcall(dofile, SHARED .. "\\reaper_common_pyconfig.lua")
if not ok_core or not ok_proc or not ok_pycfg then
  reaper.ShowMessageBox("Could not load the shared library. This package's folder must stay at tools\\transcript-compare\\daws\\reaper\\ relative to shared\\reaper\\ under the repo root.", "Transcript Compare", 0)
  return
end

-- reaper.GetExtState returns a single string, not (ok, value) - the old
-- `local ok, v = reaper.GetExtState(...)` here meant v was always nil, so
-- every saved setting silently fell back to its default on every read.
-- common.get_ext uses the correct single-return form, fixing that.
local function get(key, default)
  return common.get_ext(EXT, key, default)
end

-- pythonw.exe (the windowless console host) ships alongside python.exe in
-- every standard Windows CPython install/venv - used for the settings
-- window/manuscript picker so no console flashes while they're open.
local function pythonw_for(python_exe)
  local replaced, count = python_exe:gsub("[Pp]ython%.exe$", "pythonw.exe")
  if count > 0 then return replaced end
  return python_exe
end

local CORE = common.core_dir(own_script_path())

-- ---- python_exe / compare_script: the one setting pair that stays here.
-- Lua has to know where Python lives before it can launch the shared
-- settings window at all, so this can't be resolved by asking Python. ----
local default_python  = get("python_exe", CORE .. [[\.venv\Scripts\python.exe]])
local default_script  = get("compare_script", CORE .. [[\compare.py]])

local caption = "Python exe path,compare.py path,extrawidth=250"
local defaults = table.concat({default_python, default_script}, ",")
local retval, csv = reaper.GetUserInputs("Transcript Compare - Settings", 2, caption, defaults)
if not retval then return end

local fields = common.parse_csv_list(csv)
local python_exe, compare_script = fields[1], fields[2]

if not python_exe or python_exe == "" then
  reaper.ShowMessageBox("Python executable path can't be empty.", "Transcript Compare", 0)
  return
end
if not compare_script or compare_script == "" then
  reaper.ShowMessageBox("compare.py path can't be empty.", "Transcript Compare", 0)
  return
end

reaper.SetExtState(EXT, "python_exe", python_exe, true)
reaper.SetExtState(EXT, "compare_script", compare_script, true)

-- ---- everything else: the shared, DAW-agnostic settings window ----
local scratch_dir = reaper.GetResourcePath() .. "\\TranscriptCompare"
reaper.RecursiveCreateDirectory(scratch_dir, 0)

local _, proj_fn = reaper.EnumProjects(-1, "")
local project_folder = ""
if proj_fn and proj_fn ~= "" then
  project_folder = proj_fn:match("^(.*)[\\/][^\\/]-$") or ""
end

-- Passes along whatever's currently saved in ExtState for the
-- Python-owned keys, so the shared settings GUI can migrate them into
-- global-settings.json the first time it opens (safe to keep passing every
-- time - it's a no-op once real values exist there).
local seed_pairs = {
  model_size     = get("model_size", "small"),
  color_misread  = get("color_misread", "FF4040"),
  color_skipped  = get("color_skipped", "FFC000"),
  color_extra    = get("color_extra", "40A0FF"),
}

local config_ui_path = SHARED .. "\\..\\python\\config_ui.py"
pyconfig.open_settings_gui(process, pythonw_for(python_exe), config_ui_path, scratch_dir, EXT, project_folder, seed_pairs)
