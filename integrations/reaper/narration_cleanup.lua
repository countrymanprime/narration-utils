-- Cleanup launchers over the bridge: launch_cleanup_tool (docs/prds/reaper-automation-follow-through.prd.md Phase 23,
-- ADR 0146). Opens REAPER's own Repair Pops/Clicks dialog, or the narrator's own installed Magnolius DeClick script,
-- on the items the narrator has selected. The dialog does the work and the narrator drives it; this file changes
-- nothing itself.
--
-- SAFETY (load-bearing):
-- - Only a tool named in TOOLS can be launched. The host sends a tool key, never an action ID or name, so the bridge
--   cannot be used to run an arbitrary REAPER action (a render, an FX apply, a script).
-- - A tool's action is found by its action-list name (kbd_enumerateActions over the Main section), not by a numeric
--   ID baked in here: native IDs are not published and a script's ID depends on where it was installed. No match
--   launches nothing, and more than one match launches nothing rather than guess.
-- - The one call that does anything is Main_OnCommand(id, 0) on the matched action. No undo block, no item, marker,
--   cursor or project-info change: whatever the dialog then does is the narrator's own undoable edit.
-- - Third-party tools are never installed, bundled or downloaded (Magnolius is GPL-3.0): "not installed" is a
--   message, not an install.

local core = ...
local event = core.event

-- Safety cap on the action-list walk: REAPER's Main section holds a few thousand actions plus the narrator's
-- scripts, so a list this long means kbd_enumerateActions is not answering the way the docs describe.
local MAX_ACTIONS = 200000

local function lower(value)
  return (value or ''):lower()
end

-- "Item: Repair pops/clicks..." -> "repair pops/clicks...". The category word is REAPER's own; a script's
-- ("Script:") or a custom action's ("Custom:") name is the narrator's text, so it never counts as a native tool.
local function native_text(name)
  local category, rest = lower(name):match('^([^:]+):%s*(.*)$')
  if not category then
    return lower(name)
  end
  if category == 'script' or category == 'custom' then
    return nil
  end
  return rest
end

local TOOLS = {
  repair_pops_clicks = {
    label = 'Repair Pops/Clicks',
    -- REAPER 7.80's "Edit > Repair Pops/Clicks" dialog. The exact action-list text is not yet read from a real
    -- REAPER (pending, docs/research/reaper-cleanup-launchers.md), so any category prefix and a trailing "..." match.
    matches = function(name)
      local text = native_text(name)
      return text == 'repair pops/clicks...' or text == 'repair pops/clicks'
    end,
    missing = 'This REAPER has no Repair Pops/Clicks dialog. It needs REAPER 7.80 or later.',
  },
  magnolius_declick = {
    label = 'Magnolius DeClick',
    -- REAPER names a loaded ReaScript "Script: <file name>", whether ReaPack or the narrator loaded it.
    matches = function(name)
      return lower(name) == 'script: magnolius_declick.lua'
    end,
    missing = 'Magnolius DeClick is not installed in REAPER. Install it yourself (ReaPack, or Actions > Load ReaScript); Narration Utils never installs it.',
  },
}

-- The command IDs and names of every Main-section action the tool matches.
local function find_actions(tool)
  local section = reaper.SectionFromUniqueID(0)
  local found = {}
  for index = 0, MAX_ACTIONS do
    local id, name = reaper.kbd_enumerateActions(section, index)
    if not id or id == 0 then
      break
    end
    if tool.matches(name) then
      found[#found + 1] = { id = id, name = name }
    end
  end
  return found
end

local function launch_cleanup_tool(session_dir, run_id, key, host_run, level)
  core.debug_log(session_dir, host_run, level, 'launch_cleanup_tool.received', { { 'tool_key', key } })
  local tool = TOOLS[key]
  if not tool then
    core.debug_log(session_dir, host_run, level, 'launch_cleanup_tool.refused', { { 'reason', 'unknown_tool' } })
    event(session_dir, 'ERROR', run_id, 'Unknown cleanup tool.')
    return
  end
  if not reaper.APIExists('kbd_enumerateActions') or not reaper.APIExists('SectionFromUniqueID') then
    core.debug_log(session_dir, host_run, level, 'launch_cleanup_tool.refused', { { 'reason', 'actions_unavailable' } })
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot look up its actions by name.')
    return
  end
  if reaper.CountSelectedMediaItems(0) == 0 then
    core.debug_log(session_dir, host_run, level, 'launch_cleanup_tool.refused', { { 'reason', 'no_selection' } })
    event(session_dir, 'ERROR', run_id, 'Select the items to repair in REAPER first.')
    return
  end
  local found = find_actions(tool)
  if #found == 0 then
    core.debug_log(session_dir, host_run, level, 'launch_cleanup_tool.refused', { { 'reason', 'tool_missing' } })
    event(session_dir, 'ERROR', run_id, tool.missing)
    return
  end
  if #found > 1 then
    core.debug_log(session_dir, host_run, level, 'launch_cleanup_tool.refused', { { 'reason', 'ambiguous_action' }, { 'matches', tostring(#found) } })
    event(session_dir, 'ERROR', run_id, 'More than one REAPER action is named like ' .. tool.label .. ', so none was opened.')
    return
  end
  reaper.Main_OnCommand(found[1].id, 0)
  core.debug_log(session_dir, host_run, level, 'launch_cleanup_tool.launched', { { 'tool_key', key } })
  event(session_dir, 'CLEANUP_LAUNCHED', run_id, key, found[1].name)
end

return function(registry)
  registry.register('launch_cleanup_tool', function(ctx, args)
    launch_cleanup_tool(ctx.session_dir, args[1] or '', args[2] or '', args[3] or '', args[4] or '')
  end)
end
