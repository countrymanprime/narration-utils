-- Bridge to the Python-owned layered config system (shared/config/defaults.json
-- -> per-user global-settings.json -> per-project settings.json). All actual
-- storage/resolution/UI lives in shared/python/{config.py,config_ui.py,
-- config_cli.py,manuscript_cli.py} - this module is pure orchestration on
-- top of the existing reaper_common_core.lua (read_file) and
-- reaper_common_process.lua (quote/run_hidden), so REAPER's Lua side never
-- needs to parse config JSON itself.
--
-- `common` and `process` are the already-`dofile`d reaper_common_core.lua /
-- reaper_common_process.lua module tables, passed in by the caller. This
-- module can't `dofile` them itself: reaper.get_action_context() always
-- reports the currently-running *action* script's path, not this file's own
-- path, so it has no reliable way to locate its siblings independently.

local M = {}

local function scratch_file(scratch_dir, prefix)
  return scratch_dir .. "\\" .. prefix .. "_" .. tostring(reaper.time_precise()):gsub("[%.]", "") .. ".txt"
end

-- Runs config_cli.py "get" for the given keys, blocks, and returns a table
-- {key = value, ...}. `keys` is a plain array of key names.
function M.query(common, process, python_exe, config_cli_path, scratch_dir, tool, keys, project_folder)
  local out_path = scratch_file(scratch_dir, "config_get")
  local cmd = process.quote(python_exe) .. " " .. process.quote(config_cli_path)
    .. " get --tool " .. process.quote(tool)
    .. " --keys " .. process.quote(table.concat(keys, ","))
    .. " --project-folder " .. process.quote(project_folder or "")
    .. " --out " .. process.quote(out_path)
  process.run_hidden(scratch_dir, cmd, { wait = true })

  local content = common.read_file(out_path):gsub("[\r\n]+$", "")
  os.remove(out_path)

  local result = {}
  if content ~= "" then
    for pair in (content .. "|"):gmatch("(.-)|") do
      local key, value = pair:match("^([^=]*)=(.*)$")
      if key and key ~= "" then result[key] = value end
    end
  end
  return result
end

-- Runs config_cli.py "set" at global scope, blocks, returns ok, raw_status.
function M.set_global(common, process, python_exe, config_cli_path, scratch_dir, tool, key, value)
  local out_path = scratch_file(scratch_dir, "config_set")
  local cmd = process.quote(python_exe) .. " " .. process.quote(config_cli_path)
    .. " set --tool " .. process.quote(tool)
    .. " --key " .. process.quote(key)
    .. " --value " .. process.quote(value)
    .. " --scope global"
    .. " --out " .. process.quote(out_path)
  process.run_hidden(scratch_dir, cmd, { wait = true })

  local content = common.read_file(out_path):gsub("[\r\n]+$", "")
  os.remove(out_path)
  return content == "OK", content
end

-- Launches the shared settings window (via pythonw.exe, so no console
-- flashes and the Tk window behaves like a normal app window) and blocks
-- until the user closes it. `seed_pairs` is {key = value, ...} - the
-- caller's *current* values for keys not yet migrated into
-- global-settings.json (see shared/python/config_ui.py's --seed handling).
function M.open_settings_gui(process, pythonw_exe, config_ui_path, scratch_dir, tool, project_folder, seed_pairs)
  local cmd = process.quote(pythonw_exe) .. " " .. process.quote(config_ui_path)
    .. " --tool " .. process.quote(tool)
    .. " --project-folder " .. process.quote(project_folder or "")
  for key, value in pairs(seed_pairs or {}) do
    cmd = cmd .. " --seed " .. process.quote(key .. "=" .. tostring(value))
  end
  process.run_hidden(scratch_dir, cmd, { wait = true, show_window = true })
end

-- Launches the shared manuscript picker (file dialog + copy into
-- <project_folder>\Manuscript.docx, when project_folder isn't empty + remember
-- path), blocks, and returns the raw picked path on success (not the copied
-- path - when project_folder is "" there IS no copy, so the caller needs the
-- original path either way), or "CANCELLED", or "" if the picker failed to
-- run / produced no status file at all.
function M.pick_manuscript(common, process, pythonw_exe, manuscript_cli_path, scratch_dir, project_folder)
  local status_path = scratch_file(scratch_dir, "manuscript_status")
  local cmd = process.quote(pythonw_exe) .. " " .. process.quote(manuscript_cli_path)
    .. " select --project-folder " .. process.quote(project_folder or "")
    .. " --status-out " .. process.quote(status_path)
  process.run_hidden(scratch_dir, cmd, { wait = true, show_window = true })

  local content = common.read_file(status_path):gsub("[\r\n]+$", "")
  os.remove(status_path)
  return content
end

return M
