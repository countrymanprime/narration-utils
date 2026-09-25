-- Edit and proof workspace PRD, Phase 0 (spike SF and the undo questions): the real set_active_take, list_fx_chains,
-- list_fx, apply_fx_chain and add_take_fx commands (narration_workspace.lua, loaded through the real
-- narration_ui_bridge.lua registry) against a real REAPER, in a scratch project built from synthetic tones. It scripts
-- rows A6, A7, A8, A8b and A10 of docs/operations/reaper-verification-pass.md, and answers the PRD's own questions a fake
-- cannot:
--   - does SetActiveTake leave exactly one undo point, and does one Undo restore the previous take;
--   - does TrackFX_AddByName load a .RfxChain by its full path onto a track and the master track;
--   - what does a split do to take FX, take markers, the item's and the take's extension data, the item GUIDs and the
--     fades, and does one Undo rejoin the item;
--   - what REAPER's own peaks (GetMediaItemTake_Peaks, EP12 C) give for a known tone, to cross-check the host's peaks.
--
-- No playback and no recording (owner decision D3): nothing here calls OnPlayButton or records. The FXChains files are
-- written into the isolated -Cfg resource folder, never the owner's.
--
-- Research tool, not product code. Run by run-reaper.ps1 (-Cfg an isolated resource folder, -Out a scratch folder
-- holding media/ from make_media.py); it never opens or saves anything outside -Out and -Cfg. Result:
-- docs/research/edit-and-proof-spike-ep0.md.

do
  local BACKSLASH = string.char(92)
  local wanted = os.getenv('NARRATION_UTILS_SPIKE_CFG')
  local actual = reaper.GetResourcePath()
  assert(wanted and wanted ~= '', 'NARRATION_UTILS_SPIKE_CFG is not set: start this script with run-reaper.ps1')
  assert(actual:gsub(BACKSLASH, '/'):lower() == wanted:gsub(BACKSLASH, '/'):lower(), 'REAPER is not using the isolated -cfgfile: ' .. actual)
  reaper.Audio_Quit()
  assert(reaper.Audio_IsRunning() == 0, 'the audio device could not be closed')
end

local PACK = assert(os.getenv('NARRATION_UTILS_SPIKE_OUT'), 'set NARRATION_UTILS_SPIKE_OUT (run-reaper.ps1 does)')
local REAPER_DIR = assert(os.getenv('NARRATION_UTILS_REAPER_DIR'), 'set NARRATION_UTILS_REAPER_DIR (run-reaper.ps1 does)')
local SEP = package.config:sub(1, 1)
local function path(name)
  return PACK .. SEP .. name
end

local LINE_ID_KEY = 'P_EXT:narration_utils_line_id'
local TAKE_KEY = 'P_EXT:narration_utils_take_finding_id'

local report, passed, failed = {}, 0, 0
local function log(...)
  local parts = {}
  for index = 1, select('#', ...) do
    parts[#parts + 1] = tostring((select(index, ...)))
  end
  report[#report + 1] = table.concat(parts, ' ')
end
local function section(title)
  report[#report + 1] = ''
  report[#report + 1] = '== ' .. title .. ' =='
end
local function check(label, ok, detail)
  if ok then
    passed = passed + 1
  else
    failed = failed + 1
  end
  log((ok and 'PASS ' or 'FAIL ') .. label .. (detail and (' :: ' .. tostring(detail)) or ''))
end
local function finish()
  log('')
  log(string.format('%d passed, %d failed', passed, failed))
  local handle = io.open(path('ep0-workspace-report.txt'), 'wb')
  handle:write(table.concat(report, '\n'), '\n')
  handle:close()
  reaper.Main_OnCommand(40004, 0) -- File: Quit REAPER
end

local function undo_label()
  return reaper.Undo_CanUndo2(0) or ''
end
local function guid_of_item(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)
  return guid
end
local function guid_of_take(take)
  local _, guid = reaper.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
  return guid
end
local function find_item(guid)
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    if guid_of_item(item) == guid then
      return item
    end
  end
  return nil
end
local function items_on(track)
  local found = {}
  for index = 0, reaper.CountTrackMediaItems(track) - 1 do
    found[#found + 1] = reaper.GetTrackMediaItem(track, index)
  end
  table.sort(found, function(a, b)
    return reaper.GetMediaItemInfo_Value(a, 'D_POSITION') < reaper.GetMediaItemInfo_Value(b, 'D_POSITION')
  end)
  return found
end
local function track_chunk(track)
  local _, chunk = reaper.GetTrackStateChunk(track, '', false)
  return chunk
end
local function fx_names(count, name_of)
  local names = {}
  for index = 0, count - 1 do
    local _, name = name_of(index)
    names[#names + 1] = name
  end
  return table.concat(names, ', ')
end
local function write_file(file, text)
  local handle = assert(io.open(file, 'wb'))
  handle:write(text)
  handle:close()
end
local function describe_piece(item)
  local take = reaper.GetActiveTake(item)
  local markers = {}
  for index = 0, reaper.GetNumTakeMarkers(take) - 1 do
    local srcpos, name = reaper.GetTakeMarker(take, index)
    markers[#markers + 1] = string.format('%s@%.3f', name, srcpos)
  end
  local _, line_id = reaper.GetSetMediaItemInfo_String(item, LINE_ID_KEY, '', false)
  local _, take_ext = reaper.GetSetMediaItemTakeInfo_String(take, TAKE_KEY, '', false)
  return string.format(
    'guid %s pos %.3f len %.3f soffs %.3f takeFX %d [%s] markers [%s] lineId %q takeExt %q fadeIn %.4f fadeOut %.4f autoIn %.4f autoOut %.4f',
    guid_of_item(item),
    reaper.GetMediaItemInfo_Value(item, 'D_POSITION'),
    reaper.GetMediaItemInfo_Value(item, 'D_LENGTH'),
    reaper.GetMediaItemTakeInfo_Value(take, 'D_STARTOFFS'),
    reaper.TakeFX_GetCount(take),
    fx_names(reaper.TakeFX_GetCount(take), function(index)
      return reaper.TakeFX_GetFXName(take, index, '')
    end),
    table.concat(markers, ' '),
    line_id,
    take_ext,
    reaper.GetMediaItemInfo_Value(item, 'D_FADEINLEN'),
    reaper.GetMediaItemInfo_Value(item, 'D_FADEOUTLEN'),
    reaper.GetMediaItemInfo_Value(item, 'D_FADEINLEN_AUTO'),
    reaper.GetMediaItemInfo_Value(item, 'D_FADEOUTLEN_AUTO')
  )
end

-- The body of an .RfxChain: what REAPER keeps inside a track's <FXCHAIN> from the first BYPASS line to the chain's own
-- closing '>', read from a scratch track that has the plug-in added through the API (so the text is REAPER's own).
local function chain_text_for(plugin)
  reaper.InsertTrackAtIndex(reaper.CountTracks(0), false)
  local scratch = reaper.GetTrack(0, reaper.CountTracks(0) - 1)
  assert(reaper.TrackFX_AddByName(scratch, plugin, false, -1) >= 0, 'could not add ' .. plugin .. ' to the scratch track')
  local lines, inside, depth = {}, false, 0
  for line in track_chunk(scratch):gmatch('[^\r\n]+') do
    local trimmed = line:match('^%s*(.-)%s*$')
    if not inside and trimmed:match('^<FXCHAIN') then
      inside, depth = true, 1
    elseif inside then
      if trimmed:sub(1, 1) == '<' then
        depth = depth + 1
      elseif trimmed == '>' then
        depth = depth - 1
        if depth == 0 then
          break
        end
      end
      if #lines > 0 or trimmed:match('^BYPASS') then
        lines[#lines + 1] = trimmed
      end
    end
  end
  reaper.DeleteTrack(scratch)
  assert(#lines > 0, 'the scratch track has no FX chain text')
  return table.concat(lines, '\n') .. '\n'
end

local ok, err = xpcall(function()
  log('version', reaper.GetAppVersion(), 'os', reaper.GetOS(), _VERSION)

  -----------------------------------------------------------------------
  section('Setup: a scratch project in -Out and FX chains in the isolated resource folder')
  -----------------------------------------------------------------------
  -- The plug-in name as the FX browser adds it; list_fx below reports the exact form EnumInstalledFX uses.
  local reaeq = 'ReaEQ'
  local chain_root = reaper.GetResourcePath() .. SEP .. 'FXChains'
  reaper.RecursiveCreateDirectory(chain_root .. SEP .. 'Voice' .. SEP .. 'Deep', 0)
  local chain_text = chain_text_for(reaeq)
  write_file(chain_root .. SEP .. 'Voice' .. SEP .. 'Test EQ.RfxChain', chain_text)
  write_file(chain_root .. SEP .. 'Voice' .. SEP .. 'Deep' .. SEP .. 'Other EQ.RfxChain', chain_text)
  write_file(chain_root .. SEP .. 'Voice' .. SEP .. 'notes.txt', 'not a chain\n')
  write_file(path('ReaEQ.RfxChain.txt'), chain_text)
  log('chain text written (a copy is ReaEQ.RfxChain.txt in -Out):', #chain_text, 'bytes')

  -- "Chapter 1": a two-take item at 10 s (take_a then take_b, take_a active) with a line id, and a trimmed item at 20 s
  -- (take_c from 0.5 s for 2.5 s) with a line id, take extension data and a take marker at 1.5 s of source time.
  -- "Chapter 2": one item, the witness for A10.
  local rpp = path('ep0-workspace.rpp')
  reaper.Main_OnCommand(40023, 0) -- File: New project
  reaper.Main_SaveProjectEx(0, rpp, 0)
  reaper.InsertTrackAtIndex(0, true)
  reaper.InsertTrackAtIndex(1, true)
  reaper.GetSetMediaTrackInfo_String(reaper.GetTrack(0, 0), 'P_NAME', 'Chapter 1', true)
  reaper.GetSetMediaTrackInfo_String(reaper.GetTrack(0, 1), 'P_NAME', 'Chapter 2', true)
  local function add_item(track, file, position, offset, length)
    local item = reaper.AddMediaItemToTrack(track)
    reaper.SetMediaItemInfo_Value(item, 'D_POSITION', position)
    reaper.SetMediaItemInfo_Value(item, 'D_LENGTH', length)
    local take = reaper.AddTakeToMediaItem(item)
    reaper.SetMediaItemTake_Source(take, reaper.PCM_Source_CreateFromFile(path('media' .. SEP .. file)))
    reaper.SetMediaItemTakeInfo_Value(take, 'D_STARTOFFS', offset)
    return item, take
  end
  local chapter1 = reaper.GetTrack(0, 0)
  local multi, first_take = add_item(chapter1, 'take_a.wav', 10, 0, 3)
  local second_take = reaper.AddTakeToMediaItem(multi)
  reaper.SetMediaItemTake_Source(second_take, reaper.PCM_Source_CreateFromFile(path('media' .. SEP .. 'take_b.wav')))
  reaper.SetActiveTake(first_take)
  reaper.GetSetMediaItemInfo_String(multi, LINE_ID_KEY, 'L-0001', true)
  local trimmed, trimmed_take = add_item(chapter1, 'take_c.wav', 20, 0.5, 2.5)
  reaper.GetSetMediaItemInfo_String(trimmed, LINE_ID_KEY, 'L-0002', true)
  reaper.GetSetMediaItemTakeInfo_String(trimmed_take, TAKE_KEY, 'finding-0001', true)
  reaper.SetTakeMarker(trimmed_take, -1, 'marker-1.5', 1.5)
  add_item(reaper.GetTrack(0, 1), 'take_a.wav', 5, 0, 3)
  local multi_guid, first_guid, second_guid = guid_of_item(multi), guid_of_take(first_take), guid_of_take(second_take)
  local trimmed_guid, trimmed_take_guid = guid_of_item(trimmed), guid_of_take(trimmed_take)
  reaper.Main_SaveProjectEx(0, rpp, 0)
  reaper.Main_openProject('noprompt:' .. rpp)
  local _, open_path = reaper.EnumProjects(-1, '')
  check(
    '0 the scratch project is open from -Out with an empty undo history',
    open_path:lower() == rpp:lower() and undo_label() == '',
    open_path .. " undo '" .. undo_label() .. "'"
  )
  chapter1 = reaper.GetTrack(0, 0)
  local chapter2 = reaper.GetTrack(0, 1)
  local _, chapter1_guid = reaper.GetSetMediaTrackInfo_String(chapter1, 'GUID', '', false)
  local witness = track_chunk(chapter2)
  local function witness_unchanged(label)
    check(label .. ' ... left "Chapter 2" unchanged (A10)', track_chunk(reaper.GetTrack(0, 1)) == witness)
  end

  -- The real bridge registry, with the real feature files, called the way the dispatcher calls a command.
  local bridge = dofile(REAPER_DIR .. SEP .. 'narration_ui_bridge.lua')
  local registry = bridge.new_registry()
  local core = dofile(REAPER_DIR .. SEP .. 'narration_bridge_core.lua')
  local events_path = path('events.log')
  os.remove(events_path)
  local read_offset = 0
  local function send(name, ...)
    local handler = assert(registry.lookup(name), name .. ' is not registered')
    handler({ session_dir = PACK, event = function() end, stop = function() end }, { ... })
    local handle = io.open(events_path, 'rb')
    local text = handle and handle:read('a') or ''
    if handle then
      handle:close()
    end
    local fresh = text:sub(read_offset + 1)
    read_offset = #text
    local events = {}
    for line in fresh:gmatch('[^\r\n]+') do
      events[#events + 1] = core.split(line, 32)
    end
    return events
  end
  local function first(events)
    return events[1] and table.concat(events[1], '|') or 'NO EVENT'
  end

  -----------------------------------------------------------------------
  section('A6 set_active_take: one undo point, and Undo restores the previous take')
  -----------------------------------------------------------------------
  local before = undo_label()
  local answer = send('set_active_take', 'r1', multi_guid, second_guid)
  log('answer', first(answer))
  check('A6.1 answers ACTIVE_TAKE_SET changed', answer[1] and answer[1][1] == 'ACTIVE_TAKE_SET' and answer[1][5] == '1', first(answer))
  multi = assert(find_item(multi_guid), 'the two-take item is gone')
  check('A6.2 take 2 plays', guid_of_take(reaper.GetActiveTake(multi)) == second_guid)
  check('A6.3 one undo point "Narration Utils: use take"', undo_label() == 'Narration Utils: use take', "'" .. before .. "' -> '" .. undo_label() .. "'")
  check('A6.4 the item length is unchanged', reaper.GetMediaItemInfo_Value(multi, 'D_LENGTH') == 3)
  local label_after_first = undo_label()
  answer = send('set_active_take', 'r2', multi_guid, second_guid)
  check('A6.5 again: answers unchanged and adds no undo point', answer[1] and answer[1][5] == '0' and undo_label() == label_after_first, first(answer))
  reaper.Main_OnCommand(40029, 0) -- Edit: Undo
  multi = assert(find_item(multi_guid), 'the two-take item is gone after Undo')
  check('A6.6 one Undo makes take 1 active again', guid_of_take(reaper.GetActiveTake(multi)) == first_guid, "undo now '" .. undo_label() .. "'")
  answer = send('set_active_take', 'r3', multi_guid, '{00000000-0000-0000-0000-000000000000}')
  check(
    'A6.7 a take that is not on the item answers ITEM_STALE take and changes nothing',
    answer[1] and answer[1][1] == 'ITEM_STALE' and answer[1][4] == 'take',
    first(answer)
  )
  witness_unchanged('A6')

  -----------------------------------------------------------------------
  section('A7 list_fx_chains and list_fx')
  -----------------------------------------------------------------------
  answer = send('list_fx_chains', 'r4')
  local chains = {}
  for _, line in ipairs(answer) do
    if line[1] == 'FX_CHAIN' then
      chains[#chains + 1] = line[3]
    end
  end
  log('chains', table.concat(chains, ' ; '), 'last', table.concat(answer[#answer] or {}, '|'))
  check(
    'A7.1 lists both chains by relative name with forward slashes',
    table.concat(chains, ';') == 'Voice/Deep/Other EQ.RfxChain;Voice/Test EQ.RfxChain',
    table.concat(chains, ';')
  )
  answer = send('list_fx', 'r5')
  local plugins, container, reaeq_name = 0, false, nil
  for _, line in ipairs(answer) do
    if line[1] == 'FX_PLUGIN' then
      plugins = plugins + 1
      container = container or line[3] == 'Container'
      if not reaeq_name and line[3]:find('ReaEQ', 1, true) then
        reaeq_name = line[3]
      end
    end
  end
  log('plug-ins listed', plugins, 'ReaEQ is listed as', tostring(reaeq_name))
  check('A7.2 lists ReaEQ and not the FX container', reaeq_name ~= nil and not container)
  reaeq_name = reaeq_name or reaeq

  -----------------------------------------------------------------------
  section('A8 apply_fx_chain: a chain by path onto a track and the master track')
  -----------------------------------------------------------------------
  local chapter1_items = reaper.CountTrackMediaItems(chapter1)
  answer = send('apply_fx_chain', 'r6', chapter1_guid, 'Voice/Test EQ.RfxChain')
  log(
    'answer',
    first(answer),
    'track FX',
    fx_names(reaper.TrackFX_GetCount(chapter1), function(index)
      return reaper.TrackFX_GetFXName(chapter1, index, '')
    end)
  )
  check(
    'A8.1 a chain loads onto a track by its full path',
    answer[1] and answer[1][1] == 'FX_CHAIN_APPLIED' and reaper.TrackFX_GetCount(chapter1) == 1,
    first(answer)
  )
  check('A8.2 into the FX chain, not the input FX', reaper.TrackFX_GetRecCount(chapter1) == 0)
  check('A8.3 one undo point for the track', undo_label() == 'Narration Utils: apply FX chain Voice/Test EQ.RfxChain to Chapter 1', undo_label())
  check('A8.4 no item was added or removed', reaper.CountTrackMediaItems(chapter1) == chapter1_items)
  local master = reaper.GetMasterTrack(0)
  answer = send('apply_fx_chain', 'r7', 'master', 'Voice/Test EQ.RfxChain')
  check('A8.5 and onto the master track', answer[1] and answer[1][1] == 'FX_CHAIN_APPLIED' and reaper.TrackFX_GetCount(master) == 1, first(answer))
  check('A8.6 one undo point for the master track', undo_label() == 'Narration Utils: apply FX chain Voice/Test EQ.RfxChain to the master track', undo_label())
  reaper.Main_OnCommand(40029, 0)
  reaper.Main_OnCommand(40029, 0)
  chapter1, master = reaper.GetTrack(0, 0), reaper.GetMasterTrack(0)
  check('A8.7 two Undos remove both', reaper.TrackFX_GetCount(chapter1) == 0 and reaper.TrackFX_GetCount(master) == 0)
  for _, name in ipairs({ 'Voice/Missing.RfxChain', '../reaper.ini', 'Voice/notes.txt' }) do
    local label = undo_label()
    answer = send('apply_fx_chain', 'r8', chapter1_guid, name)
    check(
      'A8.8 refuses ' .. name .. ' before anything changes',
      answer[1] and answer[1][1] == 'ERROR' and undo_label() == label and reaper.TrackFX_GetCount(chapter1) == 0,
      first(answer)
    )
  end
  witness_unchanged('A8')

  -----------------------------------------------------------------------
  section('A8b add_take_fx: split a passage and add one plug-in to the middle piece')
  -----------------------------------------------------------------------
  trimmed = assert(find_item(trimmed_guid), 'the trimmed item is gone')
  log('before', describe_piece(trimmed))
  local items_before = reaper.CountTrackMediaItems(chapter1)
  answer = send('add_take_fx', 'r9', trimmed_guid, trimmed_take_guid, '1.0', '2.0', reaeq_name)
  log('answer', first(answer), "undo '" .. undo_label() .. "'")
  check('A8b.1 answers TAKE_FX_ADDED with two splits', answer[1] and answer[1][1] == 'TAKE_FX_ADDED' and answer[1][6] == '2', first(answer))
  check('A8b.2 in one undo point', undo_label() == 'Narration Utils: add take FX ' .. reaeq_name, undo_label())
  chapter1 = reaper.GetTrack(0, 0)
  check('A8b.3 the track has two more items', reaper.CountTrackMediaItems(chapter1) == items_before + 2)
  local pieces = {}
  for _, item in ipairs(items_on(chapter1)) do
    if reaper.GetMediaItemInfo_Value(item, 'D_POSITION') >= 19.999 then
      pieces[#pieces + 1] = item
    end
  end
  for index, piece in ipairs(pieces) do
    log('piece', index, describe_piece(piece))
  end
  local middle_guid = answer[1] and answer[1][4] or ''
  if #pieces == 3 then
    local take_fx = function(piece)
      return reaper.TakeFX_GetCount(reaper.GetActiveTake(piece))
    end
    check('A8b.4 only the middle piece has the plug-in', take_fx(pieces[1]) == 0 and take_fx(pieces[2]) == 1 and take_fx(pieces[3]) == 0)
    check('A8b.5 the answer names the middle piece', guid_of_item(pieces[2]) == middle_guid, middle_guid)
    check('A8b.6 the left piece keeps the original GUID', guid_of_item(pieces[1]) == trimmed_guid)
    local all_stamped = true
    for _, piece in ipairs(pieces) do
      local _, line_id = reaper.GetSetMediaItemInfo_String(piece, LINE_ID_KEY, '', false)
      all_stamped = all_stamped and line_id == 'L-0002'
    end
    check('A8b.7 the line id is on all three pieces', all_stamped)
    check(
      'A8b.8 the middle piece starts at source 1.0 s',
      math.abs(reaper.GetMediaItemTakeInfo_Value(reaper.GetActiveTake(pieces[2]), 'D_STARTOFFS') - 1.0) < 0.0005
    )
  else
    check('A8b.4 three pieces at 20 s', false, #pieces)
  end
  local label_after_first_add = undo_label()
  local middle = assert(find_item(middle_guid), 'the middle piece is gone')
  answer = send('add_take_fx', 'r10', middle_guid, guid_of_take(reaper.GetActiveTake(middle)), '1.0', '2.0', reaeq_name)
  middle = assert(find_item(middle_guid), 'the middle piece is gone')
  check(
    'A8b.9 a second plug-in on the middle piece splits nothing',
    answer[1] and answer[1][6] == '0' and reaper.TakeFX_GetCount(reaper.GetActiveTake(middle)) == 2,
    first(answer)
  )
  reaper.Main_OnCommand(40029, 0)
  middle = find_item(middle_guid)
  check(
    'A8b.10 Undo removes the second plug-in',
    middle ~= nil and reaper.TakeFX_GetCount(reaper.GetActiveTake(middle)) == 1 and undo_label() == label_after_first_add
  )
  reaper.Main_OnCommand(40029, 0)
  chapter1 = reaper.GetTrack(0, 0)
  trimmed = find_item(trimmed_guid)
  check(
    'A8b.11 a second Undo rejoins the item',
    reaper.CountTrackMediaItems(chapter1) == items_before and trimmed ~= nil and math.abs(reaper.GetMediaItemInfo_Value(trimmed, 'D_LENGTH') - 2.5) < 0.0005
  )
  if trimmed then
    log('after undo', describe_piece(trimmed))
  end
  answer = send('add_take_fx', 'r11', trimmed_guid, trimmed_take_guid, '0.5', '3.0', reaeq_name)
  check('A8b.12 the whole item splits nothing', answer[1] and answer[1][1] == 'TAKE_FX_ADDED' and answer[1][6] == '0', first(answer))
  reaper.Main_OnCommand(40029, 0)
  local label = undo_label()
  answer = send('add_take_fx', 'r12', trimmed_guid, trimmed_take_guid, '1.0', '2.0', 'Voice/Test EQ.RfxChain')
  check('A8b.13 a chain name is refused on a passage', answer[1] and answer[1][1] == 'ERROR' and undo_label() == label, first(answer))
  answer = send('add_take_fx', 'r13', multi_guid, second_guid, '0.5', '1.0', reaeq_name)
  check('A8b.14 a take that does not play is refused', answer[1] and answer[1][1] == 'ERROR', first(answer))
  witness_unchanged('A8b')

  -----------------------------------------------------------------------
  section('Save and reload: a take FX added by the command survives in the .rpp')
  -----------------------------------------------------------------------
  answer = send('add_take_fx', 'r14', trimmed_guid, trimmed_take_guid, '1.0', '2.0', reaeq_name)
  middle_guid = answer[1] and answer[1][4] or ''
  reaper.Main_SaveProjectEx(0, rpp, 0)
  reaper.Main_openProject('noprompt:' .. rpp)
  middle = find_item(middle_guid)
  check(
    'S1 the middle piece and its plug-in are there after a reload',
    middle ~= nil and reaper.TakeFX_GetCount(reaper.GetActiveTake(middle)) == 1,
    middle_guid
  )
  local handle = io.open(rpp, 'rb')
  local saved = handle and handle:read('a') or ''
  if handle then
    handle:close()
  end
  check('S2 the saved project has a <TAKEFX> chunk', saved:find('<TAKEFX', 1, true) ~= nil)

  -----------------------------------------------------------------------
  section("REAPER's own peaks for a known tone (EP12 C, observation only)")
  -----------------------------------------------------------------------
  -- take_a.wav is a 220 Hz sine at 9000/32768 (0.2747) of full scale, 8 kHz mono. The host's peaks (measure.Peaks) give
  -- 0.2747 for every 20 ms bucket; this records what REAPER's peak builder answers for the same take.
  local witness_take = reaper.GetActiveTake(reaper.GetTrackMediaItem(reaper.GetTrack(0, 1), 0))
  if reaper.APIExists('GetMediaItemTake_Peaks') and reaper.APIExists('PCM_Source_BuildPeaks') then
    local source = reaper.GetMediaItemTake_Source(witness_take)
    if reaper.PCM_Source_BuildPeaks(source, 0) ~= 0 then
      for _ = 1, 200 do
        if reaper.PCM_Source_BuildPeaks(source, 1) == 0 then
          break
        end
      end
      reaper.PCM_Source_BuildPeaks(source, 2)
    end
    local buckets = 50
    local buffer = reaper.new_array(buckets * 2)
    local got = reaper.GetMediaItemTake_Peaks(witness_take, 50, 5, 1, buckets, 0, buffer)
    local count = got & 0xFFFFF
    local values = buffer.table()
    local low, high = math.huge, -math.huge
    for index = 1, count do
      high = math.max(high, values[index])
      low = math.min(low, values[buckets + index])
    end
    log(string.format('GetMediaItemTake_Peaks at 50/s for 1 s: %d buckets, max %.4f, min %.4f (raw return %d)', count, high, low, got))
  else
    log('GetMediaItemTake_Peaks or PCM_Source_BuildPeaks is not in this REAPER')
  end
end, debug.traceback)
if not ok then
  failed = failed + 1
  log('ERROR', err)
end
finish()
