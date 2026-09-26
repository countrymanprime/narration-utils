-- Cleanup launchers: launch_cleanup_tool (see narration_cleanup.lua and docs/prds/reaper-automation-follow-through.prd.md
-- Phase 23). The command opens REAPER's own repair dialog (or an installed third-party script) on the selected items
-- and changes nothing itself. The load-bearing tests: only an allow-listed tool can be launched, the action is found
-- by its action-list name (never by an ID the host sends), a missing or ambiguous action launches nothing, and a
-- launch makes exactly one Main_OnCommand call and no edit, undo point or project-info write of its own.

local H = require('harness')

local REPAIR_ID = 43500 -- An arbitrary ID: the lookup must go by name, so the tests never depend on the real one.
local REPAIR_NAME = 'Item: Repair pops/clicks...'
local MAGNOLIUS_ID = 55001
local MAGNOLIUS_NAME = 'Script: Magnolius_DeClick.lua'

local function new_session()
  local s = H.session({ project_path = H.join(host.tmpdir(), 'Book.rpp') })
  local track = s.fake:add_track('Narration')
  s.item = s.fake:add_item(track, { source = 'chapter01.wav', position = 0, length = 30, selected = true })
  return s
end

local function calls_named(s, name)
  local out = {}
  for _, call in ipairs(s.fake.calls) do
    if call.name == name then
      out[#out + 1] = call
    end
  end
  return out
end

-- Everything a launch could change in the fake project: a launcher that edits anything itself fails this.
local function project_snapshot(s)
  local items = {}
  for _, item in ipairs(s.fake:ordered_items()) do
    items[#items + 1] = { item.position, item.length, item.selected, item.notes, #item.takes }
  end
  return { items = items, markers = #s.fake.markers, undo = #s.fake.undo, cursor = s.fake.cursor, arrange = s.fake.arrange_updates }
end

H.test('launch_cleanup_tool opens Repair Pops/Clicks, found by its action-list name, on the selected items', function()
  local s = new_session()
  s.fake:add_action(REPAIR_ID, REPAIR_NAME)
  s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks')
  H.eq(s:events(), { { 'CLEANUP_LAUNCHED', 't1', 'repair_pops_clicks', REPAIR_NAME } })
  local launched = calls_named(s, 'Main_OnCommand')
  H.eq(#launched, 1)
  H.eq({ launched[1].command_id, launched[1].flag }, { REPAIR_ID, 0 })
end)

H.test('launch_cleanup_tool matches the Repair Pops/Clicks name whatever its category prefix or capitalisation', function()
  for _, name in ipairs({ 'Repair Pops/Clicks...', 'Edit: Repair Pops/Clicks...', 'Item edit: repair pops/clicks' }) do
    local s = new_session()
    s.fake:add_action(REPAIR_ID, name)
    s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks')
    H.eq(s:events(), { { 'CLEANUP_LAUNCHED', 't1', 'repair_pops_clicks', name } }, name)
  end
end)

H.test('launch_cleanup_tool does not take a neighbouring pop/click action for the repair dialog', function()
  local s = new_session()
  s.fake:add_action(43501, 'Take: Go to next detected audio pop/click for first selected item')
  s.fake:add_action(43502, 'Adjust pop/click detection settings...')
  s.fake:add_action(43503, 'Script: Repair pops/clicks helper.lua')
  s.fake:add_action(43504, 'Script: Repair pops/clicks...')
  s.fake:add_action(43505, 'Custom: Repair pops/clicks...')
  s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks')
  H.eq(s:events(), { { 'ERROR', 't1', 'This REAPER has no Repair Pops/Clicks dialog. It needs REAPER 7.80 or later.' } })
  H.eq(#calls_named(s, 'Main_OnCommand'), 0)
end)

H.test('launch_cleanup_tool refuses when two actions carry the name, rather than guess', function()
  local s = new_session()
  s.fake:add_action(REPAIR_ID, REPAIR_NAME)
  s.fake:add_action(REPAIR_ID + 1, 'Edit: Repair pops/clicks...')
  s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks')
  H.eq(s:events(), { { 'ERROR', 't1', 'More than one REAPER action is named like Repair Pops/Clicks, so none was opened.' } })
  H.eq(#calls_named(s, 'Main_OnCommand'), 0)
end)

H.test('launch_cleanup_tool opens Magnolius DeClick when the narrator has installed it', function()
  local s = new_session()
  s.fake:add_action(MAGNOLIUS_ID, MAGNOLIUS_NAME)
  s:send('launch_cleanup_tool', 't1', 'magnolius_declick')
  H.eq(s:events(), { { 'CLEANUP_LAUNCHED', 't1', 'magnolius_declick', MAGNOLIUS_NAME } })
  H.eq(calls_named(s, 'Main_OnCommand')[1].command_id, MAGNOLIUS_ID)
end)

H.test('launch_cleanup_tool says Magnolius DeClick is not installed, and never installs or runs anything else', function()
  local s = new_session()
  s.fake:add_action(REPAIR_ID, REPAIR_NAME)
  s.fake:add_action(MAGNOLIUS_ID + 1, 'Script: Magnolius_DeNoise.lua')
  s:send('launch_cleanup_tool', 't1', 'magnolius_declick')
  H.eq(s:events(), {
    {
      'ERROR',
      't1',
      'Magnolius DeClick is not installed in REAPER. Install it yourself (ReaPack, or Actions > Load ReaScript); Narration Utils never installs it.',
    },
  })
  H.eq(#calls_named(s, 'Main_OnCommand'), 0)
end)

H.test('launch_cleanup_tool refuses a tool that is not on the allow-list, including a raw action ID', function()
  for _, tool in ipairs({ '40209', '42230', '_RS1234', 'Item: Apply track/take FX to items', '', 'REPAIR_POPS_CLICKS' }) do
    local s = new_session()
    s.fake:add_action(REPAIR_ID, REPAIR_NAME)
    s:send('launch_cleanup_tool', 't1', tool)
    H.eq(s:events(), { { 'ERROR', 't1', 'Unknown cleanup tool.' } }, tool)
    H.eq(#calls_named(s, 'Main_OnCommand'), 0, tool)
    H.eq(#calls_named(s, 'kbd_enumerateActions'), 0, 'an unknown tool is refused before the action list is read')
  end
end)

H.test('launch_cleanup_tool needs at least one selected item, and says so', function()
  local s = new_session()
  s.item.selected = false
  s.fake:add_action(REPAIR_ID, REPAIR_NAME)
  s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks')
  H.eq(s:events(), { { 'ERROR', 't1', 'Select the items to repair in REAPER first.' } })
  H.eq(#calls_named(s, 'Main_OnCommand'), 0)
end)

H.test('launch_cleanup_tool needs the action-list API', function()
  local s = new_session()
  s.fake:add_action(REPAIR_ID, REPAIR_NAME)
  s.fake:remove_api('kbd_enumerateActions')
  s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks')
  H.eq(s:events(), { { 'ERROR', 't1', 'This REAPER version cannot look up its actions by name.' } })
  H.eq(#calls_named(s, 'Main_OnCommand'), 0)
end)

H.test('launch_cleanup_tool changes nothing in the project itself: no edit, undo point, cursor move or setting', function()
  local s = new_session()
  s.fake:add_region(0, 30, 'Chapter 1')
  s.fake:add_action(REPAIR_ID, REPAIR_NAME)
  local before = project_snapshot(s)
  s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks')
  H.eq(project_snapshot(s), before)
  H.eq(s.fake.open_undo_blocks, 0)
  H.eq(#calls_named(s, 'GetSetProjectInfo') + #calls_named(s, 'GetSetProjectInfo_String'), 0)
end)

H.test('launch_cleanup_tool writes a debug bridge.jsonl record for the received command and its outcome', function()
  local s = new_session()
  s.fake:add_action(REPAIR_ID, REPAIR_NAME)
  s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks', 'host-run-1', 'debug')
  local lines = H.lines(H.read_text(s:path('bridge.jsonl')) or '')
  H.eq(#lines, 2)
  H.contains(lines[1], '"event":"launch_cleanup_tool.received"')
  H.contains(lines[1], '"run":"host-run-1"')
  H.contains(lines[1], '"tool_key":"repair_pops_clicks"')
  H.contains(lines[2], '"event":"launch_cleanup_tool.launched"')
end)

H.test('launch_cleanup_tool writes no bridge.jsonl record when the host did not ask for debug', function()
  local s = new_session()
  s.fake:add_action(REPAIR_ID, REPAIR_NAME)
  s:send('launch_cleanup_tool', 't1', 'repair_pops_clicks', 'host-run-1', 'info')
  H.eq(H.read_text(s:path('bridge.jsonl')), nil)
end)

H.test('launch_cleanup_tool records a refusal reason at debug level, never the tool label as project text', function()
  local s = new_session()
  s:send('launch_cleanup_tool', 't1', 'not_a_real_tool', 'host-run-1', 'debug')
  local lines = H.lines(H.read_text(s:path('bridge.jsonl')) or '')
  H.eq(#lines, 2)
  H.contains(lines[2], '"event":"launch_cleanup_tool.refused"')
  H.contains(lines[2], '"reason":"unknown_tool"')
end)
