-- The Part A driver's entry script (integrations/reaper/spikes/pass_part_a.lua) run end to end on the fake: its guard,
-- its fixture, the real bridge loop it starts, its file-protocol host side and the results it writes. The fake lacks
-- the calls only a real REAPER has (a new project, adding tracks and items, state chunks, undo), so this file adds
-- stand-ins for them to its own fake; the rows' own checks are pass_part_a_test.lua's. What this proves is the wiring:
-- that the script runs to its results without an error, never records, keeps every path it writes in the scratch
-- folders, and removes those paths from what it writes.

local H = require('harness')
local Fake = require('fake_reaper')

local SPIKES = (assert(package.searchpath('harness', package.path)):gsub('[\\/]harness%.lua$', '')) .. '/../spikes'

-- A fake with stand-ins for what the script calls that the harness's fake does not model.
local function reaper_like(cfg)
  local fake = Fake.new(host)
  local api = fake.reaper
  fake.resource_path = cfg
  fake.audio_running = 1
  function api.Audio_Quit()
    fake.audio_running = 0
  end
  function api.Audio_IsRunning()
    return fake.audio_running
  end
  function api.GetAppVersion()
    return '7.80/x64'
  end
  function api.Main_SaveProjectEx(_, file)
    fake.saved = file
  end
  function api.Main_SaveProject()
    fake.change_count = fake.change_count + 1
  end
  function api.Main_openProject(file)
    fake.project_path = file:gsub('^noprompt:', '')
  end
  function api.InsertTrackAtIndex()
    fake:add_track('')
  end
  function api.GetSetMediaTrackInfo_String(track, key, value, set)
    if key == 'P_NAME' and set then
      track.name = value
    end
    return true, track.name
  end
  function api.AddMediaItemToTrack(track)
    return fake:add_item(track, {})
  end
  local set_item = api.SetMediaItemInfo_Value
  function api.SetMediaItemInfo_Value(item, key, value)
    if key == 'D_POSITION' or key == 'D_LENGTH' then
      item[key == 'D_POSITION' and 'position' or 'length'] = value
      table.sort(item.track.items, function(a, b)
        return a.position < b.position
      end)
      return true
    end
    return set_item(item, key, value)
  end
  local set_take = api.SetMediaItemTakeInfo_Value
  function api.SetMediaItemTakeInfo_Value(take, key, value)
    if key == 'D_PLAYRATE' then
      take.playrate = value
      return true
    end
    return set_take(take, key, value)
  end
  function api.SetTrackSelected(track, on)
    track.selected = on
  end
  function api.Undo_CanUndo2()
    return fake.undo[#fake.undo] and fake.undo[#fake.undo].label or nil
  end
  function api.Undo_DoUndo2()
    fake.undo_presses = (fake.undo_presses or 0) + 1
  end
  function api.OnPauseButton()
    fake.play_state = 2
  end
  function api.GetSet_ArrangeView2()
    return 0, 60
  end
  function api.GetTrackStateChunk(track)
    local lines = { '<TRACK', 'NAME ' .. tostring(track.name), 'REC ' .. (track.armed and 1 or 0), 'SEL ' .. (track.selected and 1 or 0) }
    for _, item in ipairs(track.items or {}) do
      lines[#lines + 1] = string.format('ITEM %s %.6f %.6f %s', item.guid, item.position, item.length, tostring(item.vol))
    end
    return true, table.concat(lines, '\n') .. '\n>'
  end
  return fake
end

-- Runs the script with `env` as its environment, pumping the fake's defer queue until it wrote its done marker.
local function run_script(env)
  local fake = reaper_like(env.NARRATION_UTILS_SPIKE_CFG)
  reaper = fake.reaper
  local getenv = os.getenv
  os.getenv = function(name)
    return env[name]
  end
  local ok, err = pcall(dofile, SPIKES .. '/pass_part_a.lua')
  os.getenv = getenv
  if not ok then
    return fake, err
  end
  local done = H.join(env.NARRATION_UTILS_SPIKE_OUT, 'pass-part-a-done.txt')
  for _ = 1, 20000 do
    if H.read_file(done) then
      break
    end
    fake:pump()
  end
  return fake
end

local function scratch_env()
  local out, cfg = host.tmpdir(), host.tmpdir()
  host.makedirs(H.join(out, 'media'))
  for _, name in ipairs({ 'take_a.wav', 'take_b.wav', 'take_c.wav' }) do
    H.write_file(H.join(H.join(out, 'media'), name), 'RIFF')
  end
  local ep0 = H.join(out, 'ep0-report.txt')
  H.write_file(ep0, 'PASS A6.1 answers ACTIVE_TAKE_SET changed\nPASS A7.1 lists the chain\nPASS A8.1 onto the track\nPASS A8b.1 two splits\n')
  return {
    NARRATION_UTILS_SPIKE_OUT = out,
    NARRATION_UTILS_SPIKE_CFG = cfg,
    NARRATION_UTILS_REAPER_DIR = host.reaper_dir,
    NARRATION_UTILS_PASS_EP0_REPORT = ep0,
    NARRATION_UTILS_PASS_REV = 'abc1234',
  }
end

H.test('the script runs to its results, merges the workspace report, and quits REAPER', function()
  local env = scratch_env()
  local fake, err = run_script(env)
  H.eq(err, nil)
  local results = H.read_text(H.join(env.NARRATION_UTILS_SPIKE_OUT, 'pass-part-a-results.md'))
  H.truthy(results, 'pass-part-a-results.md is written')
  H.contains(results, '- REAPER 7.80/x64 on Win64')
  H.contains(results, 'at `abc1234`')
  for _, row in ipairs({ 'A1', 'A2', 'A5', 'A6', 'A8b', 'A9c', 'A10', 'A11', 'A12', 'A13', 'A14' }) do
    H.contains(results, '| ' .. row .. ' | ', row)
  end
  H.contains(results, '| A6 | `set_active_take` | PASS | 1/1 |')
  -- The rows this file's stand-ins model fully; the others need REAPER's edit counter, playhead and undo.
  for _, row in ipairs({ 'A2', 'A4', 'A5', 'A9c', 'A10', 'A11' }) do
    H.truthy(results:find('| ' .. row .. ' | [^|]+ | PASS |'), row .. ' passes')
  end
  H.eq(results:find('Driver error', 1, true), nil, 'the script ran without an error')
  local quit = false
  for _, call in ipairs(fake.calls) do
    quit = quit or (call.name == 'Main_OnCommand' and call.command_id == 40004)
  end
  H.truthy(quit, 'REAPER is quit at the end')
  H.eq(fake.saved:find(env.NARRATION_UTILS_SPIKE_OUT, 1, true), 1, 'the project is saved into -Out')
end)

H.test('the script never records, and says so in its log', function()
  local env = scratch_env()
  local fake = run_script(env)
  for _, call in ipairs(fake.calls) do
    H.truthy(call.name ~= 'CSurf_OnRecord', 'the real CSurf_OnRecord is never called')
  end
  H.contains(H.read_text(H.join(env.NARRATION_UTILS_SPIKE_OUT, 'pass-part-a-log.txt')), 'record requests (must be 0): 0')
end)

H.test('what the script writes has the scratch paths removed', function()
  local env = scratch_env()
  run_script(env)
  for _, name in ipairs({ 'pass-part-a-results.md', 'pass-part-a-log.txt' }) do
    local text = H.read_text(H.join(env.NARRATION_UTILS_SPIKE_OUT, name))
    H.eq(text:find(env.NARRATION_UTILS_SPIKE_OUT, 1, true), nil, name .. ' names -Out')
    H.eq(text:find(host.reaper_dir, 1, true), nil, name .. ' names the bridge folder')
  end
  H.contains(H.read_text(H.join(env.NARRATION_UTILS_SPIKE_OUT, 'pass-part-a-log.txt')), '<out>')
end)

H.test('without the workspace report, A6 to A8b are not run, never passed', function()
  local env = scratch_env()
  env.NARRATION_UTILS_PASS_EP0_REPORT = nil
  run_script(env)
  local results = H.read_text(H.join(env.NARRATION_UTILS_SPIKE_OUT, 'pass-part-a-results.md'))
  H.contains(results, '| A6 | `set_active_take` | NOT RUN |')
  H.contains(results, '| A8b | `add_take_fx` | NOT RUN |')
end)

H.test('the script stops before touching anything when REAPER is not on the scratch -cfgfile', function()
  local env = scratch_env()
  local fake = reaper_like('C:\\Users\\Count\\AppData\\Roaming\\REAPER')
  reaper = fake.reaper
  local getenv = os.getenv
  os.getenv = function(name)
    return env[name]
  end
  local ok, err = pcall(dofile, SPIKES .. '/pass_part_a.lua')
  os.getenv = getenv
  H.eq(ok, false)
  H.contains(err, 'isolated -cfgfile')
  H.eq(#fake.tracks, 0, 'no track was added')
  H.eq(fake.saved, nil, 'nothing was saved')
end)

H.test('the script stops when NARRATION_UTILS_SPIKE_CFG is not set', function()
  local env = scratch_env()
  env.NARRATION_UTILS_SPIKE_CFG = nil
  local fake = reaper_like(host.tmpdir())
  reaper = fake.reaper
  local getenv = os.getenv
  os.getenv = function(name)
    return env[name]
  end
  local ok, err = pcall(dofile, SPIKES .. '/pass_part_a.lua')
  os.getenv = getenv
  H.eq(ok, false)
  H.contains(err, 'run-reaper.ps1')
end)
