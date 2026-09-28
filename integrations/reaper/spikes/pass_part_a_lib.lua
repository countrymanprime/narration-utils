-- The logic of the verification pass's Part A driver (booth actions enablement PRD Phase 6,
-- docs/operations/reaper-verification-pass.md): the report and its results file, the file protocol the driver speaks to
-- the real bridge, the scratch-path guard, a small defer scheduler, and every Part A row it scripts. It touches no
-- `reaper` global: pass_part_a.lua (run in REAPER) and tests/pass_part_a_test.lua (run against the harness's fake)
-- each hand the rows a context, so the harness proves the rows' logic and REAPER only answers what REAPER does.
--
-- A row is `function(ctx, r)`. `ctx.send(command, ...)` sends one command with a fresh run id through the bridge and
-- answers that run's events (each a list of decoded fields: tag, run, ...); `ctx.heartbeat()` answers the next
-- PROJECT_STATUS sent after the call; `ctx.sleep(seconds)` waits; `ctx.fx` names the fixture (track, item and take
-- GUIDs); `ctx.daw` is the probe (M.new_probe) the row reads REAPER through and acts as the narrator with. `r` is the
-- report: r:check(label, ok, detail), r:note(text) for a value the row records without judging, and r:not_run(label,
-- why) for a step Part A cannot take (a recording is Part B's, D28).
--
-- Research tool, not product code (integrations/reaper/spikes/README.md).

local M = {}

-- Protocol ---------------------------------------------------------------------------------------------------------

-- Percent encoding identical to narration_bridge_core.lua's and bridge.go's (RFC 3986 unreserved characters pass).
function M.encode(value)
  return (tostring(value or ''):gsub('[^%w%-_%.~]', function(char)
    return string.format('%%%02X', string.byte(char))
  end))
end

function M.decode(value)
  return (tostring(value or ''):gsub('%%(%x%x)', function(hex)
    return string.char(tonumber(hex, 16))
  end))
end

-- One command file's line, protocol version 1: `1|command|run|args...`, every field encoded.
function M.command_line(command, run, ...)
  local fields = { M.encode('1'), M.encode(command), M.encode(run) }
  for index = 1, select('#', ...) do
    fields[#fields + 1] = M.encode((select(index, ...)))
  end
  return table.concat(fields, '|')
end

function M.parse_event(line)
  local fields = {}
  for part in ((line:gsub('[\r\n]+$', '')) .. '|'):gmatch('(.-)|') do
    fields[#fields + 1] = M.decode(part)
  end
  return fields
end

-- Reads events.log from where it last stopped. `read` answers the whole file's text (or nil before it exists).
function M.event_reader(read)
  local offset = 0
  return {
    poll = function()
      local text = read() or ''
      local fresh = text:sub(offset + 1)
      -- Only whole lines: a line the bridge is still appending is read on the next poll.
      local last_newline = fresh:match('^.*()\n')
      if not last_newline then
        return {}
      end
      offset = offset + last_newline
      local events = {}
      for line in fresh:sub(1, last_newline):gmatch('[^\n]+') do
        if line ~= '\r' then
          events[#events + 1] = M.parse_event(line)
        end
      end
      return events
    end,
  }
end

-- Safety ------------------------------------------------------------------------------------------------------------

local function comparable(path)
  return (tostring(path or ''):gsub('\\', '/'):gsub('/+$', ''):lower())
end

-- Answers `path` when it is inside one of `roots` (the scratch -Out and -Cfg folders), and raises otherwise, or when it
-- is under a "REAPER Media" folder or climbs out with "..". Every file the driver writes and the project it saves go
-- through this, so a wrong path stops the pass instead of touching the owner's files (owner decision D3).
function M.assert_scratch(path, roots)
  local wanted = comparable(path)
  if wanted:find('reaper media', 1, true) then
    error('refusing a path under a REAPER Media folder: ' .. tostring(path), 2)
  end
  if ('/' .. wanted .. '/'):find('/../', 1, true) then
    error('refusing a path with "..": ' .. tostring(path), 2)
  end
  for _, root in ipairs(roots) do
    local base = comparable(root)
    if base ~= '' and wanted:sub(1, #base + 1) == base .. '/' then
      return path
    end
  end
  error('refusing a path outside the scratch folders: ' .. tostring(path), 2)
end

local function escape_pattern(text)
  return (text:gsub('[%^%$%(%)%%%.%[%]%*%+%-%?]', '%%%0'))
end

-- Removes paths from report text: each `{path, label}` pair is replaced (either slash, any case), then any drive path
-- or home folder that is left, so the results can be pasted into an issue and committed under spikes/results/.
function M.scrub(text, pairs_list)
  local out = tostring(text or '')
  for _, pair in ipairs(pairs_list) do
    local root = tostring(pair[1] or ''):gsub('[\\/]+$', '')
    if root ~= '' then
      -- Either slash, any case: a path REAPER reports may differ from the one the driver was given in both.
      local pattern = root:gsub('.', function(char)
        if char == '/' or char == '\\' then
          return '[\\/]'
        elseif char:match('%a') then
          return '[' .. char:lower() .. char:upper() .. ']'
        end
        return escape_pattern(char)
      end)
      out = out:gsub(pattern, (pair[2]:gsub('%%', '%%%%')))
    end
  end
  out = out:gsub('%a:[\\/][^%s|\'"]*', '<path>')
  out = out:gsub('/home/[^%s|\'"]*', '<path>'):gsub('/Users/[^%s|\'"]*', '<path>')
  return out
end

-- Scheduler -----------------------------------------------------------------------------------------------------------

-- Runs `body` as a coroutine over REAPER's defer loop: a `coroutine.yield(seconds)` inside it (M.sleep) resumes once
-- `clock()` has moved on that far. `done(ok, err)` is called once, when the body returns or raises.
function M.run_async(body, defer, clock, done)
  local co = coroutine.create(body)
  local wake = nil
  local function step()
    if wake and clock() < wake then
      defer(step)
      return
    end
    local ok, wait = coroutine.resume(co)
    if not ok then
      done(false, debug.traceback(co, tostring(wait)))
      return
    end
    if coroutine.status(co) == 'dead' then
      done(true)
      return
    end
    wake = clock() + (tonumber(wait) or 0)
    defer(step)
  end
  step()
end

function M.sleep(seconds)
  coroutine.yield(seconds)
end

-- Report --------------------------------------------------------------------------------------------------------------

-- Every row the pass has, in the page's order, and which script checks it. The rows of the edit and proof workspace
-- (A6-A8b) are spike_ep0_workspace.lua's, merged in from its report (M.merge_checks).
M.ROWS = {
  { id = 'A1', command = 'heartbeat `changeCount`' },
  { id = 'A2', command = '`chapter_track_state`' },
  { id = 'A3', command = '`chapter_track_state` while playing' },
  { id = 'A4', command = '`arm_only`' },
  { id = 'A5', command = '`record_start` refusals' },
  { id = 'A6', command = '`set_active_take`', script = 'ep0' },
  { id = 'A7', command = '`list_fx_chains`, `list_fx`', script = 'ep0' },
  { id = 'A8', command = '`apply_fx_chain`', script = 'ep0' },
  { id = 'A8b', command = '`add_take_fx`', script = 'ep0' },
  { id = 'A9', command = '`create_regions`' },
  { id = 'A9b', command = '`play_position`' },
  { id = 'A9c', command = '`punch_to`' },
  { id = 'A10', command = 'Nothing else changed' },
  { id = 'A11', command = '`select_track`' },
  { id = 'A12', command = '`preview_cleanup_markers`' },
  { id = 'A13', command = '`apply_cleanup_trims`' },
  { id = 'A14', command = '`apply_item_gain`' },
}

-- The row a check label belongs to: its leading id ("A8b.3 ..." is A8b), or A10 for a check that says "(A10)".
function M.row_of(label)
  if tostring(label):find('(A10)', 1, true) then
    return 'A10'
  end
  return tostring(label):match('^(A%d+%a?)[%.%s]')
end

function M.new_report()
  local report = { rows = {}, lines = {}, current = nil, errors = {} }
  for _, row in ipairs(M.ROWS) do
    report.rows[row.id] = { id = row.id, command = row.command, checks = {}, notes = {}, not_run = {} }
  end

  function report:log(text)
    self.lines[#self.lines + 1] = tostring(text)
  end
  function report:begin(id, title)
    self.current = assert(self.rows[id], 'unknown row ' .. tostring(id))
    self:log('')
    self:log('== ' .. id .. ' ' .. (title or self.current.command) .. ' ==')
  end
  local function row_for(self, label)
    return self.rows[M.row_of(label) or ''] or self.current
  end
  function report:check(label, ok, detail)
    local row = row_for(self, label)
    assert(row, 'a check outside any row: ' .. tostring(label))
    row.checks[#row.checks + 1] = { label = label, ok = ok and true or false, detail = detail }
    self:log((ok and 'PASS ' or 'FAIL ') .. label .. (detail ~= nil and (' :: ' .. tostring(detail)) or ''))
  end
  function report:note(text)
    local row = assert(self.current, 'a note outside any row')
    row.notes[#row.notes + 1] = tostring(text)
    self:log('NOTE ' .. row.id .. ': ' .. tostring(text))
  end
  function report:not_run(label, why)
    local row = row_for(self, label)
    row.not_run[#row.not_run + 1] = { label = label, why = why }
    self:log('NOT RUN ' .. label .. ' :: ' .. tostring(why))
  end
  -- A row whose script raised: it fails, with the error as its last check.
  function report:fail_row(id, err)
    local row = self.rows[id]
    row.checks[#row.checks + 1] = { label = id .. ' stopped with an error', ok = false, detail = err }
    self:log('ERROR ' .. id .. ' :: ' .. tostring(err))
  end

  -- PASS when the row has checks and every one passed, FAIL when any failed, NOT RUN when it has none.
  function report:verdict(id)
    local row = self.rows[id]
    if #row.checks == 0 then
      return 'NOT RUN'
    end
    for _, check in ipairs(row.checks) do
      if not check.ok then
        return 'FAIL'
      end
    end
    return 'PASS'
  end

  function report:totals()
    local totals = { PASS = 0, FAIL = 0, ['NOT RUN'] = 0, rows = #M.ROWS }
    for _, row in ipairs(M.ROWS) do
      local verdict = self:verdict(row.id)
      totals[verdict] = totals[verdict] + 1
    end
    return totals
  end

  -- The results file the owner pastes into #510: a table of every row, what was recorded, and each failure in full.
  -- `meta` holds version, os, lua, rev, date and seconds (any may be missing).
  function report:markdown(meta)
    meta = meta or {}
    local totals = self:totals()
    local out = {
      '## Verification pass, Part A: results',
      '',
      string.format('- REAPER %s on %s (%s)', meta.version or '?', meta.os or '?', meta.lua or '?'),
      string.format('- Driver: `integrations/reaper/spikes/pass_part_a.lua` at `%s`', meta.rev or 'unknown'),
      string.format('- Run: %s, %s s', meta.date or '?', meta.seconds and string.format('%.0f', meta.seconds) or '?'),
      string.format(
        '- **%d of %d rows pass**, %d fail, %d not run (every row verdict below; a step left to Part B is listed, not failed)',
        totals.PASS,
        totals.rows,
        totals.FAIL,
        totals['NOT RUN']
      ),
      '',
      '| Row | Command | Result | Checks | Failed or not run |',
      '| --- | --- | --- | --- | --- |',
    }
    for _, entry in ipairs(M.ROWS) do
      local row = self.rows[entry.id]
      local passed, missing = 0, {}
      for _, check in ipairs(row.checks) do
        if check.ok then
          passed = passed + 1
        else
          missing[#missing + 1] = (check.label:match('^(%S+)') or check.label)
        end
      end
      for _, step in ipairs(row.not_run) do
        missing[#missing + 1] = (step.label:match('^(%S+)') or step.label) .. ' (not run)'
      end
      out[#out + 1] =
        string.format('| %s | %s | %s | %d/%d | %s |', entry.id, entry.command, self:verdict(entry.id), passed, #row.checks, table.concat(missing, ', '))
    end
    local notes = {}
    for _, entry in ipairs(M.ROWS) do
      for _, note in ipairs(self.rows[entry.id].notes) do
        notes[#notes + 1] = '- ' .. entry.id .. ': ' .. note
      end
      for _, step in ipairs(self.rows[entry.id].not_run) do
        notes[#notes + 1] = '- ' .. step.label .. ': not run, ' .. tostring(step.why)
      end
    end
    if #notes > 0 then
      out[#out + 1] = ''
      out[#out + 1] = '### Recorded values'
      out[#out + 1] = ''
      for _, line in ipairs(notes) do
        out[#out + 1] = line
      end
    end
    local failures = {}
    for _, entry in ipairs(M.ROWS) do
      for _, check in ipairs(self.rows[entry.id].checks) do
        if not check.ok then
          failures[#failures + 1] = '- FAIL ' .. check.label .. (check.detail ~= nil and (' :: `' .. tostring(check.detail):gsub('`', "'") .. '`') or '')
        end
      end
    end
    if #failures > 0 then
      out[#out + 1] = ''
      out[#out + 1] = '### Failures'
      out[#out + 1] = ''
      for _, line in ipairs(failures) do
        out[#out + 1] = line
      end
    end
    return table.concat(out, '\n') .. '\n'
  end

  return report
end

-- Merges another spike's report (spike_ep0_workspace.lua's `PASS label :: detail` / `FAIL ...` / `ERROR ...` lines) into
-- `report`, each check under the row its label names. Without the text, every one of `rows` is left NOT RUN with
-- `missing_why`; a check naming no row is logged only. A script error fails each of `rows` that has no check of its own.
function M.merge_checks(report, text, rows, missing_why)
  if not text then
    for _, id in ipairs(rows) do
      report:not_run(id .. ' (whole row)', missing_why)
    end
    return
  end
  local errored = nil
  for line in text:gmatch('[^\r\n]+') do
    local verdict, rest = line:match('^(PASS) (.*)$')
    if not verdict then
      verdict, rest = line:match('^(FAIL) (.*)$')
    end
    if verdict then
      local label, detail = rest:match('^(.-) :: (.*)$')
      label = label or rest
      if M.row_of(label) and report.rows[M.row_of(label)] then
        report:check(label, verdict == 'PASS', detail)
      else
        report:log('(unassigned) ' .. line)
      end
    elseif line:match('^ERROR ') then
      errored = line:sub(7)
    end
  end
  if errored then
    for _, id in ipairs(rows) do
      if #report.rows[id].checks == 0 then
        report:fail_row(id, 'the script stopped before this row: ' .. errored)
      end
    end
  end
end

-- The probe --------------------------------------------------------------------------------------------------------

-- The probe the rows read REAPER through and act as the narrator with, built on the ReaScript calls `api` has. `extra`
-- adds or replaces entries: REAPER's own undo, save and state chunks from pass_part_a.lua, and in the harness what the
-- fake does not model. `undo()` answers the label it undid, or nil when undo is not modelled (the harness).
function M.new_probe(api, extra)
  local probe = {}
  local function normalize(guid)
    local bare = tostring(guid or ''):gsub('[{}%s]', ''):upper()
    return bare == '' and '' or ('{' .. bare .. '}')
  end
  probe.normalize = normalize
  function probe.track(guid)
    for index = 0, api.CountTracks(0) - 1 do
      local track = api.GetTrack(0, index)
      if normalize(api.GetTrackGUID(track)) == normalize(guid) then
        return track
      end
    end
    return nil
  end
  local function item_guid(item)
    local _, guid = api.GetSetMediaItemInfo_String(item, 'GUID', '', false)
    return normalize(guid)
  end
  local function take_guid(take)
    local _, guid = api.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
    return normalize(guid)
  end
  function probe.item(guid)
    for index = 0, api.CountMediaItems(0) - 1 do
      local item = api.GetMediaItem(0, index)
      if item_guid(item) == normalize(guid) then
        return item
      end
    end
    return nil
  end
  function probe.cursor()
    return api.GetCursorPosition()
  end
  function probe.set_cursor(seconds)
    api.SetEditCurPos(seconds, false, false)
  end
  function probe.play_state()
    return api.GetPlayState()
  end
  function probe.recording()
    return math.floor(api.GetPlayState() / 4) % 2 == 1
  end
  function probe.play()
    api.OnPlayButton()
  end
  function probe.stop()
    api.OnStopButton()
  end
  function probe.change_count()
    return api.GetProjectStateChangeCount(0)
  end
  function probe.armed(guid)
    return api.GetMediaTrackInfo_Value(probe.track(guid), 'I_RECARM') ~= 0
  end
  function probe.arm(guid, on)
    api.SetMediaTrackInfo_Value(probe.track(guid), 'I_RECARM', on and 1 or 0)
  end
  function probe.armed_count()
    local count = 0
    for index = 0, api.CountTracks(0) - 1 do
      if api.GetMediaTrackInfo_Value(api.GetTrack(0, index), 'I_RECARM') ~= 0 then
        count = count + 1
      end
    end
    return count
  end
  function probe.rec_input(guid)
    return math.floor(api.GetMediaTrackInfo_Value(probe.track(guid), 'I_RECINPUT'))
  end
  function probe.selected_tracks()
    local out = {}
    for index = 0, api.CountSelectedTracks(0) - 1 do
      out[#out + 1] = normalize(api.GetTrackGUID(api.GetSelectedTrack(0, index)))
    end
    table.sort(out)
    return out
  end
  function probe.select(guid, on)
    api.SetTrackSelected(probe.track(guid), on)
  end
  -- The track's items, by position, each with its active take's values as chapter_track_state reports them.
  function probe.track_items(guid)
    local track, out = probe.track(guid), {}
    for index = 0, api.CountTrackMediaItems(track) - 1 do
      local item = api.GetTrackMediaItem(track, index)
      local take = api.GetActiveTake(item)
      local source = take and api.GetMediaItemTake_Source(take)
      out[#out + 1] = {
        guid = item_guid(item),
        take = take and take_guid(take) or '',
        position = api.GetMediaItemInfo_Value(item, 'D_POSITION'),
        length = api.GetMediaItemInfo_Value(item, 'D_LENGTH'),
        vol = api.GetMediaItemInfo_Value(item, 'D_VOL'),
        offset = take and api.GetMediaItemTakeInfo_Value(take, 'D_STARTOFFS') or 0,
        rate = take and api.GetMediaItemTakeInfo_Value(take, 'D_PLAYRATE') or 1,
        file = source and api.GetMediaSourceFileName(source, '') or '',
      }
    end
    table.sort(out, function(a, b)
      return a.position < b.position
    end)
    return out
  end
  function probe.item_facts(guid)
    for _, track_index in ipairs({ 0, 1, 2 }) do
      local track = api.GetTrack(0, track_index)
      if track then
        for _, facts in ipairs(probe.track_items(api.GetTrackGUID(track))) do
          if facts.guid == normalize(guid) then
            return facts
          end
        end
      end
    end
    return nil
  end
  function probe.take_markers(item_guid_text)
    local take, out = api.GetActiveTake(probe.item(item_guid_text)), {}
    for index = 0, api.GetNumTakeMarkers(take) - 1 do
      local position, name = api.GetTakeMarker(take, index)
      out[#out + 1] = { position = position, name = name }
    end
    return out
  end
  function probe.regions()
    local out, index = {}, 0
    while true do
      local found, is_region, first, last, name, number, color = api.EnumProjectMarkers3(0, index)
      if not found or found == 0 then
        break
      end
      if is_region then
        out[#out + 1] = { first = first, last = last, title = name, number = number, color = color }
      end
      index = index + 1
    end
    return out
  end
  function probe.region(title)
    for _, region in ipairs(probe.regions()) do
      if region.title == title then
        return region
      end
    end
    return nil
  end
  for key, value in pairs(extra or {}) do
    probe[key] = value
  end
  return probe
end

-- Rows -----------------------------------------------------------------------------------------------------------------

local UNKNOWN_GUID = '{FFFFFFFF-0000-4000-8000-00000000FFFF}'
M.UNKNOWN_GUID = UNKNOWN_GUID

local function find(events, tag)
  for _, fields in ipairs(events) do
    if fields[1] == tag then
      return fields
    end
  end
  return {}
end
local function all(events, tag)
  local out = {}
  for _, fields in ipairs(events) do
    if fields[1] == tag then
      out[#out + 1] = fields
    end
  end
  return out
end
local function show(events)
  local out = {}
  for _, fields in ipairs(events) do
    out[#out + 1] = table.concat(fields, '|')
  end
  return #out == 0 and 'NO EVENT' or table.concat(out, ' ; ')
end
local function seconds(value)
  return string.format('%.6f', tonumber(value) or 0)
end
local function close_to(a, b, tolerance)
  return tonumber(a) ~= nil and tonumber(b) ~= nil and math.abs(tonumber(a) - tonumber(b)) <= (tolerance or 0.0005)
end
local function same_path(a, b)
  return comparable(a) == comparable(b)
end
local function is_whole(text)
  return tostring(text or ''):match('^%d+$') ~= nil
end
local function arms(ctx)
  local fx, daw = ctx.fx, ctx.daw
  return string.format('%d%d%d', daw.armed(fx.ch1) and 1 or 0, daw.armed(fx.ch2) and 1 or 0, daw.armed(fx.pickups) and 1 or 0)
end
-- The refusal message of the first ERROR in `events`, or nil.
local function refusal(events)
  local error_event = find(events, 'ERROR')
  return error_event[3]
end

local rows = {}
M.rows = rows

function rows.A1(ctx, r)
  local daw = ctx.daw
  local beats = { ctx.heartbeat(), ctx.heartbeat(), ctx.heartbeat() }
  r:check('A1.1 three heartbeats arrive', beats[1] and beats[2] and beats[3], #beats)
  local whole = true
  for index = 1, 3 do
    whole = whole and beats[index] ~= nil and is_whole(beats[index][5])
  end
  r:check('A1.2 the fourth field is present and whole in each', whole, show(beats))
  r:check("A1.3 it is REAPER's own edit counter", beats[3] and tonumber(beats[3][5]) == daw.change_count(), beats[3] and beats[3][5])
  -- What an action does to the counter, read from the first heartbeat sent after it.
  local function after(action)
    local before = daw.change_count()
    action()
    local beat = ctx.heartbeat()
    return before, beat and tonumber(beat[5])
  end
  local before, now = after(function()
    daw.move_item(ctx.fx.multi, 0.25)
  end)
  r:check('A1.4 it rises after an item is moved', now and now > before, tostring(before) .. ' -> ' .. tostring(now))
  daw.move_item(ctx.fx.multi, -0.25)
  before, now = after(function()
    daw.add_marker(60, 'Part A marker')
  end)
  r:check('A1.5 it rises after a marker is added', now and now > before, tostring(before) .. ' -> ' .. tostring(now))
  before, now = after(function()
    daw.arm(ctx.fx.pickups, true)
  end)
  r:note(string.format('arming a track %s changeCount (%s -> %s)', now and now > before and 'moves' or 'does not move', before, now))
  daw.arm(ctx.fx.pickups, false)
  before, now = after(function()
    daw.save()
  end)
  r:check('A1.6 it rises after a save', now and now > before, tostring(before) .. ' -> ' .. tostring(now))
end

function rows.A2(ctx, r)
  local fx, daw = ctx.fx, ctx.daw
  daw.stop()
  daw.set_cursor(2.5)
  local count_before, undo_before = daw.change_count(), daw.undo_label()
  local events = ctx.send('chapter_track_state', fx.ch1)
  local state, items, last = find(events, 'TRACK_STATE'), all(events, 'TRACK_ITEM'), find(events, 'TRACK_STATE_END')
  r:check('A2.1 TRACK_STATE names Chapter 1', daw.normalize(state[3]) == daw.normalize(fx.ch1), show(events))
  r:check('A2.2 play state 0 and edit cursor 2.500000', state[4] == '0' and state[5] == '2.500000', tostring(state[4]) .. ' ' .. tostring(state[5]))
  r:check('A2.3 the saved path, unsaved 0', same_path(state[7], fx.project) and state[8] == '0', tostring(state[7]) .. ' ' .. tostring(state[8]))
  r:check('A2.4 the change count REAPER has', tonumber(state[9]) == count_before, tostring(state[9]) .. ' vs ' .. tostring(count_before))
  r:check(
    'A2.5 thisArmed and armedCount as armed',
    state[10] == (daw.armed(fx.ch1) and '1' or '0') and state[11] == tostring(daw.armed_count()),
    tostring(state[10]) .. ' ' .. tostring(state[11])
  )
  r:check("A2.6 the track's I_RECINPUT", state[12] == tostring(daw.rec_input(fx.ch1)), tostring(state[12]) .. ' vs ' .. daw.rec_input(fx.ch1))
  r:check('A2.7 an empty input device (the device is closed)', state[13] == '', state[13])
  local expected = daw.track_items(fx.ch1)
  r:check('A2.8 one TRACK_ITEM per item', #items == #expected, #items .. ' of ' .. #expected)
  local matched, mismatch = 0, nil
  for index, facts in ipairs(expected) do
    local row = items[index] or {}
    if
      daw.normalize(row[3]) == facts.guid
      and daw.normalize(row[4]) == facts.take
      and row[5] == seconds(facts.position)
      and row[7] == seconds(facts.offset)
      and row[8] == seconds(facts.rate)
      and same_path(row[9], facts.file)
    then
      matched = matched + 1
    else
      mismatch = mismatch or table.concat(row, '|')
    end
  end
  r:check("A2.9 each with its active take's offset, rate and file", matched == #expected and #expected > 0, mismatch or (matched .. ' items'))
  r:check('A2.10 TRACK_STATE_END counts them', last[3] == tostring(#expected) and last[4] == tostring(#expected), table.concat(last, '|'))
  local stale = ctx.send('chapter_track_state', UNKNOWN_GUID)
  r:check('A2.11 an unknown GUID answers TRACK_STALE only', #stale == 1 and stale[1][1] == 'TRACK_STALE', show(stale))
  local bare = ctx.send('chapter_track_state', '')
  r:check(
    'A2.12 no GUID answers the transport with no items',
    find(bare, 'TRACK_STATE')[3] == '' and #all(bare, 'TRACK_ITEM') == 0 and find(bare, 'TRACK_STATE_END')[3] == '0',
    show(bare)
  )
  r:check(
    'A2.13 no undo point, change count unchanged',
    daw.undo_label() == undo_before and daw.change_count() == count_before,
    tostring(count_before) .. ' -> ' .. tostring(daw.change_count())
  )
end

-- Two reads of `command` half a second apart (the first after 0.3 s), answering each one's `tag` event.
local function two_reads(ctx, tag, command, ...)
  ctx.sleep(0.3)
  local first = find(ctx.send(command, ...), tag)
  ctx.sleep(0.5)
  local second = find(ctx.send(command, ...), tag)
  return first, second
end

function rows.A3(ctx, r)
  local daw = ctx.daw
  daw.stop()
  daw.set_cursor(1)
  r:check('A3.0 the audio device is closed before playing', daw.audio_closed(), 'Audio_IsRunning')
  daw.play()
  local first, second = two_reads(ctx, 'TRACK_STATE', 'chapter_track_state', ctx.fx.ch1)
  local function playing(state)
    return math.floor((tonumber(state[4]) or 0)) % 2 == 1
  end
  r:check('A3.1 play state 1 in both reads', playing(first) and playing(second), tostring(first[4]) .. ' ' .. tostring(second[4]))
  r:check(
    'A3.2 the play position moves between them',
    (tonumber(second[6]) or 0) > (tonumber(first[6]) or 0),
    tostring(first[6]) .. ' -> ' .. tostring(second[6])
  )
  r:check('A3.3 the edit cursor stays at 1.000000', first[5] == '1.000000' and second[5] == '1.000000', tostring(first[5]) .. ' ' .. tostring(second[5]))
  daw.pause()
  local paused_first, paused_second = two_reads(ctx, 'TRACK_STATE', 'chapter_track_state', ctx.fx.ch1)
  r:note(
    string.format(
      'GetPlayPosition while paused (play state %s) %s (%s -> %s)',
      tostring(paused_second[4]),
      paused_first[6] == paused_second[6] and 'does not move' or 'moves',
      tostring(paused_first[6]),
      tostring(paused_second[6])
    )
  )
  daw.stop()
end

function rows.A9b(ctx, r)
  local daw = ctx.daw
  daw.stop()
  daw.set_cursor(2.5)
  local undo_before = daw.undo_label()
  local stopped = find(ctx.send('play_position'), 'PLAY_POSITION')
  r:check('A9b.1 stopped: state 0 and the cursor at 2.500000', stopped[3] == '0' and stopped[6] == '2.500000', table.concat(stopped, '|'))
  r:check('A9b.2 both positions are numbers', tonumber(stopped[4]) ~= nil and tonumber(stopped[5]) ~= nil, table.concat(stopped, '|'))
  daw.set_cursor(1)
  daw.play()
  local first, second = two_reads(ctx, 'PLAY_POSITION', 'play_position')
  r:check('A9b.3 playing: state 1 in both', first[3] == '1' and second[3] == '1', tostring(first[3]) .. ' ' .. tostring(second[3]))
  r:check(
    'A9b.4 both positions move',
    (tonumber(second[4]) or 0) > (tonumber(first[4]) or 0) and (tonumber(second[5]) or 0) > (tonumber(first[5]) or 0),
    table.concat(first, '|') .. ' -> ' .. table.concat(second, '|')
  )
  local gap = (tonumber(second[5]) or 0) - (tonumber(second[4]) or 0)
  r:check('A9b.5 processed is not behind heard', gap >= 0, string.format('%.6f', gap))
  r:note(string.format('processed ahead of heard by %.6f s (the output latency with the device closed)', gap))
  daw.stop()
  r:not_run('A9b.6 state 5 while recording', 'Part B: it needs a recording on a copy (D28)')
  r:check('A9b.7 no undo point', daw.undo_label() == undo_before, daw.undo_label())
end

function rows.A4(ctx, r)
  local fx, daw = ctx.fx, ctx.daw
  daw.arm(fx.ch1, false)
  daw.arm(fx.ch2, true)
  daw.arm(fx.pickups, true)
  local undo_before = daw.undo_label()
  local armed = find(ctx.send('arm_only', fx.ch1), 'ARMED')
  r:check(
    'A4.1 ARMED names Chapter 1, 2 disarmed, changed',
    daw.normalize(armed[3]) == daw.normalize(fx.ch1) and armed[4] == '2' and armed[5] == '1',
    table.concat(armed, '|')
  )
  r:check('A4.2 only Chapter 1 is armed', arms(ctx) == '100', arms(ctx))
  r:check(
    'A4.3 no "Narration Utils" undo point',
    daw.undo_label() == undo_before,
    "'" .. tostring(undo_before) .. "' -> '" .. tostring(daw.undo_label()) .. "'"
  )
  local undone = daw.undo()
  if undone == nil then
    r:not_run('A4.4 Undo does not change the arms', 'the harness fake has no undo')
  else
    r:note("Undo after arm_only undid '" .. tostring(undone) .. "'")
    r:check('A4.4 Undo does not change the arms', arms(ctx) == '100', arms(ctx))
  end
  local again = find(ctx.send('arm_only', fx.ch1), 'ARMED')
  r:check('A4.5 the second send changes nothing', again[4] == '0' and again[5] == '0' and arms(ctx) == '100', table.concat(again, '|'))
  r:note('the arms remembered from the first send are put back by record_stop, which Part B checks (B3)')
end

function rows.A5(ctx, r)
  local fx, daw = ctx.fx, ctx.daw
  local asked = daw.record_requests()
  daw.stop()
  daw.arm(fx.ch1, true)
  daw.arm(fx.ch2, true)
  daw.arm(fx.pickups, false)
  local two = refusal(ctx.send('record_start', fx.ch1))
  r:check('A5.1 two tracks armed is refused', two == 'More than one track is armed.', two)
  daw.arm(fx.ch1, false)
  local other = refusal(ctx.send('record_start', fx.ch1))
  r:check('A5.2 only "Chapter 2" armed is refused', other == 'Another track is armed.', other)
  daw.arm(fx.ch2, false)
  daw.arm(fx.ch1, true)
  daw.set_cursor(1)
  daw.play()
  ctx.sleep(0.2)
  local playing = refusal(ctx.send('record_start', fx.ch1))
  daw.stop()
  r:check('A5.3 while playing is refused', playing == 'REAPER is playing. Stop it first.', playing)
  r:check(
    'A5.4 REAPER was never asked to record and is not recording',
    daw.record_requests() == asked and not daw.recording(),
    daw.record_requests() - asked .. ' requests'
  )
  daw.arm(fx.ch1, false)
end

local REGIONS = { '30|40|Chapter 1', '40|50|Chapter 2', '50|55|Opening Credits' }

function rows.A9(ctx, r)
  local daw = ctx.daw
  local path = daw.write_payload('regions.txt', REGIONS)
  local count_before, regions_before = daw.change_count(), #daw.regions()
  local made = find(ctx.send('create_regions', path, '3C7FB3', ''), 'REGIONS_CREATED')
  r:check('A9.1 three created', table.concat(made, '|', 3) == '3|0|0|0|0|0', table.concat(made, '|'))
  local found, colors = 0, {}
  for _, row in ipairs(REGIONS) do
    local first, last, title = row:match('^([^|]+)|([^|]+)|(.+)$')
    local region = daw.region(title)
    if region and close_to(region.first, first) and close_to(region.last, last) then
      found = found + 1
      colors[#colors + 1] = region.color
    end
  end
  r:check('A9.2 the regions appear with their titles and bounds', found == 3, found)
  r:check('A9.3 with the colour sent', #colors == 3 and colors[1] ~= 0 and colors[1] == colors[2] and colors[2] == colors[3], table.concat(colors, ','))
  r:check('A9.4 in one undo point "Narration Utils: create regions"', daw.undo_label() == 'Narration Utils: create regions', daw.undo_label())
  local count_made = daw.change_count()
  local again = find(ctx.send('create_regions', path, '3C7FB3', ''), 'REGIONS_CREATED')
  r:check('A9.5 the second send creates none', table.concat(again, '|', 3) == '0|3|0|0|0|0', table.concat(again, '|'))
  r:check('A9.6 and makes no undo point', daw.change_count() == count_made, count_made .. ' -> ' .. daw.change_count())
  local chapter2 = daw.region('Chapter 2') or {}
  local moved_rows = { REGIONS[1], '40|52|Chapter 2', REGIONS[3] }
  local moved = find(ctx.send('create_regions', daw.write_payload('regions-moved.txt', moved_rows), '3C7FB3', '1'), 'REGIONS_CREATED')
  local after = daw.region('Chapter 2') or {}
  r:check('A9.7 the update moves one region', table.concat(moved, '|', 3) == '0|2|0|1|0|0', table.concat(moved, '|'))
  r:check(
    'A9.8 keeping its number and colour',
    close_to(after.last, 52) and after.number == chapter2.number and after.color == chapter2.color and #daw.regions() == regions_before + 3,
    string.format('#%s %s..%s colour %s', tostring(after.number), tostring(after.first), tostring(after.last), tostring(after.color))
  )
  if daw.undo() == nil then
    r:not_run('A9.9 one Undo removes what one call did', 'the harness fake has no undo')
  else
    local back = daw.region('Chapter 2') or {}
    r:check('A9.9 one Undo removes what one call did', close_to(back.last, 50) and #daw.regions() == regions_before + 3, tostring(back.last))
  end
  r:note('change count across the three sends: ' .. count_before .. ' -> ' .. daw.change_count())
end

function rows.A9c(ctx, r)
  local daw = ctx.daw
  daw.stop()
  daw.set_cursor(0)
  local undo_before = daw.undo_label()
  local punched = find(ctx.send('punch_to', '42.5', '3'), 'PUNCHED')
  r:check(
    'A9c.1 42.5 with pre-roll 3 puts the cursor at 39.5',
    punched[3] == '39.500000' and close_to(daw.cursor(), 39.5),
    tostring(punched[3]) .. ' ' .. daw.cursor()
  )
  r:check('A9c.2 playback is not started', daw.play_state() == 0, daw.play_state())
  if daw.in_view then
    r:check('A9c.3 the cursor is in view', daw.in_view(39.5), 'arrange view')
  else
    r:not_run('A9c.3 the cursor is in view', 'the harness fake has no arrange view')
  end
  local clamped = find(ctx.send('punch_to', '1.25', '3'), 'PUNCHED')
  r:check('A9c.4 1.25 with pre-roll 3 stops at 0', clamped[3] == '0.000000' and close_to(daw.cursor(), 0), tostring(clamped[3]))
  r:not_run('A9c.5 refused while recording', 'Part B: it needs a recording on a copy (D28)')
  local bad = refusal(ctx.send('punch_to', '42', '11'))
  r:check(
    'A9c.6 a pre-roll of 11 is refused and the cursor stays',
    bad == 'The word time or pre-roll is not a usable number of seconds.' and close_to(daw.cursor(), 0),
    bad
  )
  r:check('A9c.7 no undo point', daw.undo_label() == undo_before, daw.undo_label())
end

function rows.A11(ctx, r)
  local fx, daw = ctx.fx, ctx.daw
  daw.select(fx.ch1, false)
  daw.select(fx.ch2, true)
  daw.select(fx.pickups, true)
  local undo_before = daw.undo_label()
  local selected = ctx.send('select_track', fx.ch1)
  r:check(
    'A11.1 TRACK_SELECTED names Chapter 1',
    selected[1] and selected[1][1] == 'TRACK_SELECTED' and daw.normalize(selected[1][3]) == daw.normalize(fx.ch1),
    show(selected)
  )
  local now = daw.selected_tracks()
  r:check('A11.2 only Chapter 1 is selected', #now == 1 and now[1] == daw.normalize(fx.ch1), table.concat(now, ','))
  r:check('A11.3 no undo point', daw.undo_label() == undo_before, daw.undo_label())
  local stale = ctx.send('select_track', UNKNOWN_GUID)
  local kept = daw.selected_tracks()
  r:check(
    'A11.4 an unknown GUID answers TRACK_STALE and the selection stays',
    #stale == 1 and stale[1][1] == 'TRACK_STALE' and #kept == 1 and kept[1] == daw.normalize(fx.ch1),
    show(stale)
  )
  local bare = ctx.send('select_track', '')
  r:check('A11.5 no GUID answers TRACK_STALE', #bare == 1 and bare[1][1] == 'TRACK_STALE', show(bare))
end

-- The cleanup fixture: a 3 s item at 12 s on "Chapter 1", its take's source from 0 s; one silence from 1.0 to 1.5 s.
local function cleanup_rows(ctx)
  return {
    table.concat({ ctx.fx.cleanup, ctx.fx.cleanup_take, 'silence', '1.0', '1.5', 'f1' }, '|'),
    table.concat({ UNKNOWN_GUID, '', 'silence', '0.2', '0.4', 'f9' }, '|'),
    table.concat({ ctx.fx.cleanup, '', 'silence', '2.8', '3.6', 'f8' }, '|'),
  }
end

function rows.A12(ctx, r)
  local fx, daw = ctx.fx, ctx.daw
  local path = daw.write_payload('cleanup.txt', cleanup_rows(ctx))
  local facts, count = daw.item_facts(fx.cleanup), #daw.track_items(fx.ch1)
  local events = ctx.send('preview_cleanup_markers', path)
  local done = find(events, 'CLEANUP_PREVIEWED')
  r:check('A12.1 CLEANUP_PREVIEWED adds 2, 0 existing', done[3] == '2' and done[4] == '0', show(events))
  local stale = {}
  for _, fields in ipairs(all(events, 'CLEANUP_STALE')) do
    stale[fields[3]] = fields[5]
  end
  r:check('A12.2 the unknown item answers CLEANUP_STALE item', stale.f9 == 'item', stale.f9)
  r:check("A12.3 a cut past the item's end answers CLEANUP_STALE range", stale.f8 == 'range', stale.f8)
  local start_ok, end_ok = false, false
  for _, marker in ipairs(daw.take_markers(fx.cleanup)) do
    start_ok = start_ok or (marker.name == 'CLEANUP_SILENCE_START: f1' and close_to(marker.position, 1.0))
    end_ok = end_ok or (marker.name == 'CLEANUP_SILENCE_END: f1' and close_to(marker.position, 1.5))
  end
  r:check('A12.4 take markers at 1.0 and 1.5 s of source time, named for the class and finding', start_ok and end_ok, #daw.take_markers(fx.cleanup))
  r:check('A12.5 one undo point "Narration Utils: preview cleanup markers"', daw.undo_label() == 'Narration Utils: preview cleanup markers', daw.undo_label())
  local after = daw.item_facts(fx.cleanup)
  r:check(
    'A12.6 the item itself is unchanged',
    after and close_to(after.position, facts.position) and close_to(after.length, facts.length) and #daw.track_items(fx.ch1) == count,
    after and (after.position .. ' ' .. after.length)
  )
  local count_before = daw.change_count()
  local again = find(ctx.send('preview_cleanup_markers', path), 'CLEANUP_PREVIEWED')
  r:check('A12.7 again adds none, and no undo point', again[3] == '0' and again[4] == '2' and daw.change_count() == count_before, table.concat(again, '|'))
  if daw.undo() == nil then
    r:not_run('A12.8 one Undo removes both markers', 'the harness fake has no undo')
  else
    r:check('A12.8 one Undo removes both markers', #daw.take_markers(fx.cleanup) == 0, #daw.take_markers(fx.cleanup))
  end
end

function rows.A13(ctx, r)
  local fx, daw = ctx.fx, ctx.daw
  local path = daw.write_payload('trim.txt', { cleanup_rows(ctx)[1] })
  local count = #daw.track_items(fx.ch1)
  local source = daw.item_facts(fx.cleanup).file
  local size = daw.file_size(source)
  local done = find(ctx.send('apply_cleanup_trims', path), 'CLEANUP_APPLIED')
  r:check('A13.1 CLEANUP_APPLIED 1', done[3] == '1', table.concat(done, '|'))
  r:check('A13.2 the track has one item more (split twice, the middle deleted)', #daw.track_items(fx.ch1) == count + 1, #daw.track_items(fx.ch1))
  local left = daw.item_facts(fx.cleanup)
  r:check('A13.3 the left piece keeps the GUID and ends at the cut', left and close_to(left.position, 12) and close_to(left.length, 1.0), left and left.length)
  local right = nil
  for _, facts in ipairs(daw.track_items(fx.ch1)) do
    if close_to(facts.position, 13.5) then
      right = facts
    end
  end
  r:check(
    'A13.4 the right piece starts at 13.5 s, from 1.5 s of source, to 15 s',
    right and close_to(right.offset, 1.5) and close_to(right.length, 1.5),
    right and (right.offset .. ' ' .. right.length) or 'no piece at 13.5 s'
  )
  r:check('A13.5 one undo point "Narration Utils: apply cleanup trim"', daw.undo_label() == 'Narration Utils: apply cleanup trim', daw.undo_label())
  r:check(
    'A13.6 the source file on disk is unchanged',
    size ~= nil and daw.file_size(source) == size,
    tostring(size) .. ' -> ' .. tostring(daw.file_size(source))
  )
  local count_before = daw.change_count()
  local stale_events = ctx.send('apply_cleanup_trims', daw.write_payload('trim-stale.txt', { cleanup_rows(ctx)[2] }))
  r:check(
    'A13.7 an all-stale list answers CLEANUP_STALE, applies 0 and makes no undo point',
    find(stale_events, 'CLEANUP_STALE')[5] == 'item' and find(stale_events, 'CLEANUP_APPLIED')[3] == '0' and daw.change_count() == count_before,
    show(stale_events)
  )
  if daw.undo() == nil then
    r:not_run('A13.8 one Undo rejoins the item', 'the harness fake has no undo')
  else
    local whole = daw.item_facts(fx.cleanup)
    r:check('A13.8 one Undo rejoins the item', #daw.track_items(fx.ch1) == count and whole and close_to(whole.length, 3), whole and whole.length)
  end
end

function rows.A14(ctx, r)
  local fx, daw = ctx.fx, ctx.daw
  local events = ctx.send('apply_item_gain', daw.write_payload('gain.txt', { fx.fast .. '|-6|g1' }))
  local item, applied = find(events, 'GAIN_ITEM'), find(events, 'GAIN_APPLIED')
  r:check(
    'A14.1 GAIN_ITEM 1.000000 -> 0.501187, GAIN_APPLIED 1',
    item[4] == '1.000000' and item[5] == '0.501187' and applied[3] == '1' and daw.normalize(item[3]) == daw.normalize(fx.fast),
    show(events)
  )
  r:check('A14.2 REAPER reads D_VOL back as 0.501187', close_to(daw.item_facts(fx.fast).vol, 0.501187, 0.000001), daw.item_facts(fx.fast).vol)
  r:check('A14.3 one undo point "Narration Utils: apply level-match gain"', daw.undo_label() == 'Narration Utils: apply level-match gain', daw.undo_label())
  local others = true
  for _, facts in ipairs(daw.track_items(fx.ch1)) do
    others = others and (facts.guid == daw.normalize(fx.fast) or close_to(facts.vol, 1, 0.000001))
  end
  r:check("A14.4 no other item's volume changed", others)
  find(ctx.send('apply_item_gain', daw.write_payload('gain-back.txt', { fx.fast .. '|6|g2' })), 'GAIN_APPLIED')
  r:check('A14.5 +6 dB on top multiplies back to about 1.0', close_to(daw.item_facts(fx.fast).vol, 1, 0.0001), daw.item_facts(fx.fast).vol)
  if daw.undo() == nil then
    r:not_run('A14.6 one Undo puts back 0.501187', 'the harness fake has no undo')
  else
    r:check('A14.6 one Undo puts back 0.501187', close_to(daw.item_facts(fx.fast).vol, 0.501187, 0.000001), daw.item_facts(fx.fast).vol)
  end
  local count_before = daw.change_count()
  local stale = ctx.send('apply_item_gain', daw.write_payload('gain-stale.txt', { UNKNOWN_GUID .. '|-3|g9' }))
  r:check(
    'A14.7 an unknown item answers GAIN_STALE, applies 0 and makes no undo point',
    find(stale, 'GAIN_STALE')[3] == 'g9' and find(stale, 'GAIN_APPLIED')[3] == '0' and daw.change_count() == count_before,
    show(stale)
  )
end

-- The order the rows run in, and what each may change: `witness` is what A10 compares before and after the row (every
-- track but `except`, their arms and selection unless `arms`/`selection` is false, and the markers unless `markers` is
-- false). A1 changes the project on purpose and is not witnessed. A4's Undo is the narrator's and undoes the last undo
-- point there is (A1's marker, since A2 to A9b make none), so A4's witness leaves the markers out.
M.ORDER = {
  { id = 'A1' },
  { id = 'A2', witness = {} },
  { id = 'A3', witness = {} },
  { id = 'A9b', witness = {} },
  { id = 'A4', witness = { arms = false, markers = false } },
  { id = 'A5', witness = { arms = false } },
  { id = 'A9', witness = { markers = false } },
  { id = 'A9c', witness = {} },
  { id = 'A11', witness = { selection = false } },
  { id = 'A12', witness = { except = 'ch1' } },
  { id = 'A13', witness = { except = 'ch1' } },
  { id = 'A14', witness = { except = 'ch1' } },
}

-- Runs every row of `order` (M.ORDER by default) against `ctx`, recording into `report`. A row that raises fails with its
-- error and the next row still runs; A10 gets one check per witnessed row.
function M.run_rows(ctx, report, order)
  for _, entry in ipairs(order or M.ORDER) do
    local row = assert(rows[entry.id], 'no row ' .. entry.id)
    report:begin(entry.id)
    local options = nil
    if entry.witness then
      options = {}
      for key, value in pairs(entry.witness) do
        options[key] = value
      end
      options.except = entry.witness.except and ctx.fx[entry.witness.except] or nil
    end
    local before = options and ctx.daw.witness(options)
    local ok, err = xpcall(row, debug.traceback, ctx, report)
    if not ok then
      report:fail_row(entry.id, err)
    end
    if options then
      local after = ctx.daw.witness(options)
      report:check(
        'A10.' .. entry.id .. ' nothing outside what ' .. entry.id .. ' changes has changed (A10)',
        before == after,
        before ~= after and 'the witness differs' or nil
      )
    end
  end
end

return M
