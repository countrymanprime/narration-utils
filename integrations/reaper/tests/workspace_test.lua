-- The edit and proof workspace's REAPER actions (narration_workspace.lua; edit-and-proof-workspace PRD Phases 6, 8 and
-- 9): set_active_take ("Use this take", EP7 A), list_fx_chains (EP8) and apply_fx_chain (EP9 A: split at the passage's
-- edges and add the chain as take FX on the middle piece, in one undo block).

local H = require('harness')

local ITEM = '{AAAAAAAA-0000-4000-8000-000000000001}'
local STALE = '{FFFFFFFF-0000-4000-8000-00000000FFFF}'

local function new_session()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local track = s.fake:add_track('Chapter 1')
  return s, track
end

local function two_takes(s, track)
  local item = s.fake:add_item(track, { guid = ITEM, position = 10, length = 5, source = 'one.wav' })
  local second = s.fake.reaper.AddTakeToMediaItem(item)
  second.source = { file = 'two.wav' }
  return item, item.takes[1], second
end

local function calls_named(s, name)
  local count = 0
  for _, call in ipairs(s.fake.calls) do
    if call.name == name then
      count = count + 1
    end
  end
  return count
end

-- Writes chain files under the fake resource path's FXChains folder: each entry is a path relative to it.
local function chains(s, names)
  local root = H.join(s.dir, 'FXChains')
  for _, name in ipairs(names) do
    local path, dir = root, root
    for part in name:gmatch('[^/]+') do
      host.makedirs(dir)
      path = H.join(path, part)
      dir = path
    end
    H.write_file(path, '<TAKEFX\n>\n')
  end
  return root
end

-- set_active_take ------------------------------------------------------------------------------------------------

H.test('set_active_take makes the named take active in one undo step', function()
  local s, track = new_session()
  local item, _, second = two_takes(s, track)
  s:send('set_active_take', 'u1', ITEM, second.guid)
  H.eq(s:events(), { { 'ACTIVE_TAKE_SET', 'u1', ITEM, second.guid, '1' } })
  H.eq(item.active_index, 2)
  H.eq(s.fake:undo_labels(), { 'Narration Utils: use take' })
  H.truthy((s.fake.item_updates or 0) > 0, 'the item is refreshed after the change')
end)

H.test('set_active_take changes nothing when the take is already active', function()
  local s, track = new_session()
  local _, first = two_takes(s, track)
  s:send('set_active_take', 'u1', ITEM:lower(), first.guid)
  H.eq(s:events(), { { 'ACTIVE_TAKE_SET', 'u1', ITEM, first.guid, '0' } })
  H.eq(#s.fake.undo, 0)
  H.eq(calls_named(s, 'SetActiveTake'), 0)
end)

H.test('set_active_take reports an item or take that is gone and changes nothing', function()
  local s, track = new_session()
  local item, first = two_takes(s, track)
  s:send('set_active_take', 'u1', STALE, first.guid)
  s:send('set_active_take', 'u2', ITEM, STALE)
  H.eq(s:events(), { { 'ITEM_STALE', 'u1', STALE, 'item' }, { 'ITEM_STALE', 'u2', STALE, 'take' } })
  H.eq(item.active_index or 1, 1)
  H.eq(#s.fake.undo, 0)
end)

H.test('set_active_take never uses a take of another item with the same GUID prefix or position', function()
  local s, track = new_session()
  two_takes(s, track)
  local other = s.fake:add_item(track, { position = 20, length = 5, source = 'x.wav' })
  s:send('set_active_take', 'u1', ITEM, other.takes[1].guid)
  H.eq(s:events(), { { 'ITEM_STALE', 'u1', other.takes[1].guid, 'take' } })
end)

H.test('set_active_take is refused while REAPER is recording, and needs the API', function()
  local s, track = new_session()
  local _, _, second = two_takes(s, track)
  s.fake.play_state = 5
  s:send('set_active_take', 'u1', ITEM, second.guid)
  H.eq(s:events(), { { 'ERROR', 'u1', 'REAPER is recording. Stop recording first.' } })
  s.fake.play_state = 0
  s.fake:remove_api('SetActiveTake')
  s:send('set_active_take', 'u2', ITEM, second.guid)
  H.eq(s:events(), { { 'ERROR', 'u2', 'This REAPER version cannot choose the active take.' } })
  H.eq(calls_named(s, 'SetActiveTake'), 0)
end)

-- list_fx_chains -------------------------------------------------------------------------------------------------

H.test('list_fx_chains lists the chain files under FXChains by relative name with forward slashes, sorted', function()
  local s = new_session()
  chains(s, { 'Voice/Test EQ.RfxChain', 'Breath.rfxchain', 'Voice/De-ess/Soft.RfxChain', 'notes.txt', 'Voice/readme.md' })
  s:send('list_fx_chains', 'f1')
  H.eq(s:events(), {
    { 'FX_CHAIN', 'f1', 'Breath.rfxchain' },
    { 'FX_CHAIN', 'f1', 'Voice/De-ess/Soft.RfxChain' },
    { 'FX_CHAIN', 'f1', 'Voice/Test EQ.RfxChain' },
    { 'FX_CHAINS_LISTED', 'f1', '3', '0' },
  })
end)

H.test('list_fx_chains answers none when the folder does not exist', function()
  local s = new_session()
  s:send('list_fx_chains', 'f1')
  H.eq(s:events(), { { 'FX_CHAINS_LISTED', 'f1', '0', '0' } })
end)

H.test('list_fx_chains sees a chain added since the last listing (the listing cache is cleared)', function()
  local s = new_session()
  chains(s, { 'A.RfxChain' })
  s:send('list_fx_chains', 'f1')
  s:events()
  chains(s, { 'B.RfxChain' })
  s:send('list_fx_chains', 'f2')
  H.eq(s:events()[3], { 'FX_CHAINS_LISTED', 'f2', '2', '0' })
end)

H.test('list_fx_chains stops at its depth and count limits and says it did', function()
  local s = new_session()
  chains(s, { 'a/b/c/d/e/Deep.RfxChain', 'a/b/c/Shallow.RfxChain' })
  s:send('list_fx_chains', 'f1')
  H.eq(s:events(), { { 'FX_CHAIN', 'f1', 'a/b/c/Shallow.RfxChain' }, { 'FX_CHAINS_LISTED', 'f1', '1', '1' } })
  local many = {}
  for index = 1, 505 do
    many[#many + 1] = string.format('Many/%03d.RfxChain', index)
  end
  local t = new_session()
  chains(t, many)
  t:send('list_fx_chains', 'f2')
  local events = t:events()
  H.eq(#events, 501)
  H.eq(events[#events], { 'FX_CHAINS_LISTED', 'f2', '500', '1' })
end)

H.test('list_fx_chains changes nothing', function()
  local s = new_session()
  chains(s, { 'A.RfxChain' })
  s:send('list_fx_chains', 'f1')
  H.eq(#s.fake.undo, 0)
end)

-- apply_fx_chain -------------------------------------------------------------------------------------------------

-- An item at 10..15 s whose take starts 2 s into its source: source 3..4 s is project 11..12 s.
local function trimmed_item(s, track)
  local item = s.fake:add_item(track, { guid = ITEM, position = 10, length = 5, source = 'ch1.wav', startoffs = 2 })
  item.ext['narration_utils_line_id'] = 'line-000001'
  return item
end

H.test('apply_fx_chain splits at both edges and adds the chain to the middle take only, in one undo step', function()
  local s, track = new_session()
  local root = chains(s, { 'Voice/Test EQ.RfxChain' })
  local item = trimmed_item(s, track)
  s:send('apply_fx_chain', 'x1', ITEM, item.takes[1].guid, '3', '4', 'Voice/Test EQ.RfxChain')
  local events = s:events()
  H.eq(#events, 1)
  H.eq({ events[1][1], events[1][2], events[1][3], events[1][6], events[1][7] }, { 'FX_CHAIN_APPLIED', 'x1', 'Voice/Test EQ.RfxChain', '2', '1' })
  local pieces = track.items
  H.eq(#pieces, 3)
  H.eq({ pieces[1].position, pieces[1].length, pieces[2].position, pieces[2].length, pieces[3].position }, { 10, 1, 11, 1, 12 })
  H.eq({ #(pieces[1].takes[1].fx or {}), #pieces[2].takes[1].fx, #pieces[3].takes[1].fx }, { 0, 1, 0 })
  H.eq(pieces[2].takes[1].fx[1].name, H.join(H.join(root, 'Voice'), 'Test EQ.RfxChain'), 'the chain is loaded by its full path')
  H.eq(events[1][4], pieces[2].guid)
  H.eq(events[1][5], pieces[2].takes[1].guid)
  H.eq(
    { pieces[1].ext['narration_utils_line_id'], pieces[2].ext['narration_utils_line_id'], pieces[3].ext['narration_utils_line_id'] },
    { 'line-000001', 'line-000001', 'line-000001' }
  )
  H.eq(s.fake:undo_labels(), { 'Narration Utils: apply FX chain Voice/Test EQ.RfxChain' })
  H.eq(s.fake.ui_refresh_hold or 0, 0, 'every PreventUIRefresh(1) is released')
end)

H.test('apply_fx_chain on the whole item splits nothing, and at one edge splits once', function()
  local s, track = new_session()
  chains(s, { 'A.RfxChain' })
  local item = trimmed_item(s, track)
  s:send('apply_fx_chain', 'x1', ITEM, item.takes[1].guid, '2', '7', 'A.RfxChain')
  local whole = s:events()[1]
  H.eq({ whole[4], whole[6] }, { ITEM, '0' })
  H.eq(#track.items, 1)
  s:send('apply_fx_chain', 'x2', ITEM, item.takes[1].guid, '2', '3', 'A.RfxChain')
  H.eq(s:events()[1][6], '1')
  H.eq(#track.items, 2)
end)

H.test('apply_fx_chain refuses a chain it would not list, a path outside the folder and a missing file', function()
  local s, track = new_session()
  chains(s, { 'A.RfxChain' })
  H.write_file(H.join(s.dir, 'reaper.ini'), '[reaper]\n')
  local item = trimmed_item(s, track)
  for _, name in ipairs({ '../reaper.ini', '..\\reaper.ini', '/etc/passwd', 'C:\\Windows\\x.RfxChain', 'Voice/../A.RfxChain', 'A.txt', 'Missing.RfxChain', '' }) do
    s:send('apply_fx_chain', 'x1', ITEM, item.takes[1].guid, '3', '4', name)
    H.eq(s:events(), { { 'ERROR', 'x1', 'That FX chain is not in the FXChains folder REAPER lists.' } }, name)
  end
  H.eq(#track.items, 1)
  H.eq(#s.fake.undo, 0)
  H.eq(calls_named(s, 'TakeFX_AddByName'), 0)
end)

H.test('apply_fx_chain refuses a chain file that is there but deeper than the listing reaches', function()
  local s, track = new_session()
  chains(s, { 'a/b/c/d/e/Deep.RfxChain' })
  local item = trimmed_item(s, track)
  s:send('apply_fx_chain', 'x1', ITEM, item.takes[1].guid, '3', '4', 'a/b/c/d/e/Deep.RfxChain')
  H.eq(s:events(), { { 'ERROR', 'x1', 'That FX chain is not in the FXChains folder REAPER lists.' } })
  H.eq(calls_named(s, 'TakeFX_AddByName'), 0)
end)

H.test('apply_fx_chain reports a stale item, take or passage and changes nothing', function()
  local s, track = new_session()
  chains(s, { 'A.RfxChain' })
  local item = trimmed_item(s, track)
  local take = item.takes[1].guid
  s:send('apply_fx_chain', 'x1', STALE, take, '3', '4', 'A.RfxChain')
  s:send('apply_fx_chain', 'x2', ITEM, STALE, '3', '4', 'A.RfxChain')
  s:send('apply_fx_chain', 'x3', ITEM, take, '8', '9', 'A.RfxChain')
  H.eq(s:events(), { { 'ITEM_STALE', 'x1', STALE, 'item' }, { 'ITEM_STALE', 'x2', STALE, 'take' }, { 'ITEM_STALE', 'x3', ITEM, 'range' } })
  H.eq(#track.items, 1)
  H.eq(#s.fake.undo, 0)
end)

H.test('apply_fx_chain refuses a passage on a take that is not playing, an unusable time and recording', function()
  local s, track = new_session()
  chains(s, { 'A.RfxChain' })
  local item = trimmed_item(s, track)
  local other = s.fake.reaper.AddTakeToMediaItem(item)
  s:send('apply_fx_chain', 'x1', ITEM, other.guid, '0', '1', 'A.RfxChain')
  s:send('apply_fx_chain', 'x2', ITEM, item.takes[1].guid, '4', '3', 'A.RfxChain')
  s:send('apply_fx_chain', 'x3', ITEM, item.takes[1].guid, 'soon', '3', 'A.RfxChain')
  s.fake.play_state = 5
  s:send('apply_fx_chain', 'x4', ITEM, item.takes[1].guid, '3', '4', 'A.RfxChain')
  H.eq(s:events(), {
    { 'ERROR', 'x1', 'The passage is not on the take that plays.' },
    { 'ERROR', 'x2', 'The passage has no usable time.' },
    { 'ERROR', 'x3', 'The passage has no usable time.' },
    { 'ERROR', 'x4', 'REAPER is recording. Stop recording first.' },
  })
  H.eq(#track.items, 1)
end)

H.test('apply_fx_chain says so when REAPER does not load the chain, and closes its undo step', function()
  local s, track = new_session()
  chains(s, { 'A.RfxChain' })
  local item = trimmed_item(s, track)
  s.fake.fx_load_fails = true
  s:send('apply_fx_chain', 'x1', ITEM, item.takes[1].guid, '3', '4', 'A.RfxChain')
  H.eq(s:events(), { { 'ERROR', 'x1', 'REAPER did not load the FX chain. The item was split: press Undo in REAPER to rejoin it.' } })
  H.eq(s.fake:undo_labels(), { 'Narration Utils: apply FX chain A.RfxChain' })
  H.eq(s.fake.ui_refresh_hold or 0, 0)
end)

H.test('apply_fx_chain reports how many FX a chain added', function()
  local s, track = new_session()
  chains(s, { 'A.RfxChain' })
  local item = trimmed_item(s, track)
  s.fake.chain_fx_count = 3
  s:send('apply_fx_chain', 'x1', ITEM, item.takes[1].guid, '3', '4', 'A.RfxChain')
  H.eq(s:events()[1][7], '3')
end)

H.test('apply_fx_chain needs the split and take FX APIs', function()
  local s, track = new_session()
  chains(s, { 'A.RfxChain' })
  local item = trimmed_item(s, track)
  s.fake:remove_api('TakeFX_AddByName')
  s:send('apply_fx_chain', 'x1', ITEM, item.takes[1].guid, '3', '4', 'A.RfxChain')
  H.eq(s:events(), { { 'ERROR', 'x1', 'This REAPER version cannot apply an FX chain.' } })
end)

H.test('the workspace commands never call Main_OnCommand', function()
  local s, track = new_session()
  chains(s, { 'A.RfxChain' })
  local item = trimmed_item(s, track)
  s:send('list_fx_chains', 'f1')
  s:send('apply_fx_chain', 'x1', ITEM, item.takes[1].guid, '3', '4', 'A.RfxChain')
  s:send('set_active_take', 'u1', ITEM, item.takes[1].guid)
  H.eq(calls_named(s, 'Main_OnCommand'), 0)
end)
