-- The mastering port's DAW row (ADR 0306, render-encode-master PRD Phase 9): master_chain_read and render_with_fx
-- (narration_master_render.lua). master_chain_read lists the FX a render runs and changes nothing. render_with_fx is the
-- bridge's one render: it renders named regions through the project's track and master FX, only with an approval the host
-- was just given (used once), only into an empty folder the app made inside the project, never over a file, and puts the
-- narrator's render settings back afterwards. What REAPER itself does with the settings (tails, sample rate, what
-- RENDER_TARGETS answers for custom bounds) is the owner's scripted pass on #510, not this file.

local H = require('harness')

local APPROVAL = '0123456789abcdef0123456789abcdef'
local OTHER_APPROVAL = 'fedcba9876543210fedcba9876543210'
local SEP = package.config:sub(1, 1)

local function new_session()
  return H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
end

-- A project folder with the app's run folder made in it, the way the daw row makes it before it asks for a render.
local function run_folder(s, name)
  local project = s:path('Book')
  local folder = H.join(H.join(H.join(project, 'narration-utils'), 'mastering'), name or 'run1')
  host.makedirs(folder)
  return folder, project
end

local function rendered(s)
  return s.fake.renders or {}
end

local function render_triggers(s)
  local count = 0
  for _, call in ipairs(s.fake.calls) do
    if call.name == 'Main_OnCommand' then
      count = count + 1
    end
  end
  return count
end

-- The narrator's own render settings before the command, so a test can check they are back afterwards.
local function narrator_settings(s)
  s.fake.render_info_string['RENDER_FILE'] = 'C:/Renders'
  s.fake.render_info_string['RENDER_PATTERN'] = '$region'
  s.fake.render_info['RENDER_BOUNDSFLAG'] = 3
  s.fake.render_info['RENDER_STARTPOS'] = 1
  s.fake.render_info['RENDER_ENDPOS'] = 2
  s.fake.render_info['RENDER_SETTINGS'] = 3
  s.fake.render_info['RENDER_ADDTOPROJ'] = 1
end

local function settings_are_the_narrators(s)
  H.eq({
    s.fake.render_info_string['RENDER_FILE'],
    s.fake.render_info_string['RENDER_PATTERN'],
    s.fake.render_info['RENDER_BOUNDSFLAG'],
    s.fake.render_info['RENDER_STARTPOS'],
    s.fake.render_info['RENDER_ENDPOS'],
    s.fake.render_info['RENDER_SETTINGS'],
    s.fake.render_info['RENDER_ADDTOPROJ'],
  }, { 'C:/Renders', '$region', 3, 1, 2, 3, 1 }, "the narrator's render settings are put back")
end

local function slash(path)
  return (path:gsub('\\', '/'))
end

-- master_chain_read ------------------------------------------------------------------------------------------------

H.test('master_chain_read lists every track with FX, then the master, with each slot on or off', function()
  local s = new_session()
  local voice = s.fake:add_track('Voice')
  voice.fx = { { name = 'VST: ReaEQ (Cockos)' }, { name = 'VST: ReaComp (Cockos)', enabled = false } }
  s.fake:add_track('Room tone')
  s.fake.master.fx = { { name = 'VST: ReaLimit (Cockos)' } }
  s:send('master_chain_read', 'c1')
  H.eq(s:events(), {
    { 'MASTER_CHAIN_FX', 'c1', voice.guid, 'Voice', 'VST: ReaEQ (Cockos)', '1' },
    { 'MASTER_CHAIN_FX', 'c1', voice.guid, 'Voice', 'VST: ReaComp (Cockos)', '0' },
    { 'MASTER_CHAIN_FX', 'c1', 'master', 'MASTER', 'VST: ReaLimit (Cockos)', '1' },
    { 'MASTER_CHAIN_READ', 'c1', '3', '0' },
  })
end)

H.test('master_chain_read answers an empty chain for a project with no FX', function()
  local s = new_session()
  s.fake:add_track('Voice')
  s:send('master_chain_read', 'c1')
  H.eq(s:events(), { { 'MASTER_CHAIN_READ', 'c1', '0', '0' } })
end)

H.test('master_chain_read reads and changes nothing', function()
  local s = new_session()
  local voice = s.fake:add_track('Voice')
  voice.fx = { { name = 'VST: ReaEQ (Cockos)' } }
  s:send('master_chain_read', 'c1')
  H.eq(#s.fake.undo, 0, 'no undo point')
  H.eq(render_triggers(s), 0, 'no action run')
  for _, call in ipairs(s.fake.calls) do
    H.truthy(not call.set, 'no project setting written: ' .. tostring(call.key))
    H.truthy(call.name ~= 'TrackFX_AddByName', 'no FX added')
  end
  H.eq(#voice.fx, 1)
end)

H.test('master_chain_read stops listing at its cap and says the list was cut short', function()
  local s = new_session()
  local voice = s.fake:add_track('Voice')
  voice.fx = {}
  for index = 1, 501 do
    voice.fx[index] = { name = 'FX ' .. index }
  end
  s:send('master_chain_read', 'c1')
  local events = s:events()
  H.eq(#events, 501)
  H.eq(events[#events], { 'MASTER_CHAIN_READ', 'c1', '500', '1' })
end)

H.test('master_chain_read needs the track FX API', function()
  local s = new_session()
  s.fake:remove_api('TrackFX_GetFXName')
  s:send('master_chain_read', 'c1')
  H.eq(s:events(), { { 'ERROR', 'c1', 'This REAPER version cannot list FX.' } })
end)

-- render_with_fx: the render -----------------------------------------------------------------------------------------

H.test('render_with_fx renders one region through the master mix into the run folder and says where', function()
  local s = new_session()
  s.fake:add_region(10, 70, 'Chapter 1')
  local folder = run_folder(s)
  s:send('render_with_fx', 'r1', APPROVAL, folder, 'Chapter 1')
  local file = H.join(folder, 'fx-01.wav')
  H.eq(s:events(), {
    { 'FX_RENDER_FILE', 'r1', 'Chapter 1', file },
    { 'FX_RENDERED', 'r1', folder, '1' },
  })
  H.truthy(H.read_file(file) ~= nil, 'the rendered file is in the run folder')
  local render = rendered(s)[1]
  H.eq(#rendered(s), 1)
  H.eq({ render.boundsflag, render.startpos, render.endpos }, { 0, 10, 70 }, "the region's own bounds")
  H.eq(render.settings, 0, 'the master mix, so every track and master FX runs')
  H.eq(render.addtoproj, 0, 'nothing rendered is added to the project')
end)

H.test('render_with_fx renders several regions in the order asked, one file each', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  s.fake:add_region(6, 9, 'Chapter 2')
  local folder = run_folder(s)
  s:send('render_with_fx', 'r1', APPROVAL, folder, 'Chapter 2\nChapter 1')
  H.eq(s:events(), {
    { 'FX_RENDER_FILE', 'r1', 'Chapter 2', H.join(folder, 'fx-01.wav') },
    { 'FX_RENDER_FILE', 'r1', 'Chapter 1', H.join(folder, 'fx-02.wav') },
    { 'FX_RENDERED', 'r1', folder, '2' },
  })
  H.eq({ rendered(s)[1].startpos, rendered(s)[2].startpos }, { 6, 0 })
end)

H.test("render_with_fx puts the narrator's render settings back after rendering", function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  narrator_settings(s)
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 1')
  H.eq(#rendered(s), 1)
  settings_are_the_narrators(s)
end)

H.test('render_with_fx opens no undo point and never reads the render stats', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 1')
  H.eq(#s.fake.undo, 0)
  for _, call in ipairs(s.fake.calls) do
    H.truthy(call.key ~= 'RENDER_STATS' and call.key ~= 'RENDER_STATS_SUMMARY', 'RENDER_STATS can trigger a render (spike S5)')
    H.truthy(call.key ~= 'RENDER_FORMAT' or not call.set, "the narrator's render format is never written")
  end
end)

-- render_with_fx: the approval -----------------------------------------------------------------------------------------

H.test('render_with_fx refuses without the approval and renders nothing', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  narrator_settings(s)
  s:send('render_with_fx', 'r1', '', run_folder(s), 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'A render with FX needs your approval in the app.' } })
  H.eq(render_triggers(s), 0)
  settings_are_the_narrators(s)
end)

H.test('render_with_fx refuses an approval that is not one the host makes', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  local folder = run_folder(s)
  for _, approval in ipairs({ 'yes', '0123456789abcdef', 'zz23456789abcdef0123456789abcdef' }) do
    s:send('render_with_fx', 'r1', approval, folder, 'Chapter 1')
    H.eq(s:events(), { { 'ERROR', 'r1', 'A render with FX needs your approval in the app.' } }, approval)
  end
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx renders once per approval: the same approval again is refused', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s, 'run1'), 'Chapter 1')
  s:events()
  s:send('render_with_fx', 'r2', APPROVAL, run_folder(s, 'run2'), 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r2', 'This approval was already used. Approve the render again in the app.' } })
  H.eq(#rendered(s), 1)
  s:send('render_with_fx', 'r3', OTHER_APPROVAL, run_folder(s, 'run3'), 'Chapter 1')
  H.eq(s:events()[2][1], 'FX_RENDERED', 'a new approval renders')
end)

H.test('an approval that was refused for another reason is still used up', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 9')
  s:events()
  s:send('render_with_fx', 'r2', APPROVAL, run_folder(s, 'run2'), 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r2', 'This approval was already used. Approve the render again in the app.' } })
  H.eq(render_triggers(s), 0)
end)

-- render_with_fx: the folder ---------------------------------------------------------------------------------------------

H.test('render_with_fx refuses a folder that is not a run folder the app made in the project', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  local folder, project = run_folder(s)
  local mastering = H.join(H.join(project, 'narration-utils'), 'mastering')
  local refused = {
    '',
    'narration-utils' .. SEP .. 'mastering' .. SEP .. 'run1', -- relative
    project, -- the project folder itself
    H.join(project, 'Renders'), -- not the app's folder
    H.join(mastering, '..'), -- escapes
    H.join(H.join(mastering, '..'), 'run1'),
    H.join(H.join(mastering, 'run1'), 'deeper'),
    H.join(mastering, 'run 1!'),
  }
  for index, candidate in ipairs(refused) do
    s:send('render_with_fx', 'r1', string.format('%032x', index), candidate, 'Chapter 1')
    H.eq(s:events(), { { 'ERROR', 'r1', 'The render folder is not one the app made in the project.' } }, candidate)
  end
  H.eq(render_triggers(s), 0)
  H.truthy(folder ~= nil)
end)

H.test('render_with_fx refuses a run folder reached through a .. part, even one that exists', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  local _, project = run_folder(s)
  local elsewhere = H.join(H.join(H.join(H.join(project, 'Elsewhere'), 'narration-utils'), 'mastering'), 'run1')
  host.makedirs(elsewhere)
  local mastering = H.join(H.join(project, 'narration-utils'), 'mastering')
  local escaping = H.join(H.join(H.join(H.join(H.join(H.join(mastering, '..'), '..'), 'Elsewhere'), 'narration-utils'), 'mastering'), 'run1')
  s:send('render_with_fx', 'r1', APPROVAL, escaping, 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'The render folder is not one the app made in the project.' } })
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx refuses a run folder that does not exist', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  local _, project = run_folder(s)
  local missing = H.join(H.join(H.join(project, 'narration-utils'), 'mastering'), 'run9')
  s:send('render_with_fx', 'r1', APPROVAL, missing, 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'The render folder is not one the app made in the project.' } })
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx refuses a run folder that is not empty, so it never writes over a file', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  local folder = run_folder(s)
  local existing = H.join(folder, 'fx-01.wav')
  H.write_file(existing, 'keep')
  s:send('render_with_fx', 'r1', APPROVAL, folder, 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'The render folder is not empty.' } })
  H.eq(H.read_file(existing), 'keep')
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx refuses a run folder that holds a folder', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  local folder = run_folder(s)
  host.makedirs(H.join(folder, 'inner'))
  s:send('render_with_fx', 'r1', APPROVAL, folder, 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'The render folder is not empty.' } })
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx refuses when REAPER would render anywhere but the one file in the run folder', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  narrator_settings(s)
  local folder = run_folder(s)
  s.fake.render_targets = function()
    return slash(folder) .. '/fx-01.wav;' .. slash(folder) .. '/../escaped.wav'
  end
  s:send('render_with_fx', 'r1', APPROVAL, folder, 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'REAPER would not render to the folder the app made.' } })
  H.eq(render_triggers(s), 0)
  settings_are_the_narrators(s)
end)

H.test('render_with_fx refuses a render format other than WAV and leaves the format alone', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  narrator_settings(s)
  s.fake.render_ext = 'mp3'
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 1')
  H.eq(s:events(), {
    { 'ERROR', 'r1', "REAPER renders to a format other than WAV. Choose WAV in REAPER's render settings, then try again." },
  })
  H.eq(render_triggers(s), 0)
  settings_are_the_narrators(s)
end)

-- render_with_fx: the regions and REAPER's state -------------------------------------------------------------------------

H.test('render_with_fx needs at least one region', function()
  local s = new_session()
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), '')
  H.eq(s:events(), { { 'ERROR', 'r1', 'Name at least one region to render.' } })
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx refuses a region the project does not have, before rendering any', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  s.fake:insert_marker({ is_region = false, pos = 1, rgnend = 0, name = 'Chapter 2', color = 0 })
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 1\nChapter 2')
  H.eq(s:events(), { { 'ERROR', 'r1', 'There is no region named "Chapter 2".' } })
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx refuses a region name two regions share', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  s.fake:add_region(6, 9, 'Chapter 1')
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'More than one region is named "Chapter 1".' } })
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx refuses while REAPER records', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  s.fake.play_state = 5
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'REAPER is recording. Stop recording first.' } })
  H.eq(render_triggers(s), 0)
end)

H.test('render_with_fx reports a render that wrote nothing, and still puts the settings back', function()
  local s = new_session()
  s.fake:add_region(0, 5, 'Chapter 1')
  narrator_settings(s)
  s.fake.render_writes_nothing = true
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'REAPER did not write the rendered file for "Chapter 1".' } })
  settings_are_the_narrators(s)
end)

H.test('render_with_fx needs the render API', function()
  local s = new_session()
  s.fake:remove_api('GetSetProjectInfo_String')
  s:send('render_with_fx', 'r1', APPROVAL, run_folder(s), 'Chapter 1')
  H.eq(s:events(), { { 'ERROR', 'r1', 'This REAPER version cannot render with FX.' } })
  H.eq(render_triggers(s), 0)
end)
