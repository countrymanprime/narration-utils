-- Applies a per-item gain change to match a narrator-set loudness target (diagnostics-delivery-and-cleanup-tools PRD
-- Phase 11's level-normalize half, ADR 0252): apply_item_gain. The host (apps/desktop/internal/levelnormalize)
-- decides whether an item needs a change and by how much, from a measurement over its range
-- (internal/measure.AnalyzeRange); this file only carries that decision out, on the whole item's own volume
-- (D_VOL, linear), and reports what it was and what it became so a before/after report needs no second measurement
-- pass. Nothing here decides a target or measures anything: it is the last, mechanical step, and, like every other
-- item-editing command in this bridge, it resolves by GUID and never guesses at a neighbour.
--
-- A REAPER item's own volume is multiplicative (D_VOL 1.0 is 0 dB), so a dB delta is applied as
-- new_vol = old_vol * 10^(delta_db / 20) on top of whatever volume the item already has - a second apply after a
-- narrator's own manual trim keeps that trim, rather than overwriting it back to some assumed starting point. Every
-- item in a call is changed in one undo block, so approving a whole batch or one item alone is always one Undo away;
-- a stale item is reported and left alone, never guessed at.

local core = ...
local pipe_fields, event = core.pipe_fields, core.event

local UNDO_APPLY_GAIN = 'Narration Utils: apply level-match gain'

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
local function find_item(guid)
  for index = 0, reaper.CountMediaItems(0) - 1 do
    local item = reaper.GetMediaItem(0, index)
    if item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function recording()
  return math.floor(reaper.GetPlayState() / 4) % 2 == 1
end

-- Payload rows are `item_guid|delta_db|finding_id`; a row that is not well-formed is dropped rather than guessed at.
local function read_payload(path)
  local input = io.open(path, 'r')
  if not input then
    return nil
  end
  local rows = {}
  for line in input:lines() do
    local fields = pipe_fields((line:gsub('\r$', '')), 3)
    local item_text, delta_text, finding_id = fields[1], fields[2], fields[3]
    local delta_db = tonumber(delta_text)
    if (item_text or '') ~= '' and (finding_id or '') ~= '' and delta_db then
      rows[#rows + 1] = { item_text = item_text, delta_db = delta_db, finding_id = finding_id }
    end
  end
  input:close()
  return rows
end

local function apply_item_gain(session_dir, run_id, path)
  local rows = read_payload(path)
  if not rows then
    event(session_dir, 'ERROR', run_id, 'The level-match candidate list was not found.')
    return
  end
  if recording() then
    event(session_dir, 'ERROR', run_id, 'REAPER is recording. Stop recording first.')
    return
  end
  local applied = 0
  local plan = {}
  for _, row in ipairs(rows) do
    local item = find_item(normalize_guid(row.item_text))
    if not item then
      event(session_dir, 'GAIN_STALE', run_id, row.finding_id, row.item_text, 'item')
    else
      plan[#plan + 1] = { item = item, guid = item_guid(item), delta_db = row.delta_db }
    end
  end
  if #plan > 0 then
    reaper.Undo_BeginBlock2(0)
    for _, change in ipairs(plan) do
      local before = reaper.GetMediaItemInfo_Value(change.item, 'D_VOL')
      local after = before * 10 ^ (change.delta_db / 20)
      reaper.SetMediaItemInfo_Value(change.item, 'D_VOL', after)
      event(session_dir, 'GAIN_ITEM', run_id, change.guid, string.format('%.6f', before), string.format('%.6f', after))
      applied = applied + 1
    end
    reaper.Undo_EndBlock2(0, UNDO_APPLY_GAIN, -1)
    reaper.UpdateArrange()
  end
  event(session_dir, 'GAIN_APPLIED', run_id, applied)
end

return function(registry)
  registry.register('apply_item_gain', function(ctx, args)
    apply_item_gain(ctx.session_dir, args[1] or '', args[2] or '')
  end)
end
