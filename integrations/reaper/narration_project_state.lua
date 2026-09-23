-- Reports REAPER's live project-change indicator over the bridge: project_state (see
-- docs/prds/reaper-automation-follow-through.prd.md Phase 13, "Change-driven re-compare indicator", and
-- docs/prds/analysis-evidence-ledger.prd.md Open Question 12, answered (B) - a Could-tier hint, read only while
-- REAPER is running, that something changed since a baseline was captured. It is deliberately coarse: any edit
-- (an item move, a marker, a render setting) increments REAPER's own counter, so this never labels *what*
-- changed, only *that* something did; nothing here starts an analysis or a re-compare on its own.
--
-- Returns GetProjectStateChangeCount(0) and the path REAPER thinks the current project's .rpp lives at (the same
-- EnumProjects(-1, '') call narration_compare.lua's prepare_compare already makes). The host stats that path
-- itself for the saved file's modification time: Lua has no portable file-stat call, and the host already reads
-- paths like this one elsewhere (apps/desktop/internal/projectstate).

local core = ...
local event = core.event

local function project_state(session_dir, run_id)
  if not reaper.APIExists('GetProjectStateChangeCount') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot report the project change count.')
    return
  end
  local count = reaper.GetProjectStateChangeCount(0)
  local _, rpp = reaper.EnumProjects(-1, '')
  event(session_dir, 'PROJECT_STATE', run_id, count, rpp or '')
end

return function(registry)
  registry.register('project_state', function(ctx, args)
    project_state(ctx.session_dir, args[1] or '')
  end)
end
