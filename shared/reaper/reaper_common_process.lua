-- Shared REAPER-package helpers: hidden subprocess launching and the
-- pipe-delimited protocol used by each package's Python backend.

local M = {}

local function quote(v)
  return '"' .. tostring(v or ""):gsub('"', '""') .. '"'
end
M.quote = quote

-- Launches `command` fully detached with no console window ever appearing,
-- via a throwaway .vbs run through wscript.exe (WScript.Shell.Run's hidden
-- window style applies even to a newly-allocated console, so it's created
-- hidden rather than shown-then-hidden).
--
-- opts:
--   wait - true blocks until the command finishes, and the .vbs deletes
--          itself afterward. false (default) launches detached and leaves
--          the .vbs behind for the async child to keep running under.
--   cwd  - working directory to set before running (optional).
function M.run_hidden(scratch_dir, command, opts)
  opts = opts or {}
  local vbs_path = scratch_dir .. "\\run_" .. tostring(reaper.time_precise()):gsub("[%.]", "") .. ".vbs"
  local vf = io.open(vbs_path, "w")
  if not vf then return false end
  vf:write('Set shell = CreateObject("WScript.Shell")\r\n')
  if opts.cwd then
    vf:write('shell.CurrentDirectory = "' .. opts.cwd:gsub('"', '""') .. '"\r\n')
  end
  local wait_flag = opts.wait and "True" or "False"
  vf:write('shell.Run "' .. command:gsub('"', '""') .. '", 0, ' .. wait_flag .. '\r\n')
  if opts.wait then
    vf:write('CreateObject("Scripting.FileSystemObject").DeleteFile WScript.ScriptFullName, True\r\n')
  end
  vf:close()
  local result = os.execute('wscript.exe //B //Nologo ' .. quote(vbs_path))
  return result == true or result == 0
end

-- Opens a file with whatever's associated with its extension - like
-- double-clicking it in Explorer. WScript.Shell.Run (above) launches a
-- literal command line via CreateProcess-style resolution and does NOT
-- reliably resolve file associations for a bare document path.
-- Shell.Application's ShellExecute is the actual association-aware API -
-- the same one Explorer itself uses for a double-click.
function M.open_file_with_default_app(scratch_dir, path)
  local vbs_path = scratch_dir .. "\\open_" .. tostring(reaper.time_precise()):gsub("[%.]", "") .. ".vbs"
  local vf = io.open(vbs_path, "w")
  if not vf then return false end
  vf:write('CreateObject("Shell.Application").ShellExecute "' .. path:gsub('"', '""') .. '", "", "", "open", 1\r\n')
  vf:close()
  local result = os.execute('wscript.exe //B //Nologo ' .. quote(vbs_path))
  return result == true or result == 0
end

-- Splits s into exactly n pipe-delimited fields (the last field absorbs
-- anything remaining, including further pipes). Plain string.find, not a
-- pattern, so it stays correct even when some fields are empty.
function M.split_pipe(s, n)
  local fields = {}
  local start = 1
  while #fields < n - 1 do
    local pipe_pos = s:find("|", start, true)
    if not pipe_pos then break end
    fields[#fields + 1] = s:sub(start, pipe_pos - 1)
    start = pipe_pos + 1
  end
  fields[#fields + 1] = s:sub(start)
  return fields
end

-- Percent-decodes %XX escapes (used by Manuscript Guide's index protocol).
function M.percent_decode(s)
  return (s:gsub("%%(%x%x)", function(h) return string.char(tonumber(h, 16)) end))
end

return M
