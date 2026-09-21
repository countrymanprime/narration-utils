-- The fake `reaper` must return what REAPER returns, or every other test proves nothing. Each test below pins one
-- behaviour observed in a real REAPER 7.80 (scripted, isolated; integrations/reaper/spikes/build_cases.lua and
-- docs/research/reaper-spike-s0-item-extension-data.md). When a spike shows the fake is wrong, correct it here first.

local H = require('harness')
local Fake = require('fake_reaper')

local function api()
  local fake = Fake.new(host)
  return fake.reaper, fake
end

H.test('a missing item extension key reads as false and an empty string; a set key reads back', function()
  local reaper_api, fake = api()
  local item = fake:add_item(fake:add_track('T'), {})
  local ok, value = reaper_api.GetSetMediaItemInfo_String(item, 'P_EXT:narration_utils_line_id', '', false)
  H.eq({ ok, value }, { false, '' })
  H.eq({ reaper_api.GetSetMediaItemInfo_String(item, 'P_EXT:narration_utils_line_id', 'line-000001', true) }, { true, 'line-000001' })
  H.eq({ reaper_api.GetSetMediaItemInfo_String(item, 'P_EXT:narration_utils_line_id', '', false) }, { true, 'line-000001' })
end)

H.test('an item GUID is upper case in braces', function()
  local reaper_api, fake = api()
  local item = fake:add_item(fake:add_track('T'), {})
  local _, guid = reaper_api.GetSetMediaItemInfo_String(item, 'GUID', '', false)
  H.truthy(guid:match('^{%x+%-%x+%-%x+%-%x+%-%x+}$') and guid == guid:upper(), guid)
end)

H.test('markers and regions are numbered separately and enumerated by time, with index plus one as the first return', function()
  local reaper_api, fake = api()
  H.eq(reaper_api.AddProjectMarker2(0, false, 6.5, 0, 'PICKUP: a', -1, 0), 1)
  H.eq(reaper_api.AddProjectMarker2(0, false, 12.25, 0, 'PICKUP: b', -1, 0), 2)
  H.eq(reaper_api.AddProjectMarker2(0, true, 0, 11.9, 'Chapter 1', -1, 0), 1, 'the first region is region 1 even though two markers exist')
  H.eq(reaper_api.AddProjectMarker2(0, true, 12, 19.9, 'Chapter 2', -1, 0), 2)
  H.eq({ reaper_api.EnumProjectMarkers3(0, 0) }, { 1, true, 0, 11.9, 'Chapter 1', 1, 0 })
  H.eq({ reaper_api.EnumProjectMarkers3(0, 1) }, { 2, false, 6.5, 0, 'PICKUP: a', 1, 0 })
  H.eq({ reaper_api.EnumProjectMarkers3(0, 2) }, { 3, true, 12, 19.9, 'Chapter 2', 2, 0 })
  H.eq({ reaper_api.EnumProjectMarkers3(0, 3) }, { 4, false, 12.25, 0, 'PICKUP: b', 2, 0 })
  H.eq({ reaper_api.EnumProjectMarkers3(0, 4) }, { 0, false, 0, 0, '', 0, 0 }, 'past the end the first return is 0')
  H.eq(#fake.markers, 4)
end)

H.test('take markers are kept in source-time order, and SetTakeMarker returns the index the marker ended up at', function()
  local reaper_api, fake = api()
  local take = fake:add_item(fake:add_track('T'), { source = 'a.wav' }).takes[1]
  H.eq(reaper_api.SetTakeMarker(take, -1, 'z-late', 2.5, 0), 0)
  H.eq(reaper_api.SetTakeMarker(take, -1, 'a-early', 0.5, 0), 0, 'inserted before the existing one, so it is index 0')
  H.eq(reaper_api.GetNumTakeMarkers(take), 2)
  H.eq({ reaper_api.GetTakeMarker(take, 0) }, { 0.5, 'a-early', 0 })
  H.eq({ reaper_api.GetTakeMarker(take, 1) }, { 2.5, 'z-late', 0 })
  H.eq({ reaper_api.GetTakeMarker(take, 99) }, { -1, '', 0 }, 'an invalid index answers -1 and an empty name')
end)

H.test('ColorToNative packs blue-green-red on Windows, and an unsaved project has an empty path', function()
  local reaper_api, fake = api()
  H.eq(reaper_api.ColorToNative(255, 64, 64), 4210943)
  local project, path = reaper_api.EnumProjects(-1, '')
  H.truthy(project ~= nil)
  H.eq(path, '')
  fake.project_path = 'C:\\Book\\Book.rpp'
  H.eq(select(2, reaper_api.EnumProjects(-1, '')), 'C:\\Book\\Book.rpp')
end)

H.test('EnumerateFiles lists a cached snapshot until it is cleared with index -1', function()
  local reaper_api = api()
  local dir = host.tmpdir()
  H.write_file(H.join(dir, 'a.cmd'), 'x')
  H.eq(reaper_api.EnumerateFiles(dir, 0), 'a.cmd')
  H.write_file(H.join(dir, 'b.cmd'), 'x')
  H.eq(reaper_api.EnumerateFiles(dir, 1), nil, 'a file created after the first call is not listed yet')
  reaper_api.EnumerateFiles(dir, -1)
  local names = { reaper_api.EnumerateFiles(dir, 0), reaper_api.EnumerateFiles(dir, 1) }
  table.sort(names)
  H.eq(names, { 'a.cmd', 'b.cmd' })
  os.remove(H.join(dir, 'a.cmd'))
  H.truthy(reaper_api.EnumerateFiles(dir, 0) ~= nil and reaper_api.EnumerateFiles(dir, 1) ~= nil, 'a removed file is still listed until the cache is cleared')
end)
