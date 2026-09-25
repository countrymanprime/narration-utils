# Manuscript line identity in the REAPER project

**Status: Lua commands implemented, tested in the harness and verified in a scripted REAPER 7.80 run. `stamp_item_lines` and `read_line_ids` are now driven from the app** (`apps/desktop/internal/lineidentity`, the "Link chapters" dialog on the Tracks page, `apps/ui/src/components/tracks/LinkChaptersDialog.tsx`) **; `create_chapter_regions` is not yet.** Two steps of the checklist below need the owner (a real paste of a stamped item, and Transcript Compare through the app); the rest is recorded in the [verification record](#verification-record). The narrator maps each chapter to a REAPER track by hand in the Link chapters dialog; the shared chapter-to-track matcher (`apps/desktop/internal/chaptermatch`, `teleprompter-manuscript-integration.prd.md` Phase 8, ADR 0110) exists but the dialog does not use it yet (`reaper-automation-follow-through.prd.md` Phase 7).

## Why

The features that follow from the [REAPER automation research](../research/reaper-automation-surface.md) (anchoring live teleprompter flags to takes, pickup lists, per-chapter render and export) all need one thing the project does not have today: a durable link between a manuscript line and the REAPER item that records it. Storing that link in the `.rpp` itself, keyed by item GUID, means it survives moves, splits, and copies, and needs no sidecar to stay in sync.

## What exists

Two commands in [`integrations/reaper/narration_line_identity.lua`](../../integrations/reaper/narration_line_identity.lua) and the region command beside them (registered with the bridge, see [the REAPER bridge](reaper-bridge.md)), sent over the same file protocol as Transcript Compare (`1|<command>|<args>` in `commands/NNNNNNNN.cmd`). Payloads travel as files because the command line carries at most eight fields.

| Command | Fields after the command name | Payload file | Events |
| --- | --- | --- | --- |
| `stamp_item_lines` | `run_id`, `payload_path`, `overwrite` (`1` to replace a different existing ID) | `item_guid\|line_id\|line_text` per line | `LINES_STAMPED\|run\|stamped\|unchanged\|stale\|conflicts`, plus `LINES_STALE` and `LINES_CONFLICT` per GUID (first 50) |
| `read_line_ids` | `run_id`, `output_path` | Written by REAPER: `item_guid\|line_id\|position\|length\|line_text` per stamped item | `LINES_READ\|run\|path\|count` |
| `create_regions` (in [`narration_regions.lua`](../../integrations/reaper/narration_regions.lua); it replaced `create_chapter_regions`, see [the REAPER bridge](reaper-bridge.md#regions-for-chapters-and-credits-narration_regionslua)) | `run_id`, `payload_path`, optional `RRGGBB` colour, `update` (`1` moves the one region with a row's title) | `start\|end\|title` per line, seconds | `REGIONS_CREATED\|run\|added\|existing\|invalid\|updated\|ambiguous\|failed` |

Behaviour that is deliberate:

- Identity is stored as two namespaced item extension keys, `P_EXT:narration_utils_line_id` and `P_EXT:narration_utils_line_text`. Item notes and take names are never touched; they belong to the narrator.
- Items are found by GUID only. A GUID that no longer resolves is reported as stale and no neighbouring item is used instead.
- An item that already carries a different line ID is a conflict and is left alone unless the narrator explicitly overwrites.
- Each write command is one undo step, and nothing is written (and no undo point created) when there is nothing to change. Re-running with the same payload is a no-op.
- `read_line_ids` reads through the REAPER API, so the host does not depend on how the `.rpp` file happens to serialise extension data. That format is now known (spike S0: an `<EXTI` block per item, see [the result](../research/reaper-spike-s0-item-extension-data.md)) and a static read is possible later.

## Verification record

The commands' logic is pinned by the bridge harness (`integrations/reaper/tests`, [the REAPER bridge](reaper-bridge.md#the-harness)); REAPER's own behaviour was checked on 2026-09-21 in REAPER 7.80/x64 by `integrations/reaper/spikes/checklist.lua`, which loads the real bridge in an isolated REAPER (`-cfgfile` in a temp folder, a scratch project, no audio device) and drives it through the file protocol. 37 checks, 0 failures.

| Step | How verified | Result |
| --- | --- | --- |
| 1 Scratch project | Scripted | A saved scratch project with three audio items |
| 2 Stamp | Scripted | `LINES_STAMPED\|t1\|1\|0\|0\|0`; the undo entry is named as documented; Undo removes the stamp and Redo restores it |
| 3 Idempotent | Scripted | `...\|0\|1\|0\|0`, no new undo entry |
| 4 Conflict | Scripted | `LINES_CONFLICT` and the old ID kept; overwrite `1` changes it |
| 5 Stale | Scripted | `LINES_STALE`, no item changed |
| 6 Survives editing | Scripted, partly | Split: both halves keep the stamp (the right half has a new GUID); duplicate keeps it; a state-chunk copy keeps it. **A real paste of items was not exercised** (clipboard actions do nothing headless): owner |
| 7 Save and reload | Scripted | The same items and text after reopening; the `.rpp` holds an `<EXTI` block per stamped item |
| 8 Untouched fields | Scripted | Item notes and take names unchanged |
| 9 Regions | Scripted | One coloured region; again `...\|0\|1\|0`; a malformed row counted invalid |
| 10 Transcript Compare | Scripted for the bridge, **not in the app** | `prepare_compare`, `inspect_compare_results`, `export_compare_markers` (with its undo entry) and `jump_to_compare_marker` work against a hand-made results file. Starting a comparison from the app, with the launcher, is for the owner |

The run also found that `reaper.EnumerateFiles` caches the commands folder listing; the bridge now clears it on every tick (see [the REAPER bridge](reaper-bridge.md)).

## Manual verification checklist

Run steps 6 (the paste part) and 10 by hand, in REAPER with the app open; the rest is recorded above. The session folder is `<REAPER resource path>/NarrationUtils/sessions/hub_<id>/`; start it by running `NarrationUtils_Launcher.lua`. To drive a command by hand, save a one-line file such as `00000001.cmd` in that folder's `commands/` directory and read `events.log` beside it.

1. Use a scratch project with a few audio items. Note one item's GUID (right-click item, Copy item GUID, or read it from the `.rpp`).
2. **Stamp.** Payload `{GUID}|line-000001|First line.`, command `1|stamp_item_lines|t1|<payload path>|0`. Expect `LINES_STAMPED|t1|1|0|0|0`, an Edit menu entry "Narration Utils: stamp manuscript line IDs", and Undo removing it.
3. **Idempotent.** Send the same command again. Expect `...|0|1|0|0` and no new undo entry.
4. **Conflict.** Change the payload ID to `line-000002`, send with overwrite `0`. Expect a `LINES_CONFLICT` event and the old ID kept. Send with overwrite `1`: the ID changes.
5. **Stale.** Use a GUID that is not in the project. Expect `LINES_STALE`, and no item changed.
6. **Survives editing.** Move and split a stamped item, then `read_line_ids`. Confirm both halves still report the ID (split items copy extension data) or note which does not.
7. **Survives save and reload.** Save, close, reopen the project, run `read_line_ids`. The stamp must still be there. This also confirms extension data persists in the `.rpp`.
8. **Untouched fields.** Confirm the item's notes and take name are unchanged.
9. **Regions.** Payload `0|30|Chapter 1`, command `1|create_regions|t2|<payload path>|FF8800|0` (named `create_chapter_regions` when this checklist ran). Expect one coloured region and `REGIONS_CREATED|t2|1|0|0|0|0|0`. Send again: `...|0|1|0|0|0|0`. Add a malformed line: it is counted as invalid.
10. Confirm Transcript Compare still starts (the bridge loads and existing commands are unaffected).

## Later phases

1. **Go client.** Done for `stamp_item_lines` and `read_line_ids` (`apps/desktop/internal/lineidentity`, tests mirroring `transcript/service_test.go`) and its UI trigger, the Tracks page's "Link chapters" dialog. Line IDs are chapter-level (Open Question 3 of the reaper-automation-follow-through PRD, answered (a)): the manuscript entity ID (a chapter ID, or a paragraph ID once that granularity is built) plus the manuscript's source SHA-256 (Open Question 4, answered (a)), not the item-to-manuscript-span alignment. `REGIONS_CREATED` still has no Go client or subscriber.
2. **Chapter regions from the manuscript.** The Lua command is `create_regions` (experimental until the [verification pass](../operations/reaper-verification-pass.md); `bridge.Actions.CreateRegions` is its Go client); the host flow that builds its rows is not yet built. Regions need project-time bounds; derive them from the `tracks` package's item extents per chapter track.
3. **Static read (optional).** Spike S0 checked how item `P_EXT` appears in a REAPER-saved `.rpp` ([the result](../research/reaper-spike-s0-item-extension-data.md)): an `<EXTI` block of `key value` lines per item, stable across save, reload, split and duplicate, so `tracks` could read line IDs without a running REAPER (a chunk reader that handles the four value forms, and `IGUID` for the item GUID). The fixtures are under `apps/desktop/internal/tracks/testdata/reaper/`. Until then use `read_line_ids`.
4. **Lua test harness.** Done ([ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)): the commands above have harness tests, and new ones come with theirs.
5. **Retakes on fixed lanes.** Done for choosing a lane (reaper-automation-follow-through Phase 25, [ADR 0147](../adr/0147-retakes-on-fixed-lanes-are-chosen-by-lane-play-state-and-the-app-never-converts-takes-and-lanes.md)). On a lane track every retake of a line carries the same line id, so a line id no longer names one item there: `pick_retake_lane` and `apps/desktop/internal/retakelanes` name a retake by line id plus item GUID, and "the retake that plays" is the item whose lane plays. Anything else that goes from a line id to one item has to make the same choice before it runs on a lane track.
6. **Consumers.** Timeline-anchored live flags and the punch-and-roll navigator (research items 1 and 2) now that the live ASR sidecar and its Go event relay are on main.
