-- Per-chapter render configuration over the bridge: configure_chapter_render (see
-- docs/research/reaper-spike-s5-render-details.md, Phase 10, and docs/prds/reaper-automation-follow-through.prd.md
-- Phase 11 / Open Question 7, answered (a): configure only, the narrator presses Render themselves.
--
-- Sets the render bounds to all regions (RENDER_BOUNDSFLAG=3), the naming pattern to the region name ($region) and
-- the output folder, then reads RENDER_TARGETS back so the narrator can see the resulting file names before
-- rendering. RENDER_FORMAT is never touched: the narrator's last-used sink format stands (Architecture Notes,
-- "Render").
--
-- SAFETY (load-bearing): this file must never call reaper.Main_OnCommand, and must never read the RENDER_STATS or
-- RENDER_STATS_SUMMARY project-info keys. The S5 spike found that passing a real, file-writing render action's ID
-- to the RENDER_STATS getter does not just read stats - it re-invokes that render, producing a real "Files already
-- exist" dialog (docs/research/reaper-spike-s5-render-details.md, "Findings in detail" 4). Every write here is one
-- of the three keys the spike proved safe to set (RENDER_FILE, RENDER_PATTERN, RENDER_BOUNDSFLAG) plus a read of
-- RENDER_TARGETS, which the spike proved is itself just a predicted-file-names getter, not a render trigger.

local core = ...
local event = core.event

local RENDER_BOUNDS_ALL_REGIONS = 3 -- RENDER_BOUNDSFLAG value for "all regions" (S5 spike, confirmed in REAPER 7.80).
local REGION_PATTERN = '$region' -- RENDER_PATTERN value that names each rendered file after its region (S5 spike, confirmed).

-- RENDER_TARGETS comes back as a semicolon-joined list of full paths, one per predicted output file.
local function split_targets(value)
  local names = {}
  for part in (value or ''):gmatch('([^;]+)') do
    names[#names + 1] = part
  end
  return names
end

-- Sets bounds = all regions, pattern = $region, output = the chosen folder, then reads back RENDER_TARGETS (the
-- predicted per-region output file names - the S5 spike found these match the real render exactly) so the
-- narrator can confirm what will be created before pressing Render. Configuration only: no undo block is opened
-- (render settings are project state, not undoable the way item and marker edits are, and nothing here mutates
-- items, markers or regions), and no render is triggered.
local function configure_chapter_render(session_dir, run_id, output_folder)
  if not reaper.APIExists('GetSetProjectInfo_String') or not reaper.APIExists('GetSetProjectInfo') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot configure render settings.')
    return
  end
  if output_folder == '' then
    event(session_dir, 'ERROR', run_id, 'An output folder is required.')
    return
  end
  if reaper.APIExists('RecursiveCreateDirectory') then
    reaper.RecursiveCreateDirectory(output_folder, 0)
  end
  reaper.GetSetProjectInfo_String(0, 'RENDER_FILE', output_folder, true)
  reaper.GetSetProjectInfo_String(0, 'RENDER_PATTERN', REGION_PATTERN, true)
  reaper.GetSetProjectInfo(0, 'RENDER_BOUNDSFLAG', RENDER_BOUNDS_ALL_REGIONS, true)
  local _, targets = reaper.GetSetProjectInfo_String(0, 'RENDER_TARGETS', '', false)
  local names = split_targets(targets)
  event(session_dir, 'RENDER_CONFIGURED', run_id, output_folder, #names, targets)
end

return function(registry)
  registry.register('configure_chapter_render', function(ctx, args)
    configure_chapter_render(ctx.session_dir, args[1] or '', args[2] or '')
  end)
end
