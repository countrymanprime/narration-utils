-- The live project-change indicator: project_state (see narration_project_state.lua and
-- docs/prds/reaper-automation-follow-through.prd.md Phase 13). Coarse: it only reports REAPER's own edit counter
-- (GetProjectStateChangeCount) and the current project's saved-file path; it never triggers anything itself.

local H = require('harness')

local function new_session(path)
  return H.session({ project_path = path })
end

H.test('project_state needs the change-count API', function()
  local s = new_session(H.join(host.tmpdir(), 'Book.rpp'))
  s.fake:remove_api('GetProjectStateChangeCount')
  s:send('project_state', 't1')
  H.eq(s:events(), { { 'ERROR', 't1', 'This REAPER version cannot report the project change count.' } })
end)

H.test('project_state reports the current change count and project path', function()
  local path = H.join(host.tmpdir(), 'Book.rpp')
  local s = new_session(path)
  s.fake.change_count = 7
  s:send('project_state', 't1')
  H.eq(s:events(), { { 'PROJECT_STATE', 't1', '7', path } })
end)

H.test('project_state starts at change count 0 for a freshly opened project', function()
  local s = new_session(H.join(host.tmpdir(), 'Book.rpp'))
  s:send('project_state', 't1')
  H.eq(s:events()[1][3], '0')
end)

H.test('project_state reports an empty path when the project has never been saved', function()
  local s = new_session('')
  s:send('project_state', 't1')
  H.eq(s:events(), { { 'PROJECT_STATE', 't1', '0', '' } })
end)

H.test('project_state reflects a later, higher count once REAPER records more edits', function()
  local s = new_session(H.join(host.tmpdir(), 'Book.rpp'))
  s:send('project_state', 't1')
  s.fake.change_count = s.fake.change_count + 1
  s:send('project_state', 't2')
  local events = s:events()
  H.eq(events[1][2], 't1')
  H.eq(events[1][3], '0')
  H.eq(events[2][2], 't2')
  H.eq(events[2][3], '1')
end)

H.test('project_state never mutates the project: no undo block, no item or marker touched', function()
  local s = new_session(H.join(host.tmpdir(), 'Book.rpp'))
  local track = s.fake:add_track('Chapter 1')
  s.fake:add_item(track, { position = 0, length = 3 })
  s:send('project_state', 't1')
  H.eq(#s.fake.undo, 0)
  H.eq(s.fake.open_undo_blocks, 0)
end)
