-- File-session controller for the persistent Python Narration Utils hub.
-- The Python window owns ordinary UI; this adapter keeps DAW-only state.

local M = {}

local function decode(value)
  return (value:gsub("%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end

local function fields(line)
  local out = {}
  for item in (line:gsub("[\r\n]+$", "") .. "|"):gmatch("(.-)|") do out[#out + 1] = decode(item) end
  return out
end

local function event(session_dir, message)
  local handle = io.open(session_dir .. "\\events.log", "a")
  if handle then handle:write(message .. "\n"); handle:close() end
end

local function command_files(directory)
  local names, index = {}, 0
  while true do
    local name = reaper.EnumerateFiles(directory, index)
    if not name or name == "" then break end
    if name:match("%.cmd$") then names[#names + 1] = name end
    index = index + 1
  end
  table.sort(names)
  return names
end

local function valid_runtime_key(tool, key)
  if tool == "ManuscriptGuide" and (key == "python_exe" or key == "backend") then return true end
  return tool == "TranscriptCompare" and (key == "python_exe" or key == "compare_script")
end

function M.run(session_dir, dispatch_compare)
  local commands_dir, active = session_dir .. "\\commands", true
  local function tick()
    for _, name in ipairs(command_files(commands_dir)) do
      local path = commands_dir .. "\\" .. name
      local handle = io.open(path, "r")
      local line = handle and handle:read("*l") or ""
      if handle then handle:close() end
      os.remove(path)
      local command = fields(line)
      if command[1] ~= "1" then
        event(session_dir, "ERROR|Unsupported hub protocol")
      elseif command[2] == "runtime_setting" then
        if valid_runtime_key(command[3], command[4]) then
          reaper.SetExtState(command[3], command[4], command[5] or "", true)
          event(session_dir, "Runtime setting saved.")
        else
          event(session_dir, "ERROR|Invalid runtime setting")
        end
      elseif command[2] == "manuscript_selected" then
        event(session_dir, "Project manuscript selected.")
      elseif command[2] == "start_compare" then
        event(session_dir, "PROGRESS|0|Preparing Transcript Compare…")
        dispatch_compare(command[3], command[4], command[5], command[6])
      elseif command[2] == "close" then
        active = false
      end
    end
    if active then reaper.defer(tick) end
  end
  reaper.defer(tick)
end

return M
