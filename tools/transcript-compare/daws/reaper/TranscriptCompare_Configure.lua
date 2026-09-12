-- TranscriptCompare - Configure
-- Sets (or updates) where the Python backend lives, which Whisper model to
-- use, and the take-marker colors for each discrepancy kind. Run this once
-- after installing, or again any time you move the project folder, want a
-- different model size, or want different marker colors.

local EXT = "TranscriptCompare"

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

local CORE = core_dir()
local default_python  = get("python_exe", CORE .. [[\.venv\Scripts\python.exe]])
local default_script  = get("compare_script", CORE .. [[\compare.py]])
local default_model   = get("model_size", "small")
local default_misread = get("color_misread", "FF4040")
local default_skipped = get("color_skipped", "FFC000")
local default_extra   = get("color_extra", "40A0FF")

local caption = "Python exe path,compare.py path,Whisper model (tiny/base/small/medium/large-v3),"
  .. "MISREAD color (hex RRGGBB),SKIPPED color (hex RRGGBB),EXTRA color (hex RRGGBB),extrawidth=250"

local defaults = table.concat({
  default_python, default_script, default_model,
  default_misread, default_skipped, default_extra,
}, ",")

local retval, csv = reaper.GetUserInputs("Transcript Compare - Settings", 6, caption, defaults)
if not retval then return end

local fields = {}
for field in (csv .. ","):gmatch("(.-),") do
  fields[#fields + 1] = field
end

local python_exe, compare_script, model_size, color_misread, color_skipped, color_extra =
  fields[1], fields[2], fields[3], fields[4], fields[5], fields[6]

local function valid_hex(s)
  return s ~= nil and s:match("^%x%x%x%x%x%x$") ~= nil
end

if not python_exe or python_exe == "" then
  reaper.ShowMessageBox("Python executable path can't be empty.", "Transcript Compare", 0)
  return
end
if not compare_script or compare_script == "" then
  reaper.ShowMessageBox("compare.py path can't be empty.", "Transcript Compare", 0)
  return
end
for _, c in ipairs({ { "MISREAD", color_misread }, { "SKIPPED", color_skipped }, { "EXTRA", color_extra } }) do
  if not valid_hex(c[2]) then
    reaper.ShowMessageBox(c[1] .. " color must be a 6-digit hex value like FF4040 (got '" .. tostring(c[2]) .. "').",
      "Transcript Compare", 0)
    return
  end
end

reaper.SetExtState(EXT, "python_exe", python_exe, true)
reaper.SetExtState(EXT, "compare_script", compare_script, true)
reaper.SetExtState(EXT, "model_size", model_size ~= "" and model_size or "small", true)
reaper.SetExtState(EXT, "color_misread", color_misread:upper(), true)
reaper.SetExtState(EXT, "color_skipped", color_skipped:upper(), true)
reaper.SetExtState(EXT, "color_extra", color_extra:upper(), true)

reaper.ShowMessageBox(
  "Saved.\n\n" ..
  "Python: " .. python_exe .. "\n" ..
  "Script: " .. compare_script .. "\n" ..
  "Model: " .. model_size .. "\n" ..
  "MISREAD color: #" .. color_misread:upper() .. "\n" ..
  "SKIPPED color: #" .. color_skipped:upper() .. "\n" ..
  "EXTRA color: #" .. color_extra:upper(),
  "Transcript Compare", 0
)
