-- Manuscript Guide - Configure
-- This package is independent of Transcript Compare. Settings are kept only
-- in the ManuscriptGuide ExtState namespace; both tools merely share the
-- project-root Manuscript.docx convention.

local EXT = "ManuscriptGuide"

local function shared_reaper_dir()
  local _, script_path = reaper.get_action_context()
  local script_dir = script_path:match("^(.*)[\\/]") or "."
  return script_dir .. "\\..\\..\\..\\..\\shared\\reaper"
end

local function core_dir()
  local _, script_path = reaper.get_action_context()
  local script_dir = script_path:match("^(.*)[\\/]") or "."
  return script_dir .. "\\..\\..\\core"
end

local ok_core, common = pcall(dofile, shared_reaper_dir() .. "\\reaper_common_core.lua")
if not ok_core then
  reaper.ShowMessageBox("Could not load the shared library. This package's folder must stay at tools\\manuscript-guide\\daws\\reaper\\ relative to shared\\reaper\\ under the repo root.", "Manuscript Guide", 0)
  return
end

local function get(key, default) return common.get_ext(EXT, key, default) end

local CORE = core_dir()
local python_exe = get("python_exe", CORE .. [[\.venv\Scripts\python.exe]])
local backend = get("backend", CORE .. [[\manuscript_guide.py]])
local spacy_model = get("spacy_model", "en_core_web_sm")
local espeak_library = get("espeak_library", "")
local piper_exe = get("piper_exe", "")
local piper_model = get("piper_model", "")

local labels = table.concat({
  "Python executable", "Manuscript Guide backend", "spaCy model",
  "eSpeak NG DLL (optional)", "Piper executable (optional)", "Piper voice model (optional)",
}, ",") .. ",extrawidth=260"
local defaults = table.concat({python_exe, backend, spacy_model, espeak_library, piper_exe, piper_model}, ",")
local ok, csv = reaper.GetUserInputs("Manuscript Guide - Settings", 6, labels, defaults)
if not ok then return end

local fields = {}
for field in (csv .. ","):gmatch("(.-),") do fields[#fields + 1] = field end
if fields[1] == "" or fields[2] == "" then
  reaper.ShowMessageBox("Python executable and backend paths are required.", "Manuscript Guide", 0)
  return
end

local keys = {"python_exe", "backend", "spacy_model", "espeak_library", "piper_exe", "piper_model"}
for i, key in ipairs(keys) do reaper.SetExtState(EXT, key, fields[i] or "", true) end
reaper.ShowMessageBox(
  "Saved independent Manuscript Guide settings.\n\n" ..
  "This plugin will use <project folder>\\Manuscript.docx as its only shared input.",
  "Manuscript Guide", 0)
