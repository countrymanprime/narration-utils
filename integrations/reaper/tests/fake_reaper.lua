-- A fake `reaper` API table for the bridge harness: an in-memory project (tracks, items, takes, markers, regions,
-- item extension data, an undo log, a `defer` queue) exposing only the ReaScript functions the Narration Utils
-- scripts call. It mimics REAPER's return shapes (for example `EnumProjectMarkers3` returns idx + 1, `P_EXT` reads
-- return `false, ''` for a missing key), so a test drives the same code path REAPER would. It does not model audio.
--
-- Directory primitives that Lua's standard library lacks (`EnumerateFiles`, `RecursiveCreateDirectory`) come from
-- the `host` table the Python runner injects (see run_lua_tests.py).

local Fake = {}
Fake.__index = Fake

local function native_color(r, g, b)
  -- REAPER on Windows packs BGR; the bridge adds the custom-colour flag itself.
  return r + g * 256 + b * 65536
end

local function make_guid(n)
  return string.format('{%08X-0000-4000-8000-%012X}', n, n)
end

local function by_position(a, b)
  return a.pos < b.pos
end

function Fake.new(host)
  local self = setmetatable({}, Fake)
  self.host = host
  self.project_path = ''
  self.tracks = {}
  self.items = {}
  self.markers = {}
  self.cursor = 0
  self.undo = {}
  self.arrange_updates = 0
  self.listing_cache = {}
  self.stale_names = {}
  self.open_undo_blocks = 0
  self.deferred = {}
  self.missing_api = {}
  self.next_guid = 1
  self.calls = {}
  self.render_info = {}
  self.render_info_string = {}
  -- GetProjectStateChangeCount(0) - REAPER's own coarse edit counter (narration_project_state.lua). Starts at 0,
  -- like a freshly opened project; a test bumps it directly (`s.fake.change_count = s.fake.change_count + 1`) to
  -- model an edit, the way REAPER increments it on any change.
  self.change_count = 0
  -- Transport and loop state (narration_navigation.lua). A new project has an empty time selection and loop range
  -- (both 0..0), repeat off and the transport stopped. The time selection and the loop points are kept apart unless a
  -- test sets linked_loop: REAPER 7.80 links them by default (the Phase 6 check) but the link is a preference, so a
  -- bridge that wants repeat to loop a window must set both, and the unlinked fake proves it does.
  -- play_state is GetPlayState's bit field: 1 playing, 2 paused, 4 recording.
  self.time_selection = { 0, 0 }
  self.loop_points = { 0, 0 }
  self.repeat_on = 0
  self.play_state = 0
  -- GetPlayPosition (narration_track_state.lua): the what-you-hear position, set by a test.
  self.play_position = 0
  -- GetPlayPosition2 (narration_punch.lua): the position being processed, which REAPER documents as the one that has
  -- not yet passed the audio device's output latency. Spike S4 decides which of the two anchors a word; both are read.
  self.play_position2 = 0
  -- GetAudioDeviceInfo('IDENT_IN'): the open input device's name; nil when the device is closed (REAPER answers false).
  self.audio_input = nil
  self.exit_handlers = {}
  -- The master track (GetMasterTrack): not in self.tracks, as REAPER keeps it out of CountTracks/GetTrack. Its GUID is
  -- fixed so it never shifts the GUIDs the other tests' tracks and items get.
  self.master = { name = 'MASTER', items = {}, guid = '{0000FFFF-0000-4000-8000-00000000FFFE}', armed = false }
  -- EnumInstalledFX's list, in REAPER's order: { name = ..., ident = ... }. REAPER lists its video processor and the
  -- FX container among them (ident "Video processor", "Container"); a test sets what it needs.
  self.installed_fx = {}
  -- The Main section of REAPER's action list, in enumeration order: { id = command ID, name = action-list text }.
  -- Starts with a few real native actions (IDs confirmed in REAPER 7.80 by the S5 spike) so a lookup has to skip
  -- past non-matching entries; a test adds more with Fake:add_action.
  self.actions = {
    { id = 40012, name = 'Item: Split items at edit or play cursor (select right)' },
    { id = 40209, name = 'Item: Apply track/take FX to items' },
    { id = 42230, name = 'File: Render project, using the most recent render settings, auto-close render dialog' },
  }
  self.reaper = self:build_api()
  return self
end

-- Model builders ---------------------------------------------------------------------------------------------------

function Fake:new_guid()
  local guid = make_guid(self.next_guid)
  self.next_guid = self.next_guid + 1
  return guid
end

-- A track's record arm (I_RECARM) is `track.armed`; its record input (I_RECINPUT) is `track.rec_input`, 0 when unset.
function Fake:add_track(name, selected)
  local track = { name = name or 'Track', selected = selected or false, items = {}, guid = self:new_guid(), armed = false }
  self.tracks[#self.tracks + 1] = track
  return track
end

-- Puts a track in fixed item lane mode (I_FREEMODE 2) with `count` lanes. `plays` is the lane play state per lane
-- (0-based, REAPER's C_LANEPLAYS: 0 silent, 1 plays exclusively, 2 plays with others); every lane plays (2) when it
-- is omitted, which is what REAPER 7.80 read back after placing retakes on lanes in spike S7.
function Fake:set_fixed_lanes(track, count, plays)
  track.free_mode = 2
  track.lane_count = count
  track.lane_plays = {}
  for lane = 0, count - 1 do
    track.lane_plays[lane] = plays and plays[lane + 1] or 2
  end
end

-- opts: position, length, selected, guid, source (file name; nil = no take), startoffs, playrate, midi, notes,
-- take_name, lane (the item's fixed lane, I_FIXEDLANE; 0 when omitted)
function Fake:add_item(track, opts)
  opts = opts or {}
  local item = {
    track = track,
    position = opts.position or 0,
    length = opts.length or 1,
    selected = opts.selected or false,
    guid = opts.guid or self:new_guid(),
    ext = {},
    notes = opts.notes or '',
    takes = {},
    lane = opts.lane or 0,
  }
  if opts.source or opts.midi then
    item.takes[1] = {
      item = item,
      source = { file = opts.source or '' },
      startoffs = opts.startoffs or 0,
      playrate = opts.playrate == nil and 1 or opts.playrate,
      midi = opts.midi or false,
      name = opts.take_name or '',
      markers = {},
      ext = {},
      guid = opts.take_guid or self:new_guid(),
    }
  end
  track.items[#track.items + 1] = item
  table.sort(track.items, function(a, b)
    return a.position < b.position
  end)
  self.items[#self.items + 1] = item
  return item
end

function Fake:add_region(first, last, name)
  self:insert_marker({ is_region = true, pos = first, rgnend = last, name = name, color = 0 })
end

-- Markers and regions are numbered separately (REAPER 7.80: marker 1 and region 1 can both exist).
function Fake:insert_marker(marker)
  local used = {}
  for _, existing in ipairs(self.markers) do
    if existing.is_region == marker.is_region then
      used[existing.index] = true
    end
  end
  local index = 1
  while used[index] do
    index = index + 1
  end
  marker.index = index
  self.markers[#self.markers + 1] = marker
  table.sort(self.markers, by_position)
  return index
end

-- Splits an item at `at` (project seconds) the way REAPER does: the new right half is a new item with a new GUID,
-- and both halves keep the extension data. Returns the right half.
function Fake:split_item(item, at)
  local file = item.takes[1] and item.takes[1].source.file
  local right = self:add_item(item.track, { position = at, length = item.position + item.length - at, source = file })
  item.length = at - item.position
  for key, value in pairs(item.ext) do
    right.ext[key] = value
  end
  return right
end

-- Lists `name` in `directory` although the file is gone, the way a cached REAPER listing does after a file was removed.
function Fake:add_stale_listing(directory, name)
  self.stale_names[directory] = self.stale_names[directory] or {}
  table.insert(self.stale_names[directory], name)
end

-- Adds an action to the Main section of the action list (a native action, or a script such as
-- "Script: Magnolius_DeClick.lua" once the narrator has loaded it).
function Fake:add_action(id, name)
  self.actions[#self.actions + 1] = { id = id, name = name }
end

-- Makes `APIExists(name)` answer false, the way an older REAPER lacks a newer function.
function Fake:remove_api(name)
  self.missing_api[name] = true
end

-- Mirrors what the S5 spike observed in a real REAPER (docs/research/reaper-spike-s5-render-details.md): reading
-- RENDER_TARGETS predicts one file per region, named `<folder>/<region name>.wav`, only when RENDER_PATTERN is
-- literally "$region" and RENDER_BOUNDSFLAG is 3 ("all regions"); any other configuration predicts nothing.
function Fake:render_targets()
  if self.render_info_string['RENDER_PATTERN'] ~= '$region' or self.render_info['RENDER_BOUNDSFLAG'] ~= 3 then
    return ''
  end
  local folder = self.render_info_string['RENDER_FILE'] or ''
  local names = {}
  for _, marker in ipairs(self.markers) do
    if marker.is_region then
      names[#names + 1] = folder .. '/' .. marker.name .. '.wav'
    end
  end
  return table.concat(names, ';')
end

-- Deferred queue --------------------------------------------------------------------------------------------------

-- Runs every function queued at the time of the call once (one REAPER "frame"). Functions queued while running
-- wait for the next call, exactly like reaper.defer.
function Fake:pump()
  if self.record_pending then
    self.record_pending = self.record_pending - 1
    if self.record_pending <= 0 then
      self.record_pending = nil
      self.play_state = 5
    end
  end
  local queue = self.deferred
  self.deferred = {}
  for _, fn in ipairs(queue) do
    fn()
  end
end

-- Ends the script the way REAPER does when the narrator terminates it or quits: every reaper.atexit handler runs once.
function Fake:exit()
  local handlers = self.exit_handlers
  self.exit_handlers = {}
  for _, fn in ipairs(handlers) do
    fn()
  end
end

-- The transport buttons pressed, in order (OnPlayButton, OnStopButton).
function Fake:transport_calls()
  local out = {}
  for _, call in ipairs(self.calls) do
    if call.name == 'OnPlayButton' or call.name == 'OnStopButton' then
      out[#out + 1] = call.name
    end
  end
  return out
end

function Fake:undo_labels()
  local labels = {}
  for _, entry in ipairs(self.undo) do
    labels[#labels + 1] = entry.label
  end
  return labels
end

-- REAPER enumerates project items by track, then by position; a test that adds them in another order must not see
-- insertion order.
function Fake:ordered_items()
  local out = {}
  for _, track in ipairs(self.tracks) do
    for _, item in ipairs(track.items) do
      out[#out + 1] = item
    end
  end
  return out
end

function Fake:selected_items()
  local out = {}
  for _, item in ipairs(self:ordered_items()) do
    if item.selected then
      out[#out + 1] = item
    end
  end
  return out
end

function Fake:selected_tracks()
  local out = {}
  for _, track in ipairs(self.tracks) do
    if track.selected then
      out[#out + 1] = track
    end
  end
  return out
end

-- The API table ---------------------------------------------------------------------------------------------------

function Fake:add_project_api(api)
  local fake = self
  function api.APIExists(name)
    return api[name] ~= nil and not fake.missing_api[name]
  end
  function api.EnumProjects(index, _)
    if index == -1 then
      return fake, fake.project_path
    end
    return nil, ''
  end
  function api.GetResourcePath()
    return fake.resource_path or ''
  end
  function api.GetProjectStateChangeCount(_)
    return fake.change_count
  end
  function api.get_action_context()
    return true, fake.action_path or '', 0, 0, 0, 0
  end
  function api.GetOS()
    return fake.os_name or 'Win64'
  end
  function api.time_precise()
    fake.clock = (fake.clock or 1000) + 1
    return fake.clock
  end
  function api.ShowMessageBox(text, title, kind)
    fake.calls[#fake.calls + 1] = { name = 'ShowMessageBox', text = text, title = title, kind = kind }
    return 1
  end
  function api.ExecProcess(command, timeout)
    fake.calls[#fake.calls + 1] = { name = 'ExecProcess', command = command, timeout = timeout }
    return ''
  end
  function api.defer(fn)
    fake.deferred[#fake.deferred + 1] = fn
    return true
  end
  -- Like REAPER: the listing is CACHED per directory and only `EnumerateFiles(dir, -1)` re-reads it (seen in REAPER
  -- 7.80: a file created after the first call stays invisible, and a removed one stays listed, until it is cleared).
  -- REAPER promises no order and lists files only, so the fake hands names back last-name-first: a bridge that relies
  -- on the listing being sorted must sort it itself.
  function api.EnumerateFiles(directory, index)
    if index == -1 then
      fake.listing_cache[directory] = nil
      return nil
    end
    local names = fake.listing_cache[directory]
    if not names then
      names = {}
      local listed = fake.host.listdir(directory)
      for position = #listed, 1, -1 do
        names[#names + 1] = listed[position]
      end
      for _, stale in ipairs(fake.stale_names[directory] or {}) do
        names[#names + 1] = stale
      end
      fake.listing_cache[directory] = names
    end
    return names[index + 1]
  end
  -- Subdirectories are cached like files (REAPER documents the same -1 re-read for both) and handed back in reverse
  -- order, so a caller that needs an order must sort.
  function api.EnumerateSubdirectories(directory, index)
    local key = 'dirs:' .. directory
    if index == -1 then
      fake.listing_cache[key] = nil
      return nil
    end
    local names = fake.listing_cache[key]
    if not names then
      names = {}
      local listed = fake.host.listsubdirs(directory)
      for position = #listed, 1, -1 do
        names[#names + 1] = listed[position]
      end
      fake.listing_cache[key] = names
    end
    return names[index + 1]
  end
  function api.PreventUIRefresh(delta)
    fake.ui_refresh_hold = (fake.ui_refresh_hold or 0) + delta
  end
  function api.RecursiveCreateDirectory(path, _)
    return fake.host.makedirs(path)
  end
  function api.UpdateArrange()
    fake.arrange_updates = fake.arrange_updates + 1
  end
  function api.ColorToNative(r, g, b)
    return native_color(r, g, b)
  end
  function api.Undo_BeginBlock2(_)
    fake.open_undo_blocks = fake.open_undo_blocks + 1
  end
  function api.Undo_EndBlock2(_, label, flags)
    if fake.open_undo_blocks == 0 then
      error('fake reaper: Undo_EndBlock2 without Undo_BeginBlock2')
    end
    fake.open_undo_blocks = fake.open_undo_blocks - 1
    fake.undo[#fake.undo + 1] = { label = label, flags = flags }
  end
  function api.Undo_OnStateChange(label)
    fake.undo[#fake.undo + 1] = { label = label }
  end
  -- Records every call in fake.calls: narration_render.lua's harness tests assert this is never invoked, since the
  -- S5 spike proved it (or a real render action's ID passed to the RENDER_STATS getter, below) can actually
  -- trigger a render.
  function api.Main_OnCommand(command_id, flag)
    fake.calls[#fake.calls + 1] = { name = 'Main_OnCommand', command_id = command_id, flag = flag }
    return true
  end
  -- The action list (narration_cleanup.lua). Per the ReaScript docs (not yet checked in a real REAPER: see
  -- docs/research/reaper-cleanup-launchers.md): SectionFromUniqueID(0) is the Main section, and
  -- kbd_enumerateActions(section, index) answers the command ID and the action-list text, or 0 past the end.
  local main_section = { unique_id = 0 }
  function api.SectionFromUniqueID(unique_id)
    if unique_id == 0 then
      return main_section
    end
    return nil
  end
  function api.kbd_enumerateActions(section, index)
    fake.calls[#fake.calls + 1] = { name = 'kbd_enumerateActions', index = index }
    if section ~= main_section then
      return 0, ''
    end
    local action = fake.actions[index + 1]
    if not action then
      return 0, ''
    end
    return action.id, action.name
  end
  -- The numeric project-info keys (RENDER_BOUNDSFLAG, RENDER_ADDTOPROJ, ...). Every call is recorded in fake.calls
  -- the same way Main_OnCommand is, so a test can assert which keys were touched.
  function api.GetSetProjectInfo(_, key, value, set)
    fake.calls[#fake.calls + 1] = { name = 'GetSetProjectInfo', key = key, value = value, set = set }
    if set then
      fake.render_info[key] = value
      return true
    end
    return fake.render_info[key] or 0
  end
  -- The string project-info keys (RENDER_FILE, RENDER_PATTERN, RENDER_TARGETS, RENDER_STATS, ...). RENDER_TARGETS
  -- is computed (Fake:render_targets), matching what a real REAPER predicts before any render runs; every other
  -- key is a plain store/read, matching the S5 spike's finding that RENDER_PATTERN reads back literally, not
  -- resolved.
  function api.GetSetProjectInfo_String(_, key, value, set)
    fake.calls[#fake.calls + 1] = { name = 'GetSetProjectInfo_String', key = key, value = value, set = set }
    if key == 'RENDER_TARGETS' then
      return true, fake:render_targets()
    end
    if set then
      fake.render_info_string[key] = value
      return true, value
    end
    return true, fake.render_info_string[key] or ''
  end
end

-- Transport, time selection, loop points and repeat (narration_navigation.lua).
function Fake:add_transport_api(api)
  local fake = self
  -- GetSet_LoopTimeRange2(proj, isSet, isLoop, start, end, allowautoseek): isLoop picks the loop points over the time
  -- selection; it answers the (new) start and end either way.
  -- With fake.linked_loop (REAPER 7.80's default, "Loop points linked to time selection", seen in the Phase 6 check),
  -- setting either one sets both.
  function api.GetSet_LoopTimeRange2(_, is_set, is_loop, first, last, _)
    local range = is_loop and fake.loop_points or fake.time_selection
    if is_set then
      range[1], range[2] = first, last
      if fake.linked_loop then
        local other = is_loop and fake.time_selection or fake.loop_points
        other[1], other[2] = first, last
      end
    end
    return range[1], range[2]
  end
  -- GetSetRepeat(val): -1 asks, 0 clears, 1 sets, anything above 1 toggles; it answers the (new) state.
  function api.GetSetRepeat(value)
    if value == 0 or value == 1 then
      fake.repeat_on = value
    elseif value > 1 then
      fake.repeat_on = 1 - fake.repeat_on
    end
    return fake.repeat_on
  end
  function api.GetPlayState()
    return fake.play_state
  end
  function api.GetPlayPosition()
    return fake.play_position
  end
  function api.GetPlayPosition2()
    return fake.play_position2
  end
  -- GetAudioDeviceInfo(attribute): false when the attribute is unknown or no device is open, like REAPER.
  function api.GetAudioDeviceInfo(attribute)
    if attribute == 'IDENT_IN' and fake.audio_input then
      return true, fake.audio_input
    end
    return false, ''
  end
  function api.OnPlayButton()
    fake.calls[#fake.calls + 1] = { name = 'OnPlayButton' }
    fake.play_state = 1
  end
  -- CSurf_OnRecord toggles recording ("Toggles recording on and off. Starts recording from edit-cursor-position."). A
  -- test sets fake.record_fails to model a REAPER that did not start (no input, a dialog in the way), or
  -- fake.record_delay_ticks to have GetPlayState report recording only that many defer cycles later.
  function api.CSurf_OnRecord()
    fake.calls[#fake.calls + 1] = { name = 'CSurf_OnRecord' }
    if math.floor(fake.play_state / 4) % 2 == 1 then
      fake.play_state = 0
    elseif fake.record_delay_ticks then
      fake.record_pending = fake.record_delay_ticks
    elseif not fake.record_fails then
      fake.play_state = 5
    end
  end
  function api.OnStopButton()
    fake.calls[#fake.calls + 1] = { name = 'OnStopButton' }
    fake.play_state = 0
  end
  function api.GetTrackGUID(track)
    return track.guid
  end
  function api.atexit(fn)
    fake.exit_handlers[#fake.exit_handlers + 1] = fn
  end
end

function Fake:add_item_api(api)
  local fake = self
  function api.CountSelectedMediaItems(_)
    return #fake:selected_items()
  end
  function api.GetSelectedMediaItem(_, index)
    return fake:selected_items()[index + 1]
  end
  function api.CountSelectedTracks(_)
    return #fake:selected_tracks()
  end
  function api.GetSelectedTrack(_, index)
    return fake:selected_tracks()[index + 1]
  end
  function api.CountMediaItems(_)
    return #fake:ordered_items()
  end
  function api.GetMediaItem(_, index)
    return fake:ordered_items()[index + 1]
  end
  function api.CountTrackMediaItems(track)
    return #track.items
  end
  function api.GetTrackMediaItem(track, index)
    return track.items[index + 1]
  end
  function api.CountTracks(_)
    return #fake.tracks
  end
  function api.GetTrack(_, index)
    return fake.tracks[index + 1]
  end
  function api.GetMasterTrack(_)
    return fake.master
  end
  function api.EnumInstalledFX(index)
    local fx = fake.installed_fx[index + 1]
    if not fx then
      return false, '', ''
    end
    return true, fx.name, fx.ident
  end
  -- Track FX (apply_fx_chain): a chain adds fake.chain_fx_count FX (1 unless set); fake.fx_load_fails refuses it.
  function api.TrackFX_AddByName(track, name, rec_fx, instantiate)
    fake.calls[#fake.calls + 1] = { name = 'TrackFX_AddByName', fx = name, rec_fx = rec_fx, instantiate = instantiate }
    if fake.fx_load_fails then
      return -1
    end
    track.fx = track.fx or {}
    local first = #track.fx
    for _ = 1, fake.chain_fx_count or 1 do
      track.fx[#track.fx + 1] = { name = name }
    end
    return first
  end
  function api.TrackFX_GetCount(track)
    return #(track.fx or {})
  end
  function api.GetMediaItem_Track(item)
    return item.track
  end
  function api.GetTrackName(track)
    return true, track.name
  end
  function api.GetMediaItemInfo_Value(item, key)
    if key == 'D_POSITION' then
      return item.position
    elseif key == 'D_LENGTH' then
      return item.length
    elseif key == 'I_FIXEDLANE' then
      return item.lane
    elseif key == 'C_LANEPLAYS' then
      return fake:lane_plays(item.track, item.lane)
    end
    error('fake reaper: unmodelled item value ' .. tostring(key))
  end
  function api.SelectAllMediaItems(_, selected)
    for _, item in ipairs(fake.items) do
      item.selected = selected
    end
  end
  function api.SetMediaItemSelected(item, selected)
    item.selected = selected
  end
  function api.SetEditCurPos(position, moveview, seekplay)
    fake.cursor, fake.cursor_moveview, fake.cursor_seekplay = position, moveview, seekplay
  end
  function api.GetCursorPosition()
    return fake.cursor or 0
  end
  -- GUID and extension data. A missing P_EXT key reads as `false, ''`, like REAPER.
  function api.GetSetMediaItemInfo_String(item, key, value, set)
    if key == 'GUID' then
      if set then
        item.guid = value
      end
      return true, item.guid
    end
    local ext = key:match('^P_EXT:(.+)$')
    if ext then
      if set then
        item.ext[ext] = value
        return true, value
      end
      local current = item.ext[ext]
      if current == nil then
        return false, ''
      end
      return true, current
    end
    if key == 'P_NOTES' then
      if set then
        item.notes = value
      end
      return true, item.notes
    end
    return false, ''
  end
  -- Forgets the item's reference to its take(s): the source file on disk is never touched, matching REAPER's own
  -- documented behaviour (narration_cleanup_preview.lua's apply_cleanup_trims). Returns true when found, like REAPER.
  function api.DeleteTrackMediaItem(track, item)
    for index, candidate in ipairs(track.items) do
      if candidate == item then
        table.remove(track.items, index)
        for global_index, global_item in ipairs(fake.items) do
          if global_item == item then
            table.remove(fake.items, global_index)
            break
          end
        end
        return true
      end
    end
    return false
  end
end

function Fake:add_take_api(api)
  local fake = self
  function api.GetActiveTake(item)
    return item.takes[item.active_index or 1]
  end
  function api.TakeIsMIDI(take)
    return take.midi
  end
  function api.GetMediaItemTake_Source(take)
    return take.source
  end
  function api.GetMediaSourceFileName(source, _)
    return source.file
  end
  function api.GetMediaItemTakeInfo_Value(take, key)
    if key == 'D_STARTOFFS' then
      return take.startoffs
    elseif key == 'D_PLAYRATE' then
      return take.playrate
    end
    error('fake reaper: unmodelled take value ' .. tostring(key))
  end
  -- The setter counterpart of GetMediaItemTakeInfo_Value: only D_STARTOFFS is modelled (the take-review
  -- source-offset alignment, Q4). Item D_LENGTH has no setter here on purpose - nothing in this bridge may touch it.
  function api.SetMediaItemTakeInfo_Value(take, key, value)
    if key == 'D_STARTOFFS' then
      take.startoffs = value
      return true
    end
    error('fake reaper: unmodelled take value setter ' .. tostring(key))
  end
  -- CountTakes/GetTake enumerate every take of an item (not just the active one), the way take-review's create_take
  -- re-resolves a newly added take by GUID after Undo_EndBlock2.
  function api.CountTakes(item)
    return #item.takes
  end
  function api.GetTake(item, index)
    return item.takes[index + 1]
  end
  -- AddTakeToMediaItem appends a new, inactive take (REAPER: it never touches I_CURTAKE - the previously active
  -- take stays active, confirmed by the take-mechanics spike). SetActiveTake (set_active_take, narration_workspace.lua)
  -- records every call in fake.calls, so a test of any other command can assert it never switched the active take.
  function api.AddTakeToMediaItem(item)
    local take = { item = item, source = { file = '' }, startoffs = 0, playrate = 1, midi = false, name = '', markers = {}, ext = {}, guid = fake:new_guid() }
    item.takes[#item.takes + 1] = take
    return take
  end
  function api.SetActiveTake(take)
    fake.calls[#fake.calls + 1] = { name = 'SetActiveTake' }
    for index, candidate in ipairs(take.item.takes) do
      if candidate == take then
        take.item.active_index = index
      end
    end
  end
  function api.UpdateItemInProject(_)
    fake.item_updates = (fake.item_updates or 0) + 1
  end
  -- Take FX (apply_fx_chain). A chain file adds one FX per `fake.chain_fx_count` (1 unless a test sets it); a test sets
  -- fake.fx_load_fails to model REAPER refusing the file. Every call is recorded in fake.calls.
  function api.TakeFX_AddByName(take, name, instantiate)
    fake.calls[#fake.calls + 1] = { name = 'TakeFX_AddByName', fx = name, instantiate = instantiate }
    if fake.fx_load_fails then
      return -1
    end
    take.fx = take.fx or {}
    local first = #take.fx
    for _ = 1, fake.chain_fx_count or 1 do
      take.fx[#take.fx + 1] = { name = name }
    end
    return first
  end
  function api.TakeFX_GetCount(take)
    return #(take.fx or {})
  end
  -- SplitMediaItem the way REAPER documents it: the original item becomes the left half and the right half is a new
  -- item (new GUID) returned, or nil when the position is not strictly inside the item. Both halves keep the item's
  -- extension data and every take (the right half's takes get new GUIDs and a source offset moved by the split), with
  -- the same take active and each take's FX copied.
  function api.SplitMediaItem(item, at)
    fake.calls[#fake.calls + 1] = { name = 'SplitMediaItem', at = at }
    if at <= item.position or at >= item.position + item.length then
      return nil
    end
    local right = fake:add_item(item.track, { position = at, length = item.position + item.length - at })
    right.active_index = item.active_index
    for key, value in pairs(item.ext) do
      right.ext[key] = value
    end
    for index, take in ipairs(item.takes) do
      local copy =
        { item = right, source = take.source, playrate = take.playrate, midi = take.midi, name = take.name, markers = {}, ext = {}, guid = fake:new_guid() }
      copy.startoffs = take.startoffs + (at - item.position) * take.playrate
      copy.fx = {}
      for _, fx in ipairs(take.fx or {}) do
        copy.fx[#copy.fx + 1] = { name = fx.name }
      end
      right.takes[index] = copy
    end
    item.length = at - item.position
    return right
  end
  function api.SetMediaItemTake_Source(take, source)
    take.source = source
  end
  -- PCM_Source_CreateFromFile does not check the file exists here; the fake's source is an opaque handle, the same
  -- way REAPER's is. create_take checks the file itself (core.file_exists) before calling this.
  function api.PCM_Source_CreateFromFile(path)
    return { file = path }
  end
  -- GUID and take-level extension data (ADR 0098, extending ADR 0026's item-level P_EXT to take granularity). A
  -- missing P_EXT key reads as `false, ''`, like REAPER, and like the item-level function above.
  function api.GetSetMediaItemTakeInfo_String(take, key, value, set)
    if key == 'GUID' then
      if set then
        take.guid = value
      end
      return true, take.guid
    end
    local ext = key:match('^P_EXT:(.+)$')
    if ext then
      if set then
        take.ext[ext] = value
        return true, value
      end
      local current = take.ext[ext]
      if current == nil then
        return false, ''
      end
      return true, current
    end
    return false, ''
  end
  function api.GetNumTakeMarkers(take)
    return #take.markers
  end
  function api.GetTakeMarker(take, index)
    local marker = take.markers[index + 1]
    if not marker then
      return -1, '', 0
    end
    return marker.srcpos, marker.name, marker.color
  end
  -- Take markers stay ordered by source position, and the return value is the index the marker ended up at.
  function api.SetTakeMarker(take, index, name, srcpos, color)
    local marker = { name = name or '', srcpos = srcpos or 0, color = color or 0 }
    if index >= 0 then
      table.remove(take.markers, index + 1)
    end
    take.markers[#take.markers + 1] = marker
    table.sort(take.markers, function(a, b)
      return a.srcpos < b.srcpos
    end)
    for position, candidate in ipairs(take.markers) do
      if candidate == marker then
        return position - 1
      end
    end
  end
end

function Fake:add_marker_api(api)
  local fake = self
  function api.EnumProjectMarkers3(_, index)
    local marker = fake.markers[index + 1]
    if not marker then
      return 0, false, 0, 0, '', 0, 0
    end
    return index + 1, marker.is_region, marker.pos, marker.rgnend, marker.name, marker.index, marker.color
  end
  function api.AddProjectMarker2(_, is_region, pos, rgnend, name, wantidx, color)
    if fake.add_marker_fails then
      return -1
    end
    local marker = { is_region = is_region, pos = pos, rgnend = rgnend, name = name, color = color or 0 }
    if wantidx and wantidx >= 0 then
      marker.index = wantidx
      fake.markers[#fake.markers + 1] = marker
      table.sort(fake.markers, by_position)
      return wantidx
    end
    return fake:insert_marker(marker)
  end
  -- Renames or repositions a marker or region found by its markrgnindexnumber (the sixth EnumProjectMarkers3
  -- return value); unlike SetProjectMarker4 it cannot clear a name, which none of this bridge's callers need
  -- (research: `reaper-automation-surface.md:97`).
  -- SetProjectMarker4: color 0 leaves the colour unchanged; flags & 1 clears the name (never used by this bridge).
  function api.SetProjectMarker4(_, markrgnindexnumber, is_region, pos, rgnend, name, color, flags)
    fake.calls[#fake.calls + 1] = { name = 'SetProjectMarker4', index = markrgnindexnumber }
    for _, marker in ipairs(fake.markers) do
      if marker.index == markrgnindexnumber and marker.is_region == is_region then
        marker.pos, marker.rgnend, marker.name = pos, rgnend, (flags or 0) % 2 == 1 and '' or name
        if color and color ~= 0 then
          marker.color = color
        end
        table.sort(fake.markers, by_position)
        return true
      end
    end
    return false
  end
  function api.SetProjectMarker3(_, markrgnindexnumber, is_region, pos, rgnend, name, color)
    for _, marker in ipairs(fake.markers) do
      if marker.index == markrgnindexnumber and marker.is_region == is_region then
        marker.pos, marker.rgnend, marker.name, marker.color = pos, rgnend, name, color or marker.color
        table.sort(fake.markers, by_position)
        return true
      end
    end
    return false
  end
end

-- The lane play state REAPER reads back for one lane of a track (track C_LANEPLAYS:<lane>). A track not in fixed-lane
-- mode has one lane, and it plays (1), as spike S7 read before lanes were turned on.
function Fake:lane_plays(track, lane)
  if not track.lane_plays then
    return lane == 0 and 1 or 0
  end
  return track.lane_plays[lane] or 0
end

-- Applies a lane play state the way REAPER 7.80 did in spike S7 (docs/research/reaper-spike-s7-fixed-lanes.md):
-- 1 makes the lane the only one playing (every other lane reads 0), 2 adds it alongside the others (a lane that
-- played exclusively reads 2 from then on), 0 silences it, even when it was the only lane playing.
function Fake:set_lane_plays(track, lane, value)
  if value == 1 then
    for other in pairs(track.lane_plays) do
      track.lane_plays[other] = 0
    end
  elseif value == 2 then
    for other, state in pairs(track.lane_plays) do
      if state == 1 then
        track.lane_plays[other] = 2
      end
    end
  end
  track.lane_plays[lane] = value
end

-- Fixed item lanes (narration_retake_lanes.lua). Every setter call is recorded in fake.calls, like Main_OnCommand,
-- so a test can assert the one value a command changed. The item-level C_LANEPLAYS setter is modelled with the
-- effect S7 saw (it is documented as read-only), so a command that used it would be caught by the recorded call.
function Fake:add_lane_api(api)
  local fake = self
  function api.GetMediaTrackInfo_Value(track, key)
    if key == 'I_FREEMODE' then
      return track.free_mode or 0
    elseif key == 'I_NUMFIXEDLANES' then
      return track.lane_count or 1
    elseif key == 'I_RECARM' then
      return track.armed and 1 or 0
    elseif key == 'I_RECINPUT' then
      return track.rec_input or 0
    end
    local lane = key:match('^C_LANEPLAYS:(%d+)$')
    if lane then
      return fake:lane_plays(track, tonumber(lane))
    end
    error('fake reaper: unmodelled track value ' .. tostring(key))
  end
  function api.SetMediaTrackInfo_Value(track, key, value)
    fake.calls[#fake.calls + 1] = { name = 'SetMediaTrackInfo_Value', key = key, value = value }
    local lane = key:match('^C_LANEPLAYS:(%d+)$')
    if lane and track.lane_plays then
      fake:set_lane_plays(track, tonumber(lane), value)
    elseif key == 'I_FREEMODE' then
      track.free_mode = value
    elseif key == 'I_NUMFIXEDLANES' then
      track.lane_count = value
    elseif key == 'I_RECARM' then
      track.armed = value ~= 0
    elseif not lane then
      error('fake reaper: unmodelled track value setter ' .. tostring(key))
    end
    return true
  end
  function api.SetMediaItemInfo_Value(item, key, value)
    fake.calls[#fake.calls + 1] = { name = 'SetMediaItemInfo_Value', key = key, value = value }
    if key == 'I_FIXEDLANE' then
      item.lane = value
    elseif key == 'C_LANEPLAYS' and item.track.lane_plays then
      fake:set_lane_plays(item.track, item.lane, value)
    else
      error('fake reaper: unmodelled item value setter ' .. tostring(key))
    end
    return true
  end
  function api.UpdateTimeline()
    fake.timeline_updates = (fake.timeline_updates or 0) + 1
  end
end

function Fake:build_api()
  local api = {}
  self:add_project_api(api)
  self:add_item_api(api)
  self:add_take_api(api)
  self:add_marker_api(api)
  self:add_transport_api(api)
  self:add_lane_api(api)
  return api
end

return Fake
