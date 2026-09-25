-- Punch and roll over the bridge (teleprompter-manuscript-integration PRD Phase 12, ADR 0246). Loaded by
-- narration_ui_bridge.lua, which passes the shared helpers as the chunk argument.
--
-- play_position is read-only: the host polls it during a live reading to anchor the word it hears in project time.
-- It answers the play state and both play positions, GetPlayPosition (what the narrator hears) and GetPlayPosition2
-- (what REAPER is processing now), because which one anchors a word is spike S4's question; and the edit cursor.
-- Each call is one bridge round trip (about 50-100 ms), so the host bounds its poll rate.
--
-- punch_to moves the edit cursor to a word's time minus the pre-roll, never before the project start, and scrolls the
-- view to it. It changes nothing else: no undo block (a cursor move is not project data, as with
-- jump_to_compare_marker), playback is never started or moved, and it refuses while REAPER records.
--
-- Answers PLAY_POSITION|run|state|position|position2|cursor and PUNCHED|run|cursor.

local core = ...
local event = core.event

local MAX_PREROLL = 10

local function seconds(value)
  return string.format('%.6f', value)
end

local function play_position(session_dir, run_id)
  if not reaper.APIExists('GetPlayPosition2') then
    event(session_dir, 'ERROR', run_id, 'This REAPER version cannot report the play position.')
    return
  end
  event(
    session_dir,
    'PLAY_POSITION',
    run_id,
    tostring(reaper.GetPlayState()),
    seconds(reaper.GetPlayPosition()),
    seconds(reaper.GetPlayPosition2()),
    seconds(reaper.GetCursorPosition())
  )
end

-- A finite, non-negative number of seconds, or nil.
local function number(text)
  local value = tonumber(text or '')
  if not value or value ~= value or value == math.huge or value < 0 then
    return nil
  end
  return value
end

local function punch_to(session_dir, run_id, time_text, preroll_text)
  local time, preroll = number(time_text), number(preroll_text)
  if not time or not preroll or preroll > MAX_PREROLL then
    event(session_dir, 'ERROR', run_id, 'The word time or pre-roll is not a usable number of seconds.')
    return
  end
  if reaper.GetPlayState() & 4 == 4 then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop it before moving to a word.')
    return
  end
  local target = math.max(0, time - preroll)
  reaper.SetEditCurPos(target, true, false)
  event(session_dir, 'PUNCHED', run_id, seconds(target))
end

return function(registry)
  registry.register('play_position', function(ctx, args)
    play_position(ctx.session_dir, args[1] or '')
  end)
  registry.register('punch_to', function(ctx, args)
    punch_to(ctx.session_dir, args[1] or '', args[2], args[3])
  end)
end
