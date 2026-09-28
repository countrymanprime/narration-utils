-- The mastering port's DAW row over the bridge (ADR 0306, owner decision D86; render-encode-master PRD Phase 9):
-- master_chain_read and render_with_fx.
--
-- master_chain_read lists the FX a render with FX runs, every track's and then the master track's, so the app can show
-- the narrator the chain before they approve a render. It reads and changes nothing.
--
-- render_with_fx is the bridge's one render. narration_render.lua only configures a render and never triggers one; this
-- file does trigger one, and only on these conditions (ADR 0306, threat-model row 5o):
--   * the command carries an approval the host was given by the narrator for this render: a random hex token, used once
--     (a second command with the same token is refused, even if the first was refused for another reason);
--   * the output folder is a run folder the app made inside the project (`<project>/narration-utils/mastering/<name>`),
--     absolute, with no `.` or `..` part, and empty, so a render never writes over a file;
--   * REAPER predicts exactly one WAV file per region, inside that folder, before anything renders (RENDER_TARGETS);
--   * REAPER is not recording.
-- Each region renders on its own, as the master mix (RENDER_SETTINGS 0: every track's FX and the master's run), between
-- the region's own bounds, with nothing added to the project (RENDER_ADDTOPROJ 0). The narrator's render settings are
-- read first and written back afterwards, whatever happened; RENDER_FORMAT is never written (a format other than WAV is
-- refused instead), and RENDER_STATS is never read (spike S5: it can trigger a render).

local core = ...
local event = core.event

-- "File: Render project, using the most recent render settings, auto-close render dialog" (confirmed in REAPER 7.80 by
-- the S5 spike, docs/research/reaper-spike-s5-render-details.md).
local RENDER_ACTION = 42230
local RENDER_BOUNDS_CUSTOM = 0 -- RENDER_BOUNDSFLAG: custom time bounds, RENDER_STARTPOS to RENDER_ENDPOS.
local RENDER_MASTER_MIX = 0 -- RENDER_SETTINGS: the master mix, not stems.
local MASTER_CHAIN_LIMIT = 500 -- The most FX slots master_chain_read lists.
local REGION_LIMIT = 100 -- The most regions one render_with_fx renders.

local NUMBER_KEYS = { 'RENDER_BOUNDSFLAG', 'RENDER_STARTPOS', 'RENDER_ENDPOS', 'RENDER_SETTINGS', 'RENDER_ADDTOPROJ' }
local STRING_KEYS = { 'RENDER_FILE', 'RENDER_PATTERN' }

local NOT_APPROVED = 'A render with FX needs your approval in the app.'
local USED_APPROVAL = 'This approval was already used. Approve the render again in the app.'
local BAD_FOLDER = 'The render folder is not one the app made in the project.'
local FULL_FOLDER = 'The render folder is not empty.'

local function recording()
  return math.floor(reaper.GetPlayState() / 4) % 2 == 1
end

-- master_chain_read ------------------------------------------------------------------------------------------------

local function master_chain_read(session_dir, run_id)
  if not reaper.APIExists('TrackFX_GetFXName') or not reaper.APIExists('TrackFX_GetEnabled') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot list FX.')
    return
  end
  local listed, truncated = 0, false
  local function list(track, guid, name)
    for fx = 0, reaper.TrackFX_GetCount(track) - 1 do
      if listed >= MASTER_CHAIN_LIMIT then
        truncated = true
        return
      end
      local _, fx_name = reaper.TrackFX_GetFXName(track, fx, '')
      event(session_dir, 'MASTER_CHAIN_FX', run_id, guid, name, fx_name, reaper.TrackFX_GetEnabled(track, fx) and 1 or 0)
      listed = listed + 1
    end
  end
  for index = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, index)
    local _, name = reaper.GetTrackName(track)
    list(track, reaper.GetTrackGUID(track), name)
  end
  list(reaper.GetMasterTrack(0), 'master', 'MASTER')
  event(session_dir, 'MASTER_CHAIN_READ', run_id, listed, truncated and 1 or 0)
end

-- render_with_fx: checks ---------------------------------------------------------------------------------------------

local function slash(path)
  return (path:gsub('\\', '/'))
end

-- The run folder's parts when it is `<absolute project>/narration-utils/mastering/<name>` with no `.` or `..` part and a
-- plain name; nil otherwise.
local function run_folder_parts(folder)
  local path = slash(folder):gsub('/+$', '')
  if not (path:match('^%a:/') or path:match('^/')) then
    return nil
  end
  local parts = {}
  for part in path:gmatch('[^/]+') do
    if part == '.' or part == '..' then
      return nil
    end
    parts[#parts + 1] = part
  end
  local count = #parts
  if count < 4 or parts[count - 2] ~= 'narration-utils' or parts[count - 1] ~= 'mastering' then
    return nil
  end
  if not parts[count]:match('^[%w%-_]+$') then
    return nil
  end
  return path, parts[count]
end

-- Whether directory lists name among its subdirectories (EnumerateSubdirectories, re-read first).
local function has_subdirectory(directory, name)
  reaper.EnumerateSubdirectories(directory, -1)
  local index = 0
  while true do
    local entry = reaper.EnumerateSubdirectories(directory, index)
    if not entry or entry == '' then
      return false
    end
    if entry == name then
      return true
    end
    index = index + 1
  end
end

local function is_empty(directory)
  reaper.EnumerateFiles(directory, -1)
  reaper.EnumerateSubdirectories(directory, -1)
  local file, sub = reaper.EnumerateFiles(directory, 0), reaper.EnumerateSubdirectories(directory, 0)
  return (not file or file == '') and (not sub or sub == '')
end

-- The regions named, in order, each as { name, start, stop }; or nil and the refusal.
local function find_regions(names)
  local regions = {}
  local index = 0
  while true do
    local retval, is_region, pos, rgnend, name = reaper.EnumProjectMarkers3(0, index)
    if retval == 0 then
      break
    end
    if is_region then
      regions[name] = regions[name] or {}
      table.insert(regions[name], { pos, rgnend })
    end
    index = index + 1
  end
  local out = {}
  for _, name in ipairs(names) do
    local found = regions[name]
    if not found then
      return nil, string.format('There is no region named "%s".', name)
    end
    if #found > 1 then
      return nil, string.format('More than one region is named "%s".', name)
    end
    out[#out + 1] = { name = name, start = found[1][1], stop = found[1][2] }
  end
  return out
end

local function split_lines(value)
  local out = {}
  for line in (value or ''):gmatch('[^\n]+') do
    out[#out + 1] = line
  end
  return out
end

-- render_with_fx: settings -------------------------------------------------------------------------------------------

local function read_settings()
  local saved = { numbers = {}, strings = {} }
  for _, key in ipairs(NUMBER_KEYS) do
    saved.numbers[key] = reaper.GetSetProjectInfo(0, key, 0, false)
  end
  for _, key in ipairs(STRING_KEYS) do
    local _, value = reaper.GetSetProjectInfo_String(0, key, '', false)
    saved.strings[key] = value
  end
  return saved
end

local function write_settings(saved)
  for _, key in ipairs(NUMBER_KEYS) do
    reaper.GetSetProjectInfo(0, key, saved.numbers[key], true)
  end
  for _, key in ipairs(STRING_KEYS) do
    reaper.GetSetProjectInfo_String(0, key, saved.strings[key], true)
  end
end

-- Sets up one region's render and checks REAPER's prediction: exactly one WAV file, the expected path. Returns the file,
-- or nil and the refusal.
local function prepare(folder, stem, region)
  reaper.GetSetProjectInfo_String(0, 'RENDER_FILE', folder, true)
  reaper.GetSetProjectInfo_String(0, 'RENDER_PATTERN', stem, true)
  reaper.GetSetProjectInfo(0, 'RENDER_BOUNDSFLAG', RENDER_BOUNDS_CUSTOM, true)
  reaper.GetSetProjectInfo(0, 'RENDER_STARTPOS', region.start, true)
  reaper.GetSetProjectInfo(0, 'RENDER_ENDPOS', region.stop, true)
  reaper.GetSetProjectInfo(0, 'RENDER_SETTINGS', RENDER_MASTER_MIX, true)
  reaper.GetSetProjectInfo(0, 'RENDER_ADDTOPROJ', 0, true)
  local _, targets = reaper.GetSetProjectInfo_String(0, 'RENDER_TARGETS', '', false)
  local predicted = {}
  for part in (targets or ''):gmatch('[^;]+') do
    predicted[#predicted + 1] = part
  end
  if #predicted == 1 and not predicted[1]:lower():match('%.wav$') then
    return nil, "REAPER renders to a format other than WAV. Choose WAV in REAPER's render settings, then try again."
  end
  local file = core.join(folder, stem .. '.wav')
  if #predicted ~= 1 or slash(predicted[1]) ~= slash(file) then
    return nil, 'REAPER would not render to the folder the app made.'
  end
  if core.file_exists(file) then
    return nil, FULL_FOLDER
  end
  return file
end

-- Renders every region, one after another, into folder. Returns the files, or nil and the refusal.
local function render_regions(folder, regions)
  local files = {}
  for index, region in ipairs(regions) do
    local file, refusal = prepare(folder, string.format('fx-%02d', index), region)
    if not file then
      return nil, refusal
    end
    reaper.Main_OnCommand(RENDER_ACTION, 0)
    if not core.file_exists(file) then
      return nil, string.format('REAPER did not write the rendered file for "%s".', region.name)
    end
    files[#files + 1] = { region = region.name, path = file }
  end
  return files
end

-- render_with_fx -----------------------------------------------------------------------------------------------------

local function render_with_fx(used, session_dir, run_id, approval, folder, region_list)
  if not reaper.APIExists('GetSetProjectInfo_String') or not reaper.APIExists('GetSetProjectInfo') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot render with FX.')
    return
  end
  if #approval < 32 or #approval > 128 or not approval:match('^%x+$') then
    event(session_dir, 'ERROR', run_id, NOT_APPROVED)
    return
  end
  if used[approval] then
    event(session_dir, 'ERROR', run_id, USED_APPROVAL)
    return
  end
  used[approval] = true
  local _, name = run_folder_parts(folder)
  if not name or not has_subdirectory(core.dirname(folder), name) then
    event(session_dir, 'ERROR', run_id, BAD_FOLDER)
    return
  end
  if not is_empty(folder) then
    event(session_dir, 'ERROR', run_id, FULL_FOLDER)
    return
  end
  local names = split_lines(region_list)
  if #names == 0 or #names > REGION_LIMIT then
    event(session_dir, 'ERROR', run_id, 'Name at least one region to render.')
    return
  end
  local regions, refusal = find_regions(names)
  if not regions then
    event(session_dir, 'ERROR', run_id, refusal)
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local saved = read_settings()
  local ok, files, failure = pcall(render_regions, folder, regions)
  write_settings(saved)
  if not ok then
    event(session_dir, 'ERROR', run_id, 'REAPER could not render: ' .. tostring(files))
    return
  end
  if not files then
    event(session_dir, 'ERROR', run_id, failure)
    return
  end
  for _, file in ipairs(files) do
    event(session_dir, 'FX_RENDER_FILE', run_id, file.region, file.path)
  end
  event(session_dir, 'FX_RENDERED', run_id, folder, #files)
end

return function(registry)
  -- The approvals already used in this session: each renders at most once.
  local used = {}
  registry.register('master_chain_read', function(ctx, args)
    master_chain_read(ctx.session_dir, args[1] or '')
  end)
  registry.register('render_with_fx', function(ctx, args)
    render_with_fx(used, ctx.session_dir, args[1] or '', args[2] or '', args[3] or '', args[4] or '')
  end)
end
