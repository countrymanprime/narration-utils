-- Going to and looping a finding over the bridge: navigate_item, loop_context, stop_loop and ping (review-dashboard
-- PRD Phase 6 and its Q6 answer; docs/architecture/reaper-navigation.md, ADR 0121). Loaded by narration_ui_bridge.lua,
-- which passes the shared helpers as the chunk argument.
--
-- A finding is found by its item GUID (and take GUID when it has one), and its time is a source time inside that
-- take, so it follows the item when the narrator moves it. A GUID that no longer resolves, a take that is no longer on
-- the item and a spot the item no longer covers are all reported as FINDING_STALE: nothing here ever falls back to a
-- neighbouring item or to the project time the finding had when it was made.
--
-- These commands change selection and transport state only (item selection, edit cursor, time selection, loop points,
-- repeat, play), never the project's content, so they make no undo point: an undo point per click would put "go to
-- finding" between the narrator and their last real edit. A loop is undone by stop_loop instead, which puts back the
-- time selection, loop points and repeat the narrator had before the first loop_context.

local core = ...
local event = core.event

-- Answered by ping, so the host can tell a script that knows these commands from an older one (which answers
-- "Unsupported workspace command").
local NAVIGATION_VERSION = '1'
-- How far outside an item's bounds a spot may fall and still count as inside it (float rounding of position maths).
local EDGE_TOLERANCE = 0.000001

local function normalize_guid(guid)
  local bare = tostring(guid or ''):gsub('[{}%s]', ''):upper()
  if bare == '' then
    return ''
  end
  return '{' .. bare .. '}'
end
local function item_guid(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
  return normalize_guid(guid)
end
local function take_guid(take)
  local _, guid = reaper.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
  return normalize_guid(guid)
end
local function find_item(guid)
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    if item_guid(item) == guid then
      return item
    end
  end
  return nil
end
local function find_take(item, guid)
  for index = 0, reaper.CountTakes(item) - 1 do
    local take = reaper.GetTake(item, index)
    if take and take_guid(take) == guid then
      return take
    end
  end
  return nil
end

-- Resolves a finding's identity. Answers the item and the take (the named one, or the active one when no take GUID
-- was given), or nil plus the GUID that did not resolve and why ('item' or 'take').
local function resolve(item_text, take_text)
  local wanted_item = normalize_guid(item_text)
  local item = wanted_item ~= '' and find_item(wanted_item) or nil
  if not item then
    return nil, nil, item_text, 'item'
  end
  local wanted_take = normalize_guid(take_text)
  if wanted_take == '' then
    return item, reaper.GetActiveTake(item)
  end
  local take = find_take(item, wanted_take)
  if not take then
    return nil, nil, take_text, 'take'
  end
  return item, take
end

-- The item's current bounds in project seconds.
local function bounds(item)
  local first = reaper.GetMediaItemInfo_Value(item, 'D_POSITION')
  return first, first + reaper.GetMediaItemInfo_Value(item, 'D_LENGTH')
end

-- Where a source time of the take is on the timeline now: the same mapping inspect_results uses when it reports a row.
local function project_time(item, take, source_time)
  local offset = reaper.GetMediaItemTakeInfo_Value(take, 'D_STARTOFFS')
  local rate = reaper.GetMediaItemTakeInfo_Value(take, 'D_PLAYRATE')
  if rate == 0 then
    rate = 1
  end
  return reaper.GetMediaItemInfo_Value(item, 'D_POSITION') + (source_time - offset) / rate
end

-- A field that must be a number when it is given; `required` says whether it may be empty.
local function number_field(text, required)
  if text == '' and not required then
    return true, nil
  end
  local value = tonumber(text)
  return value ~= nil, value
end

-- GetPlayState is a bit field (1 playing, 2 paused, 4 recording), read with arithmetic so the file stays free of the
-- bitwise operators older Lua lacks.
local function recording()
  return math.floor(reaper.GetPlayState() / 4) % 2 == 1
end
local function playing()
  return reaper.GetPlayState() % 2 == 1
end

-- Leaves only `item` selected, item by item with SetMediaItemSelected. The first scripted REAPER 7.80 run of the Phase 6
-- check saw an "Unselect all items" undo point after a navigation that used SelectAllMediaItems (a later run did not);
-- SetMediaItemSelected left none, and going somewhere is not an edit.
local function select_only(item)
  for index = reaper.CountSelectedMediaItems(0) - 1, 0, -1 do
    local selected = reaper.GetSelectedMediaItem(0, index)
    if selected ~= item then
      reaper.SetMediaItemSelected(selected, false)
    end
  end
  reaper.SetMediaItemSelected(item, true)
end

local function navigate_item(session_dir, run_id, item_text, take_text, time_text)
  local ok, source_time = number_field(time_text, false)
  if not ok then
    event(session_dir, 'ERROR', run_id, 'The finding has no usable time.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local item, take, stale_guid, reason = resolve(item_text, take_text)
  if not item then
    event(session_dir, 'FINDING_STALE', run_id, stale_guid, reason)
    return
  end
  local first, last = bounds(item)
  local target = first
  if source_time then
    if not take then
      event(session_dir, 'FINDING_STALE', run_id, item_text, 'take')
      return
    end
    target = project_time(item, take, source_time)
    if target < first - EDGE_TOLERANCE or target > last + EDGE_TOLERANCE then
      event(session_dir, 'FINDING_STALE', run_id, item_text, 'range')
      return
    end
  end
  select_only(item)
  reaper.SetEditCurPos(target, true, false)
  reaper.UpdateArrange()
  event(session_dir, 'NAVIGATED', run_id, item_guid(item), string.format('%.6f', target))
end

-- What the narrator had before the first loop_context: the time selection, the loop points and repeat. Kept until
-- stop_loop (or the script ending) puts it back; a second loop_context re-targets the loop but keeps this.
local function capture()
  local ts_start, ts_end = reaper.GetSet_LoopTimeRange2(0, false, false, 0, 0, false)
  local loop_start, loop_end = reaper.GetSet_LoopTimeRange2(0, false, true, 0, 0, false)
  return { time_selection = { ts_start, ts_end }, loop_points = { loop_start, loop_end }, repeat_on = reaper.GetSetRepeat(-1) }
end

local function same_range(range, first, last)
  return math.abs(range[1] - first) <= EDGE_TOLERANCE and math.abs(range[2] - last) <= EDGE_TOLERANCE
end

-- Puts back what capture() saw, but only what is still what the loop set: a time selection, loop range or repeat the
-- narrator changed while the loop played is theirs now and is kept. Answers how many were restored and kept. REAPER
-- links the loop points to the time selection by default (seen in REAPER 7.80), so putting the time selection back can
-- already have put the loop points back: a range that is already what the narrator had counts as restored.
local function restore(loop)
  local restored, kept = 0, 0
  local function put_back(is_loop, saved)
    local first, last = reaper.GetSet_LoopTimeRange2(0, false, is_loop, 0, 0, false)
    if same_range(saved, first, last) then
      restored = restored + 1
    elseif same_range({ first, last }, loop.window[1], loop.window[2]) then
      reaper.GetSet_LoopTimeRange2(0, true, is_loop, saved[1], saved[2], false)
      restored = restored + 1
    else
      kept = kept + 1
    end
  end
  put_back(false, loop.saved.time_selection)
  put_back(true, loop.saved.loop_points)
  if reaper.GetSetRepeat(-1) == 1 then
    reaper.GetSetRepeat(loop.saved.repeat_on)
    restored = restored + 1
  else
    kept = kept + 1
  end
  reaper.UpdateArrange()
  return restored, kept
end

local function loop_context(session_dir, state, run_id, item_text, take_text, start_text, end_text)
  if not reaper.APIExists('GetSet_LoopTimeRange2') or not reaper.APIExists('GetSetRepeat') or not reaper.APIExists('OnPlayButton') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot loop a finding.')
    return
  end
  local ok_start, source_start = number_field(start_text, true)
  local ok_end, source_end = number_field(end_text, true)
  if not ok_start or not ok_end or source_end < source_start then
    event(session_dir, 'ERROR', run_id, 'The finding has no usable time.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local item, take, stale_guid, reason = resolve(item_text, take_text)
  if not item then
    event(session_dir, 'FINDING_STALE', run_id, stale_guid, reason)
    return
  end
  if not take then
    event(session_dir, 'FINDING_STALE', run_id, item_text, 'take')
    return
  end
  local first, last = bounds(item)
  local window_start = math.max(project_time(item, take, source_start), first)
  local window_end = math.min(project_time(item, take, source_end), last)
  if window_end <= window_start then
    event(session_dir, 'FINDING_STALE', run_id, item_text, 'range')
    return
  end
  if not state.loop then
    state.loop = { saved = capture() }
    -- The narrator can end the launcher script (or quit REAPER) with a loop still running: put their state back then.
    if not state.exit_registered and reaper.atexit then
      state.exit_registered = true
      reaper.atexit(function()
        if state.loop then
          restore(state.loop)
          state.loop = nil
        end
      end)
    end
  end
  if playing() then
    reaper.OnStopButton()
  end
  state.loop.window = { window_start, window_end }
  reaper.GetSet_LoopTimeRange2(0, true, false, window_start, window_end, false)
  reaper.GetSet_LoopTimeRange2(0, true, true, window_start, window_end, false)
  reaper.GetSetRepeat(1)
  reaper.SetEditCurPos(window_start, true, false)
  reaper.OnPlayButton()
  reaper.UpdateArrange()
  event(session_dir, 'LOOP_STARTED', run_id, item_guid(item), string.format('%.6f', window_start), string.format('%.6f', window_end))
end

local function stop_loop(session_dir, state, run_id)
  local loop = state.loop
  if not loop then
    -- Nothing this bridge started is running (never looped, already stopped, or the script restarted since).
    event(session_dir, 'LOOP_STOPPED', run_id, 0, 0)
    return
  end
  state.loop = nil
  if playing() and not recording() then
    reaper.OnStopButton()
  end
  local restored, kept = restore(loop)
  event(session_dir, 'LOOP_STOPPED', run_id, restored, kept)
end

local function ping(session_dir, state, run_id)
  event(session_dir, 'PONG', run_id, NAVIGATION_VERSION, state.loop and 1 or 0, playing() and 1 or 0)
end

return function(registry)
  local state = {}
  registry.register('navigate_item', function(ctx, args)
    navigate_item(ctx.session_dir, args[1] or '', args[2] or '', args[3] or '', args[4] or '')
  end)
  registry.register('loop_context', function(ctx, args)
    loop_context(ctx.session_dir, state, args[1] or '', args[2] or '', args[3] or '', args[4] or '', args[5] or '')
  end)
  registry.register('stop_loop', function(ctx, args)
    stop_loop(ctx.session_dir, state, args[1] or '')
  end)
  registry.register('ping', function(ctx, args)
    ping(ctx.session_dir, state, args[1] or '')
  end)
end
