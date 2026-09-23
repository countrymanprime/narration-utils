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

H.test('with the default link the time selection and the loop points move together, and GetSetRepeat asks, sets and toggles', function()
  -- REAPER 7.80, the review-dashboard Phase 6 check (integrations/reaper/spikes/results/navigation-check-report.txt):
  -- setting only the loop points moved the time selection, and setting only the time selection moved the loop points.
  local reaper_api, fake = api()
  fake.linked_loop = true
  reaper_api.GetSet_LoopTimeRange2(0, true, true, 0.5, 2.5, false)
  H.eq({ reaper_api.GetSet_LoopTimeRange2(0, false, false, 0, 0, false) }, { 0.5, 2.5 })
  reaper_api.GetSet_LoopTimeRange2(0, true, false, 1, 2, false)
  H.eq({ reaper_api.GetSet_LoopTimeRange2(0, false, true, 0, 0, false) }, { 1, 2 })
  H.eq({ reaper_api.GetSetRepeat(-1), reaper_api.GetSetRepeat(1), reaper_api.GetSetRepeat(2), reaper_api.GetSetRepeat(0) }, { 0, 1, 0, 0 })
end)

-- Spike S7 (REAPER 7.80, docs/research/reaper-spike-s7-fixed-lanes.md): track C_LANEPLAYS:N=1 silences every other
-- lane, =2 adds a lane alongside (the exclusive one reads 2 from then on), and =0 on the only playing lane leaves no
-- lane playing.
H.test('a lane play state of 1 plays that lane alone, 2 adds a lane, and 0 can leave no lane playing', function()
  local reaper_api, fake = api()
  local track = fake:add_track('T')
  fake:set_fixed_lanes(track, 3)
  local function plays()
    return {
      reaper_api.GetMediaTrackInfo_Value(track, 'C_LANEPLAYS:0'),
      reaper_api.GetMediaTrackInfo_Value(track, 'C_LANEPLAYS:1'),
      reaper_api.GetMediaTrackInfo_Value(track, 'C_LANEPLAYS:2'),
    }
  end
  H.eq(plays(), { 2, 2, 2 }, 'every lane plays after retakes are placed on lanes')
  reaper_api.SetMediaTrackInfo_Value(track, 'C_LANEPLAYS:1', 1)
  H.eq(plays(), { 0, 1, 0 })
  reaper_api.SetMediaTrackInfo_Value(track, 'C_LANEPLAYS:2', 2)
  H.eq(plays(), { 0, 2, 2 })
  reaper_api.SetMediaTrackInfo_Value(track, 'C_LANEPLAYS:1', 0)
  reaper_api.SetMediaTrackInfo_Value(track, 'C_LANEPLAYS:2', 0)
  H.eq(plays(), { 0, 0, 0 })
end)

H.test('a track not in fixed-lane mode reads I_FREEMODE 0 and one lane that plays; an item reads its lane', function()
  local reaper_api, fake = api()
  local plain = fake:add_track('Plain')
  H.eq({ reaper_api.GetMediaTrackInfo_Value(plain, 'I_FREEMODE'), reaper_api.GetMediaTrackInfo_Value(plain, 'I_NUMFIXEDLANES') }, { 0, 1 })
  H.eq(reaper_api.GetMediaTrackInfo_Value(plain, 'C_LANEPLAYS:0'), 1)
  local lanes = fake:add_track('Lanes')
  fake:set_fixed_lanes(lanes, 3, { 0, 0, 1 })
  local item = fake:add_item(lanes, { lane = 2 })
  H.eq({ reaper_api.GetMediaTrackInfo_Value(lanes, 'I_FREEMODE'), reaper_api.GetMediaItemInfo_Value(item, 'I_FIXEDLANE') }, { 2, 2 })
  H.eq(reaper_api.GetMediaItemInfo_Value(item, 'C_LANEPLAYS'), 1, 'the item-level value reads its lane state')
end)
