# Manuscript line identity in the REAPER project

**Status: Lua commands implemented; not yet driven by the Go host or UI, and not yet verified inside REAPER.** The manual checklist below has not been run. Nothing in the app calls these commands yet.

## Why

The features that follow from the [REAPER automation research](../research/reaper-automation-surface.md) (anchoring live teleprompter flags to takes, pickup lists, per-chapter render and export) all need one thing the project does not have today: a durable link between a manuscript line and the REAPER item that records it. Storing that link in the `.rpp` itself, keyed by item GUID, means it survives moves, splits, and copies, and needs no sidecar to stay in sync.

## What exists

Three commands in [`integrations/reaper/narration_line_identity.lua`](../../integrations/reaper/narration_line_identity.lua) (registered with the bridge, see [the REAPER bridge](reaper-bridge.md)), sent over the same file protocol as Transcript Compare (`1|<command>|<args>` in `commands/NNNNNNNN.cmd`). Payloads travel as files because the command line carries at most eight fields.

| Command | Fields after the command name | Payload file | Events |
| --- | --- | --- | --- |
| `stamp_item_lines` | `run_id`, `payload_path`, `overwrite` (`1` to replace a different existing ID) | `item_guid\|line_id\|line_text` per line | `LINES_STAMPED\|run\|stamped\|unchanged\|stale\|conflicts`, plus `LINES_STALE` and `LINES_CONFLICT` per GUID (first 50) |
| `read_line_ids` | `run_id`, `output_path` | Written by REAPER: `item_guid\|line_id\|position\|length\|line_text` per stamped item | `LINES_READ\|run\|path\|count` |
| `create_chapter_regions` | `run_id`, `payload_path`, optional `RRGGBB` colour | `start\|end\|title` per line, seconds | `REGIONS_CREATED\|run\|added\|existing\|invalid` |

Behaviour that is deliberate:

- Identity is stored as two namespaced item extension keys, `P_EXT:narration_utils_line_id` and `P_EXT:narration_utils_line_text`. Item notes and take names are never touched; they belong to the narrator.
- Items are found by GUID only. A GUID that no longer resolves is reported as stale and no neighbouring item is used instead.
- An item that already carries a different line ID is a conflict and is left alone unless the narrator explicitly overwrites.
- Each write command is one undo step, and nothing is written (and no undo point created) when there is nothing to change. Re-running with the same payload is a no-op.
- `read_line_ids` reads through the REAPER API, so the host does not depend on how the `.rpp` file happens to serialise extension data. That format is still unverified (no project on the development machine uses item-level `P_EXT`).

## Manual verification checklist

`integrations/reaper` has no automated tests, so run this in REAPER before relying on the commands. The session folder is `<REAPER resource path>/NarrationUtils/sessions/hub_<id>/`; start it by running `NarrationUtils_Launcher.lua`. To drive a command by hand, save a one-line file such as `00000001.cmd` in that folder's `commands/` directory and read `events.log` beside it.

1. Use a scratch project with a few audio items. Note one item's GUID (right-click item, Copy item GUID, or read it from the `.rpp`).
2. **Stamp.** Payload `{GUID}|line-000001|First line.`, command `1|stamp_item_lines|t1|<payload path>|0`. Expect `LINES_STAMPED|t1|1|0|0|0`, an Edit menu entry "Narration Utils: stamp manuscript line IDs", and Undo removing it.
3. **Idempotent.** Send the same command again. Expect `...|0|1|0|0` and no new undo entry.
4. **Conflict.** Change the payload ID to `line-000002`, send with overwrite `0`. Expect a `LINES_CONFLICT` event and the old ID kept. Send with overwrite `1`: the ID changes.
5. **Stale.** Use a GUID that is not in the project. Expect `LINES_STALE`, and no item changed.
6. **Survives editing.** Move and split a stamped item, then `read_line_ids`. Confirm both halves still report the ID (split items copy extension data) or note which does not.
7. **Survives save and reload.** Save, close, reopen the project, run `read_line_ids`. The stamp must still be there. This also confirms extension data persists in the `.rpp`.
8. **Untouched fields.** Confirm the item's notes and take name are unchanged.
9. **Regions.** Payload `0|30|Chapter 1`, command `1|create_chapter_regions|t2|<payload path>|FF8800`. Expect one coloured region and `REGIONS_CREATED|t2|1|0|0`. Send again: `...|0|1|0`. Add a malformed line: it is counted as invalid.
10. Confirm Transcript Compare still starts (the bridge loads and existing commands are unaffected).

## Later phases

1. **Go client.** Add bridge methods and payload writers in `apps/desktop/internal`, with tests that mirror `transcript/service_test.go`, and a UI trigger. Decide where line IDs come from: the natural source is the item-to-manuscript-span alignment Transcript Compare already computes.
2. **Chapter regions from the manuscript.** Regions need project-time bounds; derive them from the `tracks` package's item extents per chapter track.
3. **Static read (optional).** Once a REAPER-saved sample project exists, check how item `P_EXT` appears in the `.rpp`. If it is stable, `tracks` could read line IDs without a running REAPER; until then use `read_line_ids`.
4. **Lua test harness.** A stub `reaper` table with a Lua interpreter in CI, so these commands and the existing ones stop depending on manual checks.
5. **Consumers.** Timeline-anchored live flags and the punch-and-roll navigator (research items 1 and 2) now that the live ASR sidecar and its Go event relay are on main.
