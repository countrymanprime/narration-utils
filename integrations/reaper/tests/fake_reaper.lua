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
  self.reaper = self:build_api()
  return self
end

-- Model builders ---------------------------------------------------------------------------------------------------

function Fake:new_guid()
  local guid = make_guid(self.next_guid)
  self.next_guid = self.next_guid + 1
  return guid
end

function Fake:add_track(name, selected)
  local track = { name = name or 'Track', selected = selected or false, items = {}, guid = self:new_guid() }
  self.tracks[#self.tracks + 1] = track
  return track
end

-- opts: position, length, selected, guid, source (file name; nil = no take), startoffs, playrate, midi, notes, take_name
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

function Fake:insert_marker(marker)
  local used = {}
  for _, existing in ipairs(self.markers) do
    used[existing.index] = true
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

-- Makes `APIExists(name)` answer false, the way an older REAPER lacks a newer function.
function Fake:remove_api(name)
  self.missing_api[name] = true
end

-- Deferred queue --------------------------------------------------------------------------------------------------

-- Runs every function queued at the time of the call once (one REAPER "frame"). Functions queued while running
-- wait for the next call, exactly like reaper.defer.
function Fake:pump()
  local queue = self.deferred
  self.deferred = {}
  for _, fn in ipairs(queue) do
    fn()
  end
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
end

function Fake:add_take_api(api)
  function api.GetActiveTake(item)
    return item.takes[1]
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
  function api.SetTakeMarker(take, index, name, srcpos, color)
    local marker = { name = name or '', srcpos = srcpos or 0, color = color or 0 }
    if index < 0 then
      take.markers[#take.markers + 1] = marker
      return #take.markers - 1
    end
    take.markers[index + 1] = marker
    return index
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
    local marker = { is_region = is_region, pos = pos, rgnend = rgnend, name = name, color = color or 0 }
    if wantidx and wantidx >= 0 then
      marker.index = wantidx
      fake.markers[#fake.markers + 1] = marker
      table.sort(fake.markers, by_position)
      return wantidx
    end
    return fake:insert_marker(marker)
  end
end

function Fake:build_api()
  local api = {}
  self:add_project_api(api)
  self:add_item_api(api)
  self:add_take_api(api)
  self:add_marker_api(api)
  return api
end

return Fake
