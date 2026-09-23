-- Per-chapter render configuration: configure_chapter_render (see docs/architecture/reaper-bridge.md and
-- docs/research/reaper-spike-s5-render-details.md). Configuration only (Phase 11 / Open Question 7, answered
-- (a)): sets RENDER_FILE, RENDER_PATTERN ("$region") and RENDER_BOUNDSFLAG (3, "all regions"), reads RENDER_TARGETS
-- back, and never touches a render action. The last test in this file is the load-bearing one: it proves nothing
-- in configure_chapter_render ever calls Main_OnCommand or reads RENDER_STATS/RENDER_STATS_SUMMARY, the two things
-- the S5 spike found can actually trigger a real render.

local H = require('harness')

local function new_session()
  return H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
end

H.test('configure_chapter_render needs the render-config API', function()
  local s = new_session()
  s.fake:remove_api('GetSetProjectInfo_String')
  s:send('configure_chapter_render', 't1', s:path('renders'))
  H.eq(s:events(), { { 'ERROR', 't1', 'This REAPER version cannot configure render settings.' } })
end)

H.test('configure_chapter_render requires an output folder', function()
  local s = new_session()
  s:send('configure_chapter_render', 't1', '')
  H.eq(s:events(), { { 'ERROR', 't1', 'An output folder is required.' } })
end)

H.test('configure_chapter_render sets bounds to all regions and the pattern to $region', function()
  local s = new_session()
  local folder = s:path('renders')
  s:send('configure_chapter_render', 't1', folder)
  H.eq(s.fake.render_info_string['RENDER_FILE'], folder)
  H.eq(s.fake.render_info_string['RENDER_PATTERN'], '$region')
  H.eq(s.fake.render_info['RENDER_BOUNDSFLAG'], 3)
end)

H.test('configure_chapter_render never writes RENDER_FORMAT', function()
  local s = new_session()
  s:send('configure_chapter_render', 't1', s:path('renders'))
  H.eq(s.fake.render_info_string['RENDER_FORMAT'], nil)
end)

H.test('configure_chapter_render reports the predicted file names from RENDER_TARGETS', function()
  local s = new_session()
  s.fake:add_region(0, 3, 'Chapter 1')
  s.fake:add_region(4, 7, 'Chapter 2')
  local folder = s:path('renders')
  s:send('configure_chapter_render', 't1', folder)
  H.eq(s:events(), {
    { 'RENDER_CONFIGURED', 't1', folder, '2', folder .. '/Chapter 1.wav;' .. folder .. '/Chapter 2.wav' },
  })
end)

H.test('configure_chapter_render reports 0 files when no chapter regions exist yet', function()
  local s = new_session()
  local folder = s:path('renders')
  s:send('configure_chapter_render', 't1', folder)
  H.eq(s:events(), { { 'RENDER_CONFIGURED', 't1', folder, '0', '' } })
end)

H.test('configure_chapter_render ignores a plain (non-region) marker', function()
  local s = new_session()
  s.fake:insert_marker({ is_region = false, pos = 1, rgnend = 0, name = 'PICKUP: not a chapter', color = 0 })
  local folder = s:path('renders')
  s:send('configure_chapter_render', 't1', folder)
  H.eq(s:events(), { { 'RENDER_CONFIGURED', 't1', folder, '0', '' } })
end)

H.test('configure_chapter_render creates the output folder', function()
  local s = new_session()
  local folder = s:path('renders')
  s:send('configure_chapter_render', 't1', folder)
  local probe = H.join(folder, 'probe.txt')
  local handle = io.open(probe, 'w')
  H.truthy(handle ~= nil, 'the output folder should exist so a file can be written into it')
  if handle then
    handle:close()
    os.remove(probe)
  end
end)

H.test('configure_chapter_render never triggers a render: no Main_OnCommand call, and RENDER_STATS is never read', function()
  local s = new_session()
  s.fake:add_region(0, 3, 'Chapter 1')
  s:send('configure_chapter_render', 't1', s:path('renders'))
  local render_triggers = 0
  for _, call in ipairs(s.fake.calls) do
    if call.name == 'Main_OnCommand' then
      render_triggers = render_triggers + 1
    end
    if call.name == 'GetSetProjectInfo_String' and (call.key == 'RENDER_STATS' or call.key == 'RENDER_STATS_SUMMARY') then
      render_triggers = render_triggers + 1
    end
  end
  H.eq(render_triggers, 0)
end)
