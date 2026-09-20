-- Shared REAPER-package helpers: hidden subprocess launching and the
-- pipe-delimited protocol used by each package's Python backend.

local M = {}

local function windows()
  return reaper.GetOS():find('Win') ~= nil
end

local function quote(v)
  local value = tostring(v or '')
  if windows() then
    return '"' .. value:gsub('"', '""') .. '"'
  end
  return "'" .. value:gsub("'", "'\\''") .. "'"
end
M.quote = quote

-- Launches `command` fully detached with no console window ever appearing,
-- via a throwaway .vbs run through wscript.exe (WScript.Shell.Run's hidden
-- window style applies even to a newly-allocated console, so it's created
-- hidden rather than shown-then-hidden).
--
-- opts:
--   wait         - true blocks until the command finishes, and the .vbs
--                  deletes itself afterward. false (default) launches
--                  detached and leaves the .vbs behind for the async child
--                  to keep running under.
--   cwd          - working directory to set before running (optional).
--   show_window  - false (default) launches with show-style 0 (hidden),
--                  as before. Pass true for a command that shows its own
--                  GUI window (e.g. the Narration Utils desktop host) - style
--                  0 is meant for suppressing a console, and relying on it
--                  also being ignored by an unrelated GUI toolkit's own
--                  window-visibility calls isn't a safe bet to make silently.
--   exit_code_path - only meaningful with wait = true. If set, the command's
--                  real exit code (not wscript.exe's own) is written to this
--                  path so the caller can read it back after run_hidden
--                  returns, since os.execute only sees wscript.exe's status.
function M.run_hidden(scratch_dir, command, opts)
  opts = opts or {}
  if not windows() then
    -- REAPER's asynchronous process API is available on macOS and Linux.
    -- A Wails GUI executable owns its own window, so there is no hidden
    -- console shim or Windows-specific helper on those platforms.
    local launch = command
    if opts.cwd and opts.cwd ~= '' then
      launch = 'cd ' .. quote(opts.cwd) .. ' && ' .. command
    end
    local timeout = opts.wait and 0 or -1
    local ok = pcall(reaper.ExecProcess, launch, timeout)
    return ok
  end
  local vbs_path = scratch_dir .. '\\run_' .. tostring(reaper.time_precise()):gsub('[%.]', '') .. '.vbs'
  local vf = io.open(vbs_path, 'w')
  if not vf then
    return false
  end
  vf:write('Set shell = CreateObject("WScript.Shell")\r\n')
  if opts.cwd then
    vf:write('shell.CurrentDirectory = "' .. opts.cwd:gsub('"', '""') .. '"\r\n')
  end
  local wait_flag = opts.wait and 'True' or 'False'
  local window_style = opts.show_window and '1' or '0'
  if opts.wait and opts.exit_code_path then
    vf:write('code = shell.Run("' .. command:gsub('"', '""') .. '", ' .. window_style .. ', True)\r\n')
    vf:write('Set fso = CreateObject("Scripting.FileSystemObject")\r\n')
    vf:write('Set outFile = fso.CreateTextFile("' .. opts.exit_code_path:gsub('"', '""') .. '", True)\r\n')
    vf:write('outFile.Write CStr(code)\r\n')
    vf:write('outFile.Close\r\n')
  else
    vf:write('shell.Run "' .. command:gsub('"', '""') .. '", ' .. window_style .. ', ' .. wait_flag .. '\r\n')
  end
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
  if not windows() then
    local opener = reaper.GetOS():find('OSX') and 'open' or 'xdg-open'
    local ok = pcall(reaper.ExecProcess, opener .. ' ' .. quote(path), -1)
    return ok
  end
  local vbs_path = scratch_dir .. '\\open_' .. tostring(reaper.time_precise()):gsub('[%.]', '') .. '.vbs'
  local vf = io.open(vbs_path, 'w')
  if not vf then
    return false
  end
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
    local pipe_pos = s:find('|', start, true)
    if not pipe_pos then
      break
    end
    fields[#fields + 1] = s:sub(start, pipe_pos - 1)
    start = pipe_pos + 1
  end
  fields[#fields + 1] = s:sub(start)
  return fields
end

-- Percent-decodes %XX escapes (used by Manuscript Guide's index protocol).
function M.percent_decode(s)
  return (s:gsub('%%(%x%x)', function(h)
    return string.char(tonumber(h, 16))
  end))
end

return M
