-- The verification pass's Part A driver (integrations/reaper/spikes/pass_part_a_lib.lua, booth actions enablement PRD
-- Phase 6) against the fake: its protocol, scratch-path guard, scheduler and report on their own, then every row it
-- scripts run through the real bridge's file protocol on the harness's fake REAPER. A row that passes here has the
-- logic right; what REAPER itself answers is the owner's run (docs/operations/reaper-verification-pass.md).
--
-- The library is loaded from the working tree's spikes folder (next to this one), not from host.reaper_dir, so the
-- mutation checks, which copy only the bridge's own files, still run these tests against the mutated bridge.

local H = require('harness')

local function spikes_dir()
  local harness_path = assert(package.searchpath('harness', package.path), 'harness.lua not on package.path')
  return (harness_path:gsub('[\\/]harness%.lua$', '')) .. '/../spikes'
end
local Lib = dofile(spikes_dir() .. '/pass_part_a_lib.lua')

-- A fixture like pass_part_a.lua's, on the fake: "Chapter 1" with a two-take item, a trimmed item, one at play rate
-- 1.5 and the cleanup item; "Chapter 2" with one item; "Pickups" empty; one region. `ctx` is what the rows get.
local function fixture()
  local s = H.session({ project_path = 'C:\\Scratch\\pass\\pass-part-a.rpp' })
  local f = s.fake
  local api = f.reaper
  -- REAPER's edit counter rises with every undo point; the fake's is set by hand, so model that here.
  api.GetProjectStateChangeCount = function()
    return f.change_count + #f.undo
  end
  local ch1, ch2, pickups = f:add_track('Chapter 1'), f:add_track('Chapter 2'), f:add_track('Pickups')
  ch1.rec_input = 1024
  local multi = f:add_item(ch1, { position = 0, length = 3, source = 'C:\\Scratch\\pass\\media\\take_a.wav' })
  local second = api.AddTakeToMediaItem(multi)
  api.SetMediaItemTake_Source(second, api.PCM_Source_CreateFromFile('C:\\Scratch\\pass\\media\\take_b.wav'))
  f:add_item(ch1, { position = 4, length = 2.5, source = 'C:\\Scratch\\pass\\media\\take_c.wav', startoffs = 0.5 })
  local fast = f:add_item(ch1, { position = 8, length = 2, source = 'C:\\Scratch\\pass\\media\\take_a.wav', playrate = 1.5 })
  local cleanup = f:add_item(ch1, { position = 12, length = 3, source = 'C:\\Scratch\\pass\\media\\take_c.wav' })
  f:add_item(ch2, { position = 0, length = 3, source = 'C:\\Scratch\\pass\\media\\take_b.wav' })
  f:add_region(20, 25, 'Fixture region')

  local buffer, runs = {}, 0
  local function collect()
    local mine = {}
    for _, fields in ipairs(s:all_events()) do
      if fields[1] == 'PROJECT_STATUS' then
        buffer[#buffer + 1] = fields
      else
        mine[#mine + 1] = fields
      end
    end
    return mine
  end
  local ctx = { session = s }
  function ctx.send(command, ...)
    runs = runs + 1
    local run = 'pa' .. runs
    s:send(command, run, ...)
    local out = {}
    for _, fields in ipairs(collect()) do
      if fields[2] == run then
        out[#out + 1] = fields
      end
    end
    return out
  end
  function ctx.heartbeat()
    collect()
    buffer = {}
    for _ = 1, 10 do
      s:tick()
      collect()
      if #buffer > 0 then
        return table.remove(buffer, 1)
      end
    end
    return nil
  end
  function ctx.sleep(seconds)
    if f.play_state == 1 then
      f.play_position = f.play_position + seconds
      f.play_position2 = f.play_position2 + seconds
    end
    s:tick()
    collect()
  end
  local function track_by_guid(guid)
    for _, track in ipairs(f.tracks) do
      if track.guid == guid then
        return track
      end
    end
  end
  ctx.fx = {
    project = f.project_path,
    ch1 = ch1.guid,
    ch2 = ch2.guid,
    pickups = pickups.guid,
    multi = multi.guid,
    fast = fast.guid,
    cleanup = cleanup.guid,
    cleanup_take = cleanup.takes[1].guid,
  }
  ctx.daw = Lib.new_probe(api, {
    undo_label = function()
      return f.undo[#f.undo] and f.undo[#f.undo].label or ''
    end,
    undo = function()
      return nil
    end,
    play = function()
      f.play_state = 1
      f.play_position, f.play_position2 = f.cursor, f.cursor + 0.02
    end,
    pause = function()
      f.play_state = 2
    end,
    audio_closed = function()
      return f.audio_input == nil
    end,
    record_requests = function()
      local count = 0
      for _, call in ipairs(f.calls) do
        count = count + (call.name == 'CSurf_OnRecord' and 1 or 0)
      end
      return count
    end,
    select = function(guid, on)
      track_by_guid(guid).selected = on
    end,
    move_item = function(guid, delta)
      for _, item in ipairs(f.items) do
        if item.guid == guid then
          item.position = item.position + delta
        end
      end
      f.change_count = f.change_count + 1
    end,
    add_marker = function(at, name)
      f:insert_marker({ is_region = false, pos = at, rgnend = 0, name = name, color = 0 })
      f.change_count = f.change_count + 1
    end,
    save = function()
      f.change_count = f.change_count + 1
    end,
    write_payload = function(name, lines)
      local file = s:path(name)
      H.write_file(file, table.concat(lines, '\n') .. '\n')
      return file
    end,
    file_size = function()
      return 1000
    end,
    -- Every track but `except`: its items, their takes and markers, and its arm and selection unless left out.
    witness = function(options)
      local out = {}
      for _, track in ipairs(f.tracks) do
        if track.guid ~= options.except then
          out[#out + 1] = string.format(
            'track %s arm %s sel %s',
            track.name,
            options.arms == false and '-' or tostring(track.armed),
            options.selection == false and '-' or tostring(track.selected)
          )
          for _, item in ipairs(track.items) do
            out[#out + 1] = string.format(' item %s %.6f %.6f vol %s takes %d', item.guid, item.position, item.length, tostring(item.vol), #item.takes)
            for _, take in ipairs(item.takes) do
              out[#out + 1] = string.format('  take %s %s markers %d', take.guid, tostring(take.startoffs), #take.markers)
            end
          end
        end
      end
      if options.markers ~= false then
        for _, marker in ipairs(f.markers) do
          out[#out + 1] = string.format('marker %s %s %s %s', tostring(marker.is_region), marker.pos, marker.rgnend, marker.name)
        end
      end
      return table.concat(out, '\n')
    end,
  })
  return ctx
end

-- The report's rows that failed, with their failing checks, as one message.
local function failures(report)
  local out = {}
  for _, entry in ipairs(Lib.ROWS) do
    for _, check in ipairs(report.rows[entry.id].checks) do
      if not check.ok then
        out[#out + 1] = check.label .. ' :: ' .. tostring(check.detail)
      end
    end
  end
  return table.concat(out, '\n')
end

-- Protocol ---------------------------------------------------------------------------------------------------------

H.test('a command line is the harness encoding, and the bridge answers it', function()
  H.eq(Lib.command_line('punch_to', 'r1', '42.5', 'a|b c'), '1|punch_to|r1|42.5|a%7Cb%20c')
  H.eq(Lib.decode(Lib.encode('C:\\x|y z%')), 'C:\\x|y z%')
  local s = H.session()
  s:send_raw(Lib.command_line('punch_to', 'r1', '42.5', '3'))
  H.eq(s:events(), { { 'PUNCHED', 'r1', '39.500000' } })
end)

H.test('the event reader returns whole lines once each and keeps a half-written one for the next poll', function()
  local text = 'A|r1|x%7Cy\nB|r2'
  local reader = Lib.event_reader(function()
    return text
  end)
  H.eq(reader.poll(), { { 'A', 'r1', 'x|y' } })
  H.eq(reader.poll(), {})
  text = text .. '|2\r\n'
  H.eq(reader.poll(), { { 'B', 'r2', '2' } })
  H.eq(
    Lib.event_reader(function()
      return nil
    end).poll(),
    {}
  )
end)

-- Safety -----------------------------------------------------------------------------------------------------------

H.test('a path inside a scratch folder is allowed, whatever the slashes and case', function()
  local roots = { 'C:\\Users\\Count\\AppData\\Local\\Temp\\pass-a\\out', 'C:\\Users\\Count\\AppData\\Local\\Temp\\pass-a\\cfg\\' }
  H.eq(Lib.assert_scratch('c:/users/count/appdata/local/temp/pass-a/out/regions.txt', roots), 'c:/users/count/appdata/local/temp/pass-a/out/regions.txt')
  H.truthy(Lib.assert_scratch('C:\\Users\\Count\\AppData\\Local\\Temp\\pass-a\\cfg\\FXChains\\x.RfxChain', roots))
end)

H.test('a path outside the scratch folders, under REAPER Media, or climbing out is refused', function()
  local roots = { 'C:\\Temp\\pass\\out' }
  for _, path in ipairs({
    'C:\\Users\\Count\\Documents\\REAPER Media\\Projects\\Challenges\\Challenges_001.rpp',
    'C:\\Temp\\pass\\out2\\x.txt',
    'C:\\Temp\\pass\\out',
    'C:\\Temp\\pass\\out\\..\\..\\reaper.ini',
    'C:\\Temp\\pass\\out\\REAPER Media\\copy.rpp',
    '',
  }) do
    local ok, err = pcall(Lib.assert_scratch, path, roots)
    H.eq(ok, false, 'must refuse ' .. path)
    H.contains(err, 'refusing', path)
  end
  H.eq(pcall(Lib.assert_scratch, 'C:\\Temp\\pass\\out\\x', {}), false, 'no roots allows nothing')
end)

H.test('scrub removes the scratch roots and any other path from report text', function()
  local text = 'saved C:\\Temp\\Pass\\out\\pass.rpp; cfg c:/temp/pass/CFG/reaper.ini; other D:\\Books\\x.wav | /home/me/y'
  local scrubbed = Lib.scrub(text, { { 'C:\\Temp\\pass\\out', '<out>' }, { 'C:\\Temp\\pass\\cfg\\', '<cfg>' } })
  H.eq(scrubbed, 'saved <out>\\pass.rpp; cfg <cfg>/reaper.ini; other <path> | <path>')
end)

-- Scheduler --------------------------------------------------------------------------------------------------------

H.test('run_async resumes a sleeping body only once the clock has moved on that far', function()
  local queue, now, trace, result = {}, 0, {}, nil
  local function defer(fn)
    queue[#queue + 1] = fn
  end
  Lib.run_async(
    function()
      trace[#trace + 1] = 'start ' .. now
      Lib.sleep(2)
      trace[#trace + 1] = 'woke ' .. now
    end,
    defer,
    function()
      return now
    end,
    function(ok, err)
      result = { ok, err }
    end
  )
  for _ = 1, 5 do
    now = now + 0.5
    local current = queue
    queue = {}
    for _, fn in ipairs(current) do
      fn()
    end
  end
  H.eq(trace, { 'start 0', 'woke 2.0' })
  H.eq(result, { true })
end)

H.test('run_async reports an error in the body once, with a traceback', function()
  local queue, result = {}, nil
  Lib.run_async(function()
    Lib.sleep(0)
    error('boom')
  end, function(fn)
    queue[#queue + 1] = fn
  end, function()
    return 0
  end, function(ok, err)
    H.eq(result, nil, 'done is called once')
    result = { ok, err }
  end)
  while #queue > 0 do
    table.remove(queue, 1)()
  end
  H.eq(result[1], false)
  H.contains(result[2], 'boom')
end)

-- Report -----------------------------------------------------------------------------------------------------------

H.test('a row passes only when it has checks and every one passed; its results line says what failed or did not run', function()
  local report = Lib.new_report()
  report:begin('A2')
  report:check('A2.1 fine', true)
  report:begin('A9c')
  report:check('A9c.1 fine', true)
  report:not_run('A9c.5 refused while recording', 'Part B')
  report:begin('A4')
  report:check('A4.1 fine', true)
  report:check('A4.2 broken', false, 'got `x`')
  report:note('Undo undid something')
  H.eq(report:verdict('A2'), 'PASS')
  H.eq(report:verdict('A9c'), 'PASS')
  H.eq(report:verdict('A4'), 'FAIL')
  H.eq(report:verdict('A1'), 'NOT RUN')
  H.eq(report:totals(), { PASS = 2, FAIL = 1, ['NOT RUN'] = #Lib.ROWS - 3, rows = #Lib.ROWS })
  local md = report:markdown({ version = '7.80/x64', os = 'Win64', lua = 'Lua 5.4', rev = 'abc1234', date = '2026-09-28', seconds = 42 })
  H.contains(md, '- REAPER 7.80/x64 on Win64 (Lua 5.4)')
  H.contains(md, 'at `abc1234`')
  H.contains(md, '**2 of ' .. #Lib.ROWS .. ' rows pass**, 1 fail')
  H.contains(md, '| A4 | `arm_only` | FAIL | 1/2 | A4.2 |')
  H.contains(md, '| A9c | `punch_to` | PASS | 1/1 | A9c.5 (not run) |')
  H.contains(md, '| A1 | heartbeat `changeCount` | NOT RUN | 0/0 |  |')
  H.contains(md, '- A4: Undo undid something')
  H.contains(md, '- A9c.5 refused while recording: not run, Part B')
  H.contains(md, "- FAIL A4.2 broken :: `got 'x'`")
end)

H.test('a check is filed under the row its label names, and one marked (A10) under A10', function()
  local report = Lib.new_report()
  report:begin('A12')
  report:check('A10.A12 nothing else changed (A10)', true)
  report:check('A12.1 fine', true)
  H.eq(#report.rows.A10.checks, 1)
  H.eq(#report.rows.A12.checks, 1)
  H.eq(Lib.row_of('A8b.3 the track has two more items'), 'A8b')
  H.eq(Lib.row_of('S2 the saved project'), nil)
end)

H.test('the workspace spike report merges into rows A6 to A8b, and a missing or stopped one is not a pass', function()
  local ep0 = table.concat({
    'version 7.80',
    'PASS A6.1 answers ACTIVE_TAKE_SET changed',
    'FAIL A7.1 lists the chain :: FX_CHAIN|x',
    'PASS A8.1 left "Chapter 2" unchanged (A10)',
    'PASS S2 the saved project has a <TAKEFX> chunk',
    'ERROR something broke',
  }, '\n')
  local report = Lib.new_report()
  Lib.merge_checks(report, ep0, { 'A6', 'A7', 'A8', 'A8b' }, 'missing')
  H.eq(report:verdict('A6'), 'PASS')
  H.eq(report:verdict('A7'), 'FAIL')
  H.eq(report.rows.A7.checks[1].detail, 'FX_CHAIN|x')
  H.eq(#report.rows.A10.checks, 1)
  H.eq(report:verdict('A8'), 'FAIL', 'A8 had only an A10 check, so the stop fails it')
  H.eq(report:verdict('A8b'), 'FAIL')
  local missing = Lib.new_report()
  Lib.merge_checks(missing, nil, { 'A6', 'A8b' }, 'the workspace report is missing')
  H.eq(missing:verdict('A6'), 'NOT RUN')
  H.eq(missing.rows.A8b.not_run[1].why, 'the workspace report is missing')
end)

-- Rows against the fake -------------------------------------------------------------------------------------------

H.test('every row the driver scripts passes against the fake, with A10 checked around each', function()
  local ctx = fixture()
  local report = Lib.new_report()
  Lib.run_rows(ctx, report)
  H.eq(failures(report), '')
  for _, entry in ipairs(Lib.ORDER) do
    H.eq(report:verdict(entry.id), 'PASS', entry.id)
  end
  H.eq(report:verdict('A10'), 'PASS')
  H.eq(#report.rows.A10.checks, #Lib.ORDER - 1, 'one A10 check per witnessed row')
  -- What the fake cannot do is listed as not run, never passed: undo, the arrange view, and Part B's recording.
  local not_run = {}
  for _, entry in ipairs(Lib.ROWS) do
    for _, step in ipairs(report.rows[entry.id].not_run) do
      not_run[#not_run + 1] = step.label:match('^(%S+)')
    end
  end
  H.eq(not_run, { 'A4.4', 'A9.9', 'A9b.6', 'A9c.3', 'A9c.5', 'A12.8', 'A13.8', 'A14.6' })
  H.contains(report:markdown({}), '| A11 | `select_track` | PASS |')
end)

H.test('select_track that leaves other tracks selected fails A11', function()
  local ctx = fixture()
  ctx.session.fake.reaper.SetOnlyTrackSelected = function(track)
    track.selected = true
  end
  local report = Lib.new_report()
  Lib.run_rows(ctx, report, { { id = 'A11', witness = { selection = false } } })
  H.eq(report:verdict('A11'), 'FAIL')
  H.contains(failures(report), 'A11.2 only Chapter 1 is selected')
end)

H.test('a command that changes another track fails A10 for its row', function()
  local ctx = fixture()
  local send = ctx.send
  function ctx.send(...)
    local events = send(...)
    local chapter2 = ctx.session.fake.tracks[2]
    chapter2.items[1].position = chapter2.items[1].position + 1
    return events
  end
  local report = Lib.new_report()
  Lib.run_rows(ctx, report, { { id = 'A2', witness = {} } })
  H.eq(report:verdict('A2'), 'PASS')
  H.eq(report:verdict('A10'), 'FAIL')
end)

H.test('a record_start refusal that asks REAPER to record fails A5', function()
  local ctx = fixture()
  -- As if the bridge had pressed record once between the row's first read and its last.
  local reads = 0
  ctx.daw.record_requests = function()
    reads = reads + 1
    return reads == 1 and 0 or 1
  end
  local report = Lib.new_report()
  Lib.run_rows(ctx, report, { { id = 'A5' } })
  H.contains(failures(report), 'A5.4 REAPER was never asked to record')
end)

H.test('a row that raises fails with its error, and the rows after it still run', function()
  local ctx = fixture()
  ctx.daw.track_items = function()
    error('probe broke')
  end
  local report = Lib.new_report()
  Lib.run_rows(ctx, report, { { id = 'A2' }, { id = 'A9c' } })
  H.eq(report:verdict('A2'), 'FAIL')
  H.contains(failures(report), 'probe broke')
  H.eq(report:verdict('A9c'), 'PASS')
end)
