-- Selecting a chapter's track in REAPER (chapter-track-link-control PRD Phase 4, Could): "Select in REAPER" in the
-- chapter track slide-over, so a narrator who wants to look at the track themselves does not have to hunt for it.
-- Loaded by narration_ui_bridge.lua, which passes the shared helpers as the chunk argument.
--
-- It deselects every other track and selects the named one (SetOnlyTrackSelected), the same "one track at a time"
-- shape the track picker already assumes (one confirmed track per chapter). It opens no undo block: a selection
-- change is not project data, the same choice arm_only makes for record arms. A track is named by its GUID; a GUID
-- that does not resolve is reported as TRACK_STALE and no other track is ever selected in its place.
--
-- Events: TRACK_SELECTED|run|guid, or TRACK_STALE|run|guid.

local core = ...
local event = core.event

local function normalize_guid(guid)
  local bare = tostring(guid or ''):gsub('[{}%s]', ''):upper()
  if bare == '' then
    return ''
  end
  return '{' .. bare .. '}'
end

local function find_track(guid)
  for index = 0, reaper.CountTracks(0) - 1 do
    local track = reaper.GetTrack(0, index)
    if normalize_guid(reaper.GetTrackGUID(track)) == guid then
      return track
    end
  end
  return nil
end

local function select_track(session_dir, run_id, guid_text)
  local wanted = normalize_guid(guid_text)
  local track = find_track(wanted)
  if not track then
    event(session_dir, 'TRACK_STALE', run_id, guid_text)
    return
  end
  reaper.SetOnlyTrackSelected(track)
  event(session_dir, 'TRACK_SELECTED', run_id, wanted)
end

return function(registry)
  registry.register('select_track', function(ctx, args)
    select_track(ctx.session_dir, args[1] or '', args[2] or '')
  end)
end
