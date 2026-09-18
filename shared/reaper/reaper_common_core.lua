-- Shared REAPER-package helpers: ExtState access and basic file/path
-- operations. Used by every *_Run.lua / *_Configure.lua script and the
-- shared NarrationUtils_Launcher.lua in this suite.

local M = {}
local SEP = package.config:sub(1, 1)

-- reaper.GetExtState returns a single string, not (ok, value). Reading it
-- as `local ok, v = reaper.GetExtState(...)` leaves v always nil, so a
-- caller that does that silently falls back to `default` on every read no
-- matter what was actually saved - use this instead.
function M.get_ext(section, key, default)
  local value = reaper.GetExtState(section, key)
  if not value or value == '' then
    return default
  end
  return value
end

function M.file_exists(path)
  local f = io.open(path, 'rb')
  if f then
    f:close()
    return true
  end
  return false
end

function M.read_file(path)
  local f = io.open(path, 'rb')
  if not f then
    return ''
  end
  local content = f:read('*a') or ''
  f:close()
  return content
end

function M.copy_file(src, dst)
  local input = io.open(src, 'rb')
  if not input then
    return false
  end
  local content = input:read('*a')
  input:close()
  if not content then
    return false
  end
  local output = io.open(dst, 'wb')
  if not output then
    return false
  end
  output:write(content)
  output:close()
  return true
end

-- `fallback` is returned when path has no directory separator - callers
-- differ on what they want there, so it's an explicit parameter rather
-- than a fixed choice baked into this shared helper.
function M.dirname(path, fallback)
  return path:match('^(.*)[\\/][^\\/]-$') or fallback
end

-- Each tool's `core/` directory, two levels up from its own
-- daws\reaper\*.lua script. `own_script_path` must be the CALLING script's
-- own file path, not reaper.get_action_context() taken here - this module
-- doesn't know whether its caller is running as REAPER's current action
-- (script_path is its own) or was dispatched via NarrationUtils_Launcher.lua
-- (script_path would be the launcher's own path instead).
function M.core_dir(own_script_path)
  local script_dir = own_script_path:match('^(.*)[\\/]') or '.'
  return script_dir .. SEP .. '..' .. SEP .. '..' .. SEP .. 'core'
end

-- Splits a comma-separated list from a reaper.GetUserInputs result into its
-- fields. Plain string parsing, no escaping - fine for the simple
-- path/name/choice values these dialogs collect.
function M.parse_csv_list(s)
  local fields = {}
  for field in (s .. ','):gmatch('(.-),') do
    fields[#fields + 1] = field
  end
  return fields
end

return M
