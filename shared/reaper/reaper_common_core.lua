-- Shared REAPER-package helpers: ExtState access and basic file/path
-- operations. Used by every *_Run.lua / *_Configure.lua /
-- *_SelectManuscript.lua script in this suite.

local M = {}

-- reaper.GetExtState returns a single string, not (ok, value). Reading it
-- as `local ok, v = reaper.GetExtState(...)` leaves v always nil, so a
-- caller that does that silently falls back to `default` on every read no
-- matter what was actually saved - use this instead.
function M.get_ext(section, key, default)
  local value = reaper.GetExtState(section, key)
  if not value or value == "" then return default end
  return value
end

function M.file_exists(path)
  local f = io.open(path, "rb")
  if f then f:close() return true end
  return false
end

function M.read_file(path)
  local f = io.open(path, "rb")
  if not f then return "" end
  local content = f:read("*a") or ""
  f:close()
  return content
end

function M.copy_file(src, dst)
  local input = io.open(src, "rb")
  if not input then return false end
  local content = input:read("*a")
  input:close()
  if not content then return false end
  local output = io.open(dst, "wb")
  if not output then return false end
  output:write(content)
  output:close()
  return true
end

-- `fallback` is returned when path has no directory separator - callers
-- differ on what they want there, so it's an explicit parameter rather
-- than a fixed choice baked into this shared helper.
function M.dirname(path, fallback)
  return path:match("^(.*)[\\/][^\\/]-$") or fallback
end

return M
