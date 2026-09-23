# Going to and looping a finding in REAPER

**Status: implemented end to end: bridge commands, Go client, host bindings and the Review page's Go to, Loop, Stop and Add marker buttons** (Phases 6, 7 and 8 of [the review dashboard PRD](../prds/review-dashboard-and-findings-adoption.prd.md)), tested in the harness, in Go, in the UI and the visual suite. Go to, Loop and Stop were also checked in a scripted REAPER 7.80 run. Hearing the loop, three other steps, a run of the checklist from the page, and the approved marker in a real REAPER are pending (scripted run and owner); see the [manual checklist](#manual-verification-checklist). Decisions: [ADR 0121](../adr/0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md), [ADR 0123](../adr/0123-the-approved-marker-is-one-take-marker-for-an-accepted-finding-named-like-transcript-compares-in-one-undo-point.md) (the approved marker).

## What it does

A finding carries its REAPER identity in `source` (`item_guid`, `take_guid`, `track_guid`) and its time inside that take's audio in `time_range.source_start` and `source_end` ([findings contract](findings-contract.md)). The host asks REAPER, over [the file bridge](reaper-bridge.md), to:

- **go to** it: select only its item and put the edit cursor on its spot (`navigate_item`);
- **loop** it: set the time selection and the loop points to a window around it, turn repeat on and play (`loop_context`, the owner's answer to Q6);
- **stop** the loop: stop the transport and put back the time selection, loop points and repeat the narrator had (`stop_loop`);
- say whether the script is there and knows these commands (`ping`);
- **add one approved marker** for a finding the narrator accepted: a take marker at its spot, in one undo point (`add_finding_marker`, Phase 8).

The commands live in `integrations/reaper/narration_navigation.lua`; the host side is `bridge.Navigator` in `apps/desktop/internal/bridge/navigation.go`.

## Finding the spot: GUIDs, never a position

The item is found by its GUID (upper or lower case, with or without braces). When the finding names a take, that take must still be on the item; otherwise the item's active take is used. The source time becomes a project time with the take's current start offset and play rate, `item position + (source time - offset) / rate`, the same mapping Transcript Compare uses when it reports a row, so a finding follows its item when the narrator moves it.

Three things make a finding **stale**, and each is answered `FINDING_STALE|run|guid|reason` with nothing selected, moved or played:

| Reason | When |
| --- | --- |
| `item` | No item has that GUID (deleted, or the GUID is empty) |
| `take` | The item is there but no longer has that take (or has no take at all and a time was asked for) |
| `range` | The spot is outside the item as it is now (trimmed, or the take's offset changed); for a loop, the window does not overlap the item |

Nothing ever falls back to a neighbouring item or to the project time the finding had when it was made. The host refuses a finding without an item GUID before sending anything (`bridge.ErrNoItemIdentity`), so a finding from an older comparison has to be re-run to be navigable.

Transcript Compare records the item, take and track GUIDs of each item when it prepares a comparison (`prepare_compare`, the audio the rows describe) and appends them to `COMPARE_MARKER` after `srcpos`. The Transcript service keeps them out of the Transcript page's rows and the findings adapter puts them in `source`.

## Looping

`loop_context` takes the item and take GUIDs and a source window. The host pads the finding's source range by `ContextPaddingSeconds` (2 s) on each side (never below 0); REAPER keeps the window inside the item. Then, in this order: stop the transport if it is playing, set the time selection and the loop points to the window, turn repeat on, move the edit cursor to the window start and press Play. Both ranges are set because repeat loops the loop points and REAPER only links them to the time selection by preference (on by default in REAPER 7.80).

The first `loop_context` remembers the narrator's time selection, loop points and repeat. A second one (Loop on another finding) re-targets the loop and keeps that memory, so Stop always returns to what the narrator had before any loop.

`stop_loop` stops the transport if a loop of ours is held and REAPER is not recording, then goes through the three values: one that still has the value the loop set is put back, one that already has the narrator's value counts as put back (with linked loop points, putting the time selection back moves them too), and one the narrator changed while listening is theirs and is kept. It answers `LOOP_STOPPED|run|restored|kept`. With no loop held it changes nothing and answers `0|0`.

The loop memory lives in the running script. If the launcher script ends (the narrator terminates it, or quits REAPER) with a loop held, a `reaper.atexit` handler puts the state back. If the app restarts the launcher, the memory is gone: Stop answers `0|0` and the narrator's time selection stays as the loop left it.

None of the four commands makes an undo point or changes the project's content (the approved marker, below, is the one command here that does). Items are deselected one at a time with `SetMediaItemSelected`. Nothing moves while REAPER is recording: `navigate_item` and `loop_context` answer `ERROR|run|REAPER is recording. Stop recording first.`

## Adding the approved marker

`add_finding_marker` (review dashboard Phase 8, the owner's answer to Q8) adds one take marker for one finding the narrator accepted. It is found like `navigate_item`: the item by GUID, the named take or the active one, the source time mapped through the take's offset and rate, and `FINDING_STALE` with `item`, `take` or `range` when any of them is gone. It changes nothing while REAPER is recording (`ERROR ... REAPER is recording`).

The marker is a **take marker at the source time**, so it follows the item when the item moves, like the markers Transcript Compare's **Export markers** adds. The host names and colours it like them: the finding's kind (or its category), then what the script says and what was recorded, eight words at most each (`MISREAD: 'pink eyes' as 'pale eyes'`), in the Transcript Compare colour for that kind. Before adding, the script asks `existing_take_marker` (`narration_bridge_core.lua`, the rule the export uses): is there already a marker with the same issue prefix within 0.15 s on that take? If so, it answers `existing` with that marker's name and changes nothing, so the command is safe to send twice and the export later skips the row. Otherwise it adds the marker inside one `Undo_BeginBlock2`/`Undo_EndBlock2` block labelled "Narration Utils: add approved marker", so one Undo in REAPER takes it away. It moves no selection, cursor or transport.

The host (`FindingsAddMarker(id)`, `apps/desktop/bindings_marker.go`) refuses before writing anything when the finding is not `accepted` (`not_accepted`), has no item GUID (`no_item`) or no source time (`no_source_time`), or REAPER is not listening (`standalone`, `not_running`); REAPER's own refusals come back as `stale`, `recording`, `script_outdated` or `failed`, worded "so no marker was added". The Review page's **Add marker in REAPER** stays off until the finding is accepted, and asks in a confirm dialog before sending. The batch export stays on the Proofing page.

## Commands and events

| Command | Arguments after the name | Events |
| --- | --- | --- |
| `navigate_item` | `run_id`, `item_guid`, `take_guid` (may be empty), `source_time` (may be empty: the item's start) | `NAVIGATED\|run\|item_guid\|project_time`, `FINDING_STALE\|run\|guid\|reason`, or `ERROR` |
| `loop_context` | `run_id`, `item_guid`, `take_guid` (may be empty), `source_start`, `source_end` | `LOOP_STARTED\|run\|item_guid\|start\|end` (project seconds), `FINDING_STALE`, or `ERROR` |
| `stop_loop` | `run_id` | `LOOP_STOPPED\|run\|restored\|kept` |
| `ping` | `run_id` | `PONG\|run\|version\|looping\|playing` (version `1`; the flags are `0` or `1`) |
| `add_finding_marker` | `run_id`, `item_guid`, `take_guid` (may be empty), `source_time`, `color` (`RRGGBB`, may be empty), `name` | `FINDING_MARKER\|run\|added or existing\|take_guid\|source_time\|name` (the existing marker's name when `existing`), `FINDING_STALE`, or `ERROR` |

The events are in the table in `apps/desktop/internal/bridge/wire.go` ([wire contracts](wire-contracts.md#reaper-events-appsdesktopinternalbridgewirego)).

## The host side

`bridge.NewNavigator(client)` subscribes to those events on the session's `bridge.Client`. `Navigate`, `Loop`, `StopLoop`, `Ping` and `AddMarker` (`marker.go`) each send one command and wait for its answer, routed by run ID, for up to `DefaultAnswerTimeout` (3 s). They return typed results, or:

| Error | Meaning |
| --- | --- |
| `ErrUnavailable` | No bridge: the app was not opened from REAPER's action |
| `ErrNoAnswer` | No answer in time: REAPER closed, the script stopped, or REAPER is busy |
| `ErrScriptOutdated` | The script in REAPER answered "Unsupported workspace command": it predates these commands |
| `ErrNoItemIdentity`, `ErrNoSourceTime`, `ErrNoMarkerName` | The finding has no item GUID, no usable source time, or (for a marker) no name (nothing is sent) |
| `*StaleError` (`errors.Is(err, ErrStale)`) | `FINDING_STALE`, with the GUID and the reason in plain words |

The answer arrives through `Client.Dispatch`, which the host's 150 ms loop already calls. A request must therefore never be made from inside a `Subscription.Handle`, which runs within `Dispatch`. `configureLocked` constructs it next to the Transcript service on the same client (with no client, it is standalone and refuses everything).

## From the Review page

Phase 7 puts the Navigator behind four host bindings (`apps/desktop/bindings_navigation.go`, host API 38) and three buttons in the Review page's finding detail (`apps/ui/src/components/review/ReaperControls.tsx`):

| Binding | Sends | Answers |
| --- | --- | --- |
| `FindingsReaperStatus()` | nothing | `connection` (`connected`, `not_running`, `standalone`), a `message` when not connected, and `loopingFindingId` while a loop this app started is held |
| `FindingsGoTo(id)` | `navigate_item` | `navigated` with `projectTime`, or `refused` |
| `FindingsLoop(id)` | `loop_context` | `looping` with `loopStart` and `loopEnd`, or `refused` |
| `FindingsStopLoop()` | `stop_loop` | `stopped` with `restored` and `kept`, or `refused` |
| `FindingsGoToRead(id, read)`, `FindingsLoopRead(id, read)` (take review Phase 5, host API 40) | `navigate_item`, `loop_context` | as Go to and Loop, for one read of a grouped finding: `evidence.members[read]`'s own item and take GUIDs and its range in its source (a take-review group, or a take comparison of one, Phase 10) ([ADR 0124](../adr/0124-take-review-groups-are-reviewed-on-the-review-page-each-read-is-navigated-by-its-index-and-the-scan-is-a-cancellable-job.md)); a read the finding does not have is an error |
| `FindingsAddMarker(id)` (Phase 8, host API 39) | `add_finding_marker` | `added` or `existing` with the marker's `name` and `sourceTime`, or `refused` (see [adding the approved marker](#adding-the-approved-marker)) |

The page sends only the finding's id; the host reads its item and take GUIDs and source times from the project's findings store. The status is read from `daw.Reachability` (the heartbeat REAPER's script sends every 1.5 s), so the page polls it every 3 s at no cost to REAPER: `standalone` when there is no bridge client, `not_running` when the heartbeat is stale. Go to and Loop are disabled with the reason under them until it is `connected`, and for a finding without an item GUID (or, for Loop, without a source time); Stop loop appears while `loopingFindingId` is set, on every finding.

A request is refused in this order, and nothing is written for a refusal before the last step: no item GUID (`no_item`), for Loop no source time (`no_source_time`), no bridge (`standalone`), a stale heartbeat (`not_running`); then REAPER's own answers: `stale`, `recording` (`bridge.ErrRecording`), `script_outdated`, no answer in time (`not_running`), anything else (`failed`, with REAPER's words). A refusal is an answer, not an error, with a plain-language `message` the page shows as an alert; the payloads are wire contracts (`findingNavigationSchema`, `reaperStatusSchema`, golden files `findings-go-to.json`, `findings-loop.json`, `findings-stop-loop.json`, `findings-navigation-*.json` and `findings-reaper-status-*.json`). Checking the heartbeat first means a command is never left in the folder for a REAPER that has gone, to be acted on later without the narrator ([threat model](threat-model.md) row 5f).

The host remembers which finding it looped (`findingNavigation.loopingID`) until a Stop succeeds. A project switch builds a new navigator and forgets it; REAPER's script still holds that loop until its own Stop or its exit handler.

## Verification record

The approved marker is pinned by `integrations/reaper/tests/finding_marker_test.lua` (13 tests) and 4 mutation checks (the add outside an undo block, a doubled marker, a marker added while recording or at a spot the item no longer covers); the host side by `apps/desktop/bindings_marker_test.go`, `internal/bridge/marker_test.go` (a fake REAPER through the real file protocol) and the golden payloads `tests/fixtures/contracts/findings-add-marker*.json`. The navigation commands' logic is pinned by the harness (`integrations/reaper/tests/navigation_test.lua`, 29 tests, and 12 mutation checks in `mutations.json`: a stale GUID resolving to another item, a missing take falling back to the active one, a spot outside the item, recording not refused, a second loop overwriting the memory, Stop overwriting a narrator's change, Stop not restoring repeat or restoring twice, Stop stopping playback it did not start, the script ending without restoring, and the compare GUIDs read late). The Go client is covered by `navigation_test.go` against a fake REAPER that answers through the real file protocol.

REAPER's own behaviour was checked on 2026-09-23 in REAPER 7.80/x64 by `integrations/reaper/spikes/navigation_check.lua` (run by `run-reaper.ps1`: an isolated `-cfgfile` in a temp folder, a scratch project built from synthetic tones in a temp folder, the audio device closed, and `OnPlayButton` replaced by a recorder so nothing played). It loads the real bridge registry and drives the real commands. 34 checks, 0 failures; the output is in `integrations/reaper/spikes/results/navigation-check-report.txt`.

| Step | How verified | Result |
| --- | --- | --- |
| Linked ranges | Scripted | Setting only the loop points moved the time selection and the reverse: linked by default |
| `ping` | Scripted | `PONG\|p1\|1\|0\|0`; after a loop, `looping` 1 |
| Loop | Scripted | Time selection and loop points read back as 10.5..12.5 s, repeat on, cursor at 10.5 s, Play requested once; no undo point, project not dirty |
| Second loop | Scripted | Re-targets to 11..12 s |
| Stop | Scripted | `LOOP_STOPPED\|s1\|3\|0`; time selection, loop points and repeat back to the narrator's; no undo point |
| Narrator changed the selection | Scripted | Their 20..21 s selection kept, `LOOP_STOPPED\|s2\|1\|2` |
| Stop with nothing held | Scripted | `0\|0`, nothing changed |
| Stale item, take, range | Scripted | `FINDING_STALE` with `item`, `take`, `range`; nothing selected, cursor not moved |
| Go to | Scripted | Only the finding's item selected, cursor at 11.5 s, no undo point; after moving the item to 30 s, 31.5 s |
| Compare GUIDs | Scripted | `COMPARE_MARKER` ends with the item, take and track GUIDs; `navigate_item` with them lands on the marker |
| Hearing the loop, REAPER's Stop button, ping after a restart, ending the script mid-loop | **Pending, owner** | Need audio hardware or the owner (below) |
| `add_finding_marker` in REAPER: the marker at the source time on the named take, one "Narration Utils: add approved marker" undo point that Undo removes, a second send answering `existing` with no new undo point, stale and recording refusals | **Pending, scripted run** | Not pre-approved for Phase 8, so not run. To run on a copy of a project with an isolated `-cfgfile`, like the Phase 6 check (steps 10 and 11 below) |
| The marker from the Review page, seen in REAPER, and Export markers on the Proofing page skipping it | **Pending, owner** | Step 11 below |

The first run of the check also saw `SelectAllMediaItems` leave an "Unselect all items" undo point; the second run's probe did not reproduce it, and `SetMediaItemSelected`, which the bridge now uses, left none in either.

## Manual verification checklist

For the owner, in REAPER with audio, on a copy of a real project. Start the session by running `NarrationUtils_Launcher.lua`; the session folder is `<REAPER resource path>/NarrationUtils/sessions/hub_<id>/`. To send a command by hand, save a one-line file such as `00000001.cmd` in its `commands/` folder (fields percent-encoded, `|`-separated, starting `1|<command>|<run id>`) and read `events.log` beside it. Since Phase 7 the same steps can be run from the Review page instead (open the app from the Narration Utils action, select a Proofing finding, and use Go to in REAPER, Loop in REAPER and Stop loop); step 9 is that run.

1. **Go to.** Copy an item's GUID (from the `.rpp`, `IGUID`). Send `1|navigate_item|n1|<GUID>||1.5`. The item alone is selected and the cursor sits 1.5 s into its audio; Edit > Undo history has no new entry.
2. **Stale.** Delete that item, send the same command. Expect `FINDING_STALE|n1|<GUID>|item` and nothing selected.
3. **Loop and hear it.** Make a time selection of your own and turn repeat off. Send `1|loop_context|l1|<GUID>||0.5|4.5`. You hear the 4 s window loop; REAPER shows it as the time selection with repeat on.
4. **Stop.** Send `1|stop_loop|s1`. Playback stops; your own time selection and repeat off are back; `LOOP_STOPPED|s1|3|0`.
5. **REAPER's own stop.** Loop again, press Space in REAPER, then send `1|ping|p1`: expect `looping` 1, `playing` 0. `stop_loop` still restores.
6. **Ending the script mid-loop.** Loop again, then terminate the launcher script (Actions > Running scripts, or quit REAPER without saving). The time selection and repeat are back.
7. **Ping after a restart.** Quit and reopen REAPER, run the launcher again, and send `ping` to the new session: `PONG`. The old session's folder gets no answer (the app would report `ErrNoAnswer`).
8. **Recording.** Start recording on a scratch track and send `navigate_item`: `ERROR ... REAPER is recording`, nothing moves. Stop recording.
9. **From the Review page.** Open the app from the Narration Utils action, run a Proofing comparison, open Review and select a transcript difference. Go to in REAPER selects its item and the page names the cursor time; Loop in REAPER plays it and Stop loop appears; Stop loop puts your selection and repeat back. Delete the item and press Go to: the page says the item is no longer in the project. Quit REAPER: within a few seconds Go to and Loop turn off with "REAPER is not answering". Open the app on its own (not from REAPER): they are off with the "open this app from the Narration Utils action" reason.
10. **Approved marker.** With the take GUID of an item's active take (`GUID` inside its `<SOURCE` block's take in the `.rpp`), send `1|add_finding_marker|m1|<item GUID>|<take GUID>|1.5|FF4040|MISREAD%3A%20test`. A red take marker "MISREAD: test" sits 1.5 s into the take's audio; Edit > Undo history has one new entry, "Narration Utils: add approved marker"; Undo removes the marker. Send it twice: the second answers `FINDING_MARKER|m1|existing|...` and adds no marker and no undo entry. Delete the item and send it again: `FINDING_STALE|m1|<GUID>|item`, nothing added. Start recording and send it: `ERROR ... REAPER is recording`, nothing added.
11. **Approved marker from the Review page.** In the run of step 9, accept a transcript difference, press Add marker in REAPER and confirm. The page names the marker; REAPER shows it on the take at the finding's spot. Press it again: the page says the take already has it. Back on the Proofing page, Export markers counts that row as skipped. Undo in REAPER removes the marker.
