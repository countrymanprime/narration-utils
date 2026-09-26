-- Retakes on fixed lanes over the bridge: pick_retake_lane (docs/prds/reaper-automation-follow-through.prd.md
-- Phase 25, ADR 0147, spike S7 docs/research/reaper-spike-s7-fixed-lanes.md). The narrator picks one retake of a
-- line, recorded on a fixed item lane, and that lane becomes the only one playing on its track.
--
-- SAFETY (load-bearing):
-- - The one value this file changes is the retake's track C_LANEPLAYS:<lane>, set to 1 (plays exclusively), in one
--   undo block, so one Undo in REAPER restores the previous play state (S7: one undo step, redo exact).
-- - It never changes a track's lane mode or layout (I_FREEMODE, I_NUMFIXEDLANES), never moves an item between lanes
--   (I_FIXEDLANE), never sets the item-level C_LANEPLAYS (documented read-only), never runs the convert, explode,
--   implode or comp actions, and never touches an item, take or the active take. A track that is not in fixed-lane
--   mode is refused, not converted: S7 found every conversion changes what plays.
-- - A retake is named by line id plus item GUID: on a lane track every retake of a line carries the same line id. The
--   item is found by GUID and must still carry the line id; the lane is the one REAPER has now, never one the host
--   sends.

local core = ...
local event = core.event

local LINE_ID_KEY = 'P_EXT:narration_utils_line_id'
-- REAPER's I_FREEMODE for fixed item lanes (1 is free item positioning).
local FIXED_LANE_MODE = 2
-- Track C_LANEPLAYS value that makes a lane the only one playing (0 silent, 2 plays with others).
local PLAYS_EXCLUSIVELY = 1
local REQUIRED_API = { 'GetMediaTrackInfo_Value', 'SetMediaTrackInfo_Value', 'GetMediaItemInfo_Value' }
local STALE = ' Save the project in REAPER and open the list again.'

local function normalize_guid(guid)
  local bare = tostring(guid or ''):gsub('[{}%s]', ''):upper()
  if bare == '' then
    return ''
  end
  return '{' .. bare .. '}'
end

local function find_item(guid)
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    local _, item_guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
    if normalize_guid(item_guid) == guid then
      return item
    end
  end
  return nil
end

local function has_lane_api()
  for _, name in ipairs(REQUIRED_API) do
    if not reaper.APIExists(name) then
      return false
    end
  end
  return true
end

-- The retake's item, still carrying the line, on a track in fixed-lane mode; or nil and the reason.
local function resolve_retake(line_id, guid)
  local item = find_item(guid)
  if not item then
    return nil, nil, 'That retake is no longer in the REAPER project.' .. STALE
  end
  local _, stamped = reaper.GetSetMediaItemInfo_String(item, LINE_ID_KEY, '', false)
  if stamped ~= line_id then
    return nil, nil, 'That retake no longer belongs to this line.' .. STALE
  end
  local track = reaper.GetMediaItem_Track(item)
  if reaper.GetMediaTrackInfo_Value(track, 'I_FREEMODE') ~= FIXED_LANE_MODE then
    local _, name = reaper.GetTrackName(track)
    return nil,
      nil,
      string.format(
        'The track "%s" is not in fixed item lane mode, so it has no lanes to choose from. Narration Utils never turns lanes on or converts takes to lanes: do that in REAPER if you want to.',
        name
      )
  end
  return item, track, nil
end

local function pick_retake_lane(session_dir, run_id, line_id, raw_guid, host_run, level)
  core.debug_log(session_dir, host_run, level, 'pick_retake_lane.received', { { 'line_id', line_id } })
  if not has_lane_api() then
    core.debug_log(session_dir, host_run, level, 'pick_retake_lane.refused', { { 'reason', 'lanes_unavailable' } })
    event(session_dir, 'ERROR', run_id, 'This REAPER version has no fixed item lanes. They need REAPER 7 or later.')
    return
  end
  local guid = normalize_guid(raw_guid)
  if line_id == '' or guid == '' then
    core.debug_log(session_dir, host_run, level, 'pick_retake_lane.refused', { { 'reason', 'missing_choice' } })
    event(session_dir, 'ERROR', run_id, 'Choose a retake to play.')
    return
  end
  local item, track, problem = resolve_retake(line_id, guid)
  if not item then
    core.debug_log(session_dir, host_run, level, 'pick_retake_lane.refused', { { 'reason', 'retake_not_found' } })
    event(session_dir, 'ERROR', run_id, problem)
    return
  end
  local lane = math.floor(reaper.GetMediaItemInfo_Value(item, 'I_FIXEDLANE') + 0.5)

  reaper.Undo_BeginBlock2(0)
  reaper.SetMediaTrackInfo_Value(track, 'C_LANEPLAYS:' .. lane, PLAYS_EXCLUSIVELY)
  reaper.Undo_EndBlock2(0, 'Narration Utils: play retake lane ' .. (lane + 1), -1)
  if reaper.APIExists('UpdateTimeline') then
    reaper.UpdateTimeline()
  end
  core.debug_log(session_dir, host_run, level, 'pick_retake_lane.picked', { { 'lane', tostring(lane) } })
  event(session_dir, 'RETAKE_LANE_PICKED', run_id, line_id, guid, tostring(lane))
end

return function(registry)
  registry.register('pick_retake_lane', function(ctx, args)
    pick_retake_lane(ctx.session_dir, args[1] or '', args[2] or '', args[3] or '', args[4] or '', args[5] or '')
  end)
end
