-- Selecting a chapter's track in REAPER (narration_track_select.lua; chapter-track-link-control PRD Phase 4, Could):
-- from the chapter track slide-over, "Select in REAPER" brings the narrator's attention to the linked track without
-- changing anything else. It deselects every other track and selects the named one; a GUID that no longer resolves
-- is TRACK_STALE, exactly as chapter_track_state reports it, and nothing is selected in that case.

local H = require('harness')

local CH1 = '{00000001-0000-4000-8000-000000000001}'

local function new_session()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local chapter = s.fake:add_track('Chapter 1')
  local pickups = s.fake:add_track('Pickups')
  return s, chapter, pickups
end

H.test('select_track selects the named track and reports it', function()
  local s, chapter = new_session()
  s:send('select_track', 't1', chapter.guid)
  H.eq(s:events(), { { 'TRACK_SELECTED', 't1', CH1 } })
  H.eq(chapter.selected, true)
end)

H.test('select_track deselects every other track, leaving only the named one selected', function()
  local s, chapter, pickups = new_session()
  pickups.selected = true
  chapter.selected = false
  s:send('select_track', 't1', chapter.guid)
  H.eq(chapter.selected, true)
  H.eq(pickups.selected, false)
end)

H.test('select_track on an already-selected track changes nothing and still reports it', function()
  local s, chapter = new_session()
  chapter.selected = true
  s:send('select_track', 't1', chapter.guid)
  H.eq(s:events(), { { 'TRACK_SELECTED', 't1', CH1 } })
  H.eq(chapter.selected, true)
end)

H.test('select_track matches the track GUID without braces or case, and answers it normalised', function()
  local s, chapter = new_session()
  s:send('select_track', 't1', (chapter.guid:lower():gsub('[{}]', '')))
  H.eq(s:events(), { { 'TRACK_SELECTED', 't1', CH1 } })
end)

H.test('select_track on a GUID that no longer resolves reports TRACK_STALE and selects nothing', function()
  local s, chapter, pickups = new_session()
  pickups.selected = true
  s:send('select_track', 't1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}')
  H.eq(s:events(), { { 'TRACK_STALE', 't1', '{FFFFFFFF-0000-4000-8000-00000000FFFF}' } })
  H.eq(chapter.selected, false)
  H.eq(pickups.selected, true, 'a stale request changes no other track selection')
end)

H.test('select_track opens no undo block: selection is not project data', function()
  local s, chapter = new_session()
  s:send('select_track', 't1', chapter.guid)
  H.eq(#s.fake.undo, 0)
end)
