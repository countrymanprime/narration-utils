-- Manuscript Guide - Configure
-- Sets where the Python backend lives, then opens the shared settings
-- window for everything else (spaCy model, eSpeak/Piper paths) with
-- separate "Global Defaults" and "This Project" tabs. This package is
-- independent of Transcript Compare; both tools merely share the
-- project-root Manuscript.docx convention.

local EXT = "ManuscriptGuide"

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
local ok_pycfg, pyconfig = pcall(dofile, SHARED .. "\\reaper_common_pyconfig.lua")
local ok_proc, process = pcall(dofile, SHARED .. "\\reaper_common_process.lua")
if not ok_core or not ok_proc or not ok_pycfg then
  reaper.ShowMessageBox("Could not load the shared library. This package's folder must stay at tools\\manuscript-guide\\daws\\reaper\\ relative to shared\\reaper\\ under the repo root.", "Manuscript Guide", 0)
  return
end

local function get(key, default) return common.get_ext(EXT, key, default) end
local function dirname(p) return common.dirname(p, "") end

-- pythonw.exe (the windowless console host) ships alongside python.exe in
-- every standard Windows CPython install/venv - used for the settings
-- window so no console flashes while it's open.
local function pythonw_for(python_exe)
  local replaced, count = python_exe:gsub("[Pp]ython%.exe$", "pythonw.exe")
  if count > 0 then return replaced end
  return python_exe
end

local CORE = common.core_dir(own_script_path())

-- ---- python_exe / backend: the one setting pair that stays here. Lua has
-- to know where Python lives before it can launch the shared settings
-- window at all, so this can't be resolved by asking Python. ----
local python_exe = get("python_exe", CORE .. [[\.venv\Scripts\python.exe]])
local backend = get("backend", CORE .. [[\manuscript_guide.py]])

local labels = table.concat({"Python executable", "Manuscript Guide backend"}, ",") .. ",extrawidth=260"
local defaults = table.concat({python_exe, backend}, ",")
local ok, csv = reaper.GetUserInputs("Manuscript Guide - Settings", 2, labels, defaults)
if not ok then return end

local fields = common.parse_csv_list(csv)
if fields[1] == "" or fields[2] == "" then
  reaper.ShowMessageBox("Python executable and backend paths are required.", "Manuscript Guide", 0)
  return
end
python_exe, backend = fields[1], fields[2]
reaper.SetExtState(EXT, "python_exe", python_exe, true)
reaper.SetExtState(EXT, "backend", backend, true)

-- ---- everything else: the shared, DAW-agnostic settings window ----
local scratch_dir = reaper.GetResourcePath() .. "\\ManuscriptGuide"
reaper.RecursiveCreateDirectory(scratch_dir, 0)

local _, rpp = reaper.EnumProjects(-1, "")
local project_folder = rpp and dirname(rpp) or ""

-- Passes along whatever's currently saved in ExtState for the
-- Python-owned keys, so the shared settings GUI can migrate them into
-- global-settings.json the first time it opens (safe to keep passing every
-- time - it's a no-op once real values exist there).
local seed_pairs = {
  spacy_model    = get("spacy_model", "en_core_web_sm"),
  espeak_library = get("espeak_library", ""),
  piper_exe      = get("piper_exe", ""),
  piper_model    = get("piper_model", ""),
}

local config_ui_path = SHARED .. "\\..\\python\\config_ui.py"
pyconfig.open_settings_gui(process, pythonw_for(python_exe), config_ui_path, scratch_dir, EXT, project_folder, seed_pairs)
