# Teleprompter–Manuscript Integration Plan

**Status: Planned. Nothing here is built.** This brief plans how the teleprompter becomes a reading mode of the Manuscript page, and how it works with the DAW so a narrator can resume a chapter and punch back to a word. It extends [manuscript-teleprompter.md](manuscript-teleprompter.md) (the sidecar, host relay and first Teleprompter page, which exist) and leans on [daw-integration.md](daw-integration.md) and [the REAPER automation research](../research/reaper-automation-surface.md).

## Problem

Today the teleprompter is a standalone page: pick a chapter, type a microphone name, read. It has no access to the story bible or manuscript notes, flags nothing the narrator gets wrong, cannot be started or moved to a chosen word, and knows nothing about the recording in REAPER. A narrator who starts a session halfway through a chapter, or who flubs a line and wants to punch back in, has to find the place by hand in both windows.

## Requirements

1. Open the teleprompter from the Manuscript page for a chapter, as a modal with the chapter text and teleprompter controls.
2. Show story bible entries and manuscript notes while reading.
3. Show extra words and misreads as they happen, merging in the proofing ideas from Transcript Compare.
4. Start the teleprompter at, or move it back to, a specific word.
5. On opening a chapter, ask the DAW whether the chapter's track exists and where its last recorded audio ends, so a session can pick up mid-chapter.
6. Correlate a word with a position on the DAW timeline so the narrator can punch and roll.
7. Detect the microphone the DAW is using; if that is not possible, list every input device and let the narrator choose.

## Decisions (2026-09-19)

| Question | Decision |
| --- | --- |
| Keep the standalone Teleprompter page? | Keep it while the modal is built. Remove it (and its nav item) once the new feature is fully built and tested, as its own change, because a nav change regenerates every doc screenshot. |
| How to find the resume point? | Run the tracker over the tail of the track's recorded audio. It works for audio that was not recorded through the teleprompter. Anchors from past live sessions are a later precision improvement. |
| First punch scope? | Move the edit cursor to the word's time minus a pre-roll. Do not change transport or record arm. Arming and recording, and time-selection auto-punch, are planned for later. |
| Microphone? | Detect what REAPER uses if that can be done reliably; otherwise enumerate all input devices and let the narrator choose. See [Microphone selection](#microphone-selection). |

## Design

**One session core, two hosts.** Extract the session logic out of `TeleprompterPage.tsx` into `useTeleprompterSession` and a `ReadAlongView` (word reader, status bar, key). The page and the new modal both mount them, so the modal ships without a rewrite and the page keeps working until it is removed.

**The modal.** A full-screen dialog opened from a button on each chapter header in `Manuscript.tsx`. The chapter comes from the manuscript context, so there is no chapter picker. A side rail holds the key, the chapter's notes and its story bible entries.

**The key.** A legend for every mark the reader can show: read words (dimmed), the current word (solid `Cursor` fill, ADR 0024), skipped (dotted underline), misread (wavy underline), extra words heard (a caret between words), and story bible and note marks. New marks get a `Highlight` kind or a documented equivalent, and follow ADR 0016 and ADR 0017.

**Sidecar as the source of flags.** The tracker already holds the alignment between heard words and script words, so it emits `flag` events (`misread`, `extra`, `skipped`) next to `position`. Go relays them verbatim, as it does every event, so no Go change is needed for flags. A flag is always "suspected"; Transcript Compare over the recorded take stays the authoritative review. Precision beats recall (the spirit of ADR 0020): suppress flags in a segment's first words, where Moonshine and Whisper revise most.

**Seek through a control channel.** The sidecar currently only emits events (it stops through `--stop-file`). Add `--control-file`: the host appends JSON lines and the sidecar tails the file. The tracker gains `reset_to(index)`; a new `--start-word N` starts a session at a word. This is the same sentinel-file pattern the other sidecars use, so no loopback server or port is introduced.

**Story bible and notes marks.** `ParagraphView` renders character-offset annotations and never splits text into words; the reader works on words. Map the offsets onto word ranges in `readerModel`, so an entity or note mark lands on the words it covers. Clicking a mark opens the existing `EntitySummary` or note view in the rail and must not move the cursor or scroll the text.

**DAW resume (tail audio).** On opening a chapter:

1. Find the chapter's track by name. Port the matching rule from `find_chapter_by_track_name` in `tools/transcript-compare/core/compare.py` to Go, or call the manuscript service; the narrator can pick a track if there is no confident match. Never create a track.
2. Read where the audio on that track ends: the maximum `Position + Length` over the track's items.
   - Standalone launch: from the `.rpp` through the Go `tracks` package. The file is only as fresh as REAPER's last save, and the UI must say "as of last save".
   - REAPER session: ask the running project through a new Lua bridge command (`chapter_track_state`), which returns the track GUID, item ends, play state and edit cursor. Prefer this when the bridge is available.
3. Take the last ~60 s of the last item's source audio and run the sidecar in a new `--locate` mode. It aligns those heard words against the whole chapter script with the tracker's existing "jump elsewhere when 3 or more words match" logic and reports the script word index where the audio ends.
4. Offer "Resume at word N ('…the door opened') / Start from the top / Pick a word". Always show the matched sentence and let the narrator confirm, because a repeated passage can match the wrong place.

**Punch and roll (cursor and pre-roll only).**

1. The narrator picks a word (click, or "Punch from here" on a flag).
2. The host resolves the word to a project time. Source order: an anchors file, then offline alignment of the item audio (the `--locate` machinery generalised to output word times over a range). The anchors file is `<project>/narration-utils/teleprompter/<chapter>.anchors.json`, written by live sessions as (word index, play position minus ASR latency); after a punch at word N, drop anchors at or after N.
3. A Lua command `punch_to` sets the edit cursor to (time minus pre-roll), scrolls the view, and does not change transport or record arm. It runs in an undo block, is triggered only by the narrator, and reports failure without partial effects (`daw-integration.md`).
4. The teleprompter seeks to the same word, so the reader and the DAW agree.

The pre-roll length is a setting resolved through the layered settings files; pick the default in this phase.

**Host API.** New bindings (seek, resume lookup, punch, device list) bump `hostAPIVersion` 5 to 6 in three places (`shell/app.go`, `shared/ui/src/hostApi.ts`, `shell/app_test.go`) and regenerate `shared/ui/wailsjs/go/main/Host.{js,d.ts}`. Any new service snapshots under `RLock` ([host-binding-concurrency.md](host-binding-concurrency.md)).

### Microphone selection

The sidecar captures with PyAV's Windows `dshow` input and today takes the device name as typed text. REAPER usually records through ASIO or WASAPI, whose device names may not match a `dshow` name, so detection is best-effort:

1. **Enumerate** every input device with a sidecar `--list-devices` mode (the sidecar already depends on PyAV; whether PyAV can list `dshow` devices directly or needs an ffmpeg call is a spike).
2. **Detect** REAPER's input device when a bridge session exists, through a Lua read of REAPER's audio device settings. `GetAudioDeviceInfo` is documented for `MODE`, `BSIZE` and `SRATE`; whether it (or `reaper.ini`) exposes the input device name is unverified and needs a spike.
3. **Match** the REAPER name to a `dshow` name by normalized fuzzy match. Preselect it only when the match is confident and say why ("REAPER is using …").
4. **Otherwise** show the full list, preselect the last choice remembered in the browser, and let the narrator choose. The typed field becomes an "Other…" fallback.

Sharing hazard: if REAPER holds the device in exclusive mode (typical with ASIO), a second capture may fail or steal the device. Detect a failed open and explain it. The research doc's ReaStream tap is the longer-term alternative and out of scope here.

## Phases

Each phase is one PR, in this order. Phases 1 to 4 need no REAPER.

| # | Phase | Main touches | Verification |
| --- | --- | --- | --- |
| 1 | **Read-aloud modal.** Extract the session core; add the modal, the chapter-header button and the key. Add the microphone list (enumeration and the saved choice) if the enumeration spike succeeds. | `components/teleprompter/*`, `Manuscript.tsx`, new `ReadAloudDialog`, sidecar `--list-devices`, host binding, state-catalog rows and drivers, atlas stories | Vitest; `pnpm check`; visual suite at all four viewports, looking at every PNG |
| 2 | **Story bible and notes in the reader.** Rail tabs and word-level marks. | `readerModel` offset-to-word mapping, `ReaderText`, reuse of `EntitySummary` and `NotesPanel` | Model unit tests; a click on a mark leaves cursor and scroll alone |
| 3 | **Start or move to a word.** "Start here" and "Go back to here". | Sidecar `--control-file`, `--start-word`, `reset_to`; Go `TeleprompterSeek`; `usePacedCursor` lands a backward move immediately; mock | Python tracker tests; Go service test with a fake sidecar; UI tests |
| 4 | **Proofing overlay.** Misread and extra-word marks, a heard-text tooltip (`TooltipTarget`), and a panel with dismiss and "Punch from here". | `script_tracker.py` flags, `replay.py` runs on the recorded mic readings, `readerModel`, `ReaderText` | Replay tests report false-flag counts on real readings |
| 5 | **DAW resume.** Track lookup, recorded end, `--locate`, and the resume card. Detect the DAW microphone if the spike allows. | Go track-name matching and last-end (with `.rpp` testdata), sidecar `--locate`, Lua `chapter_track_state`, host binding | Go tests; Python locate test; manual REAPER checklist |
| 6 | **Punch and roll, cursor and pre-roll.** Word to time, `punch_to`, anchors file. | Sidecar or host writes anchors, Lua `punch_to`, settings entry, ADR | Manual REAPER checklist after the play-position spike |

Later, not scheduled: arm and record from the punch point, time-selection auto-punch, extending anchors to improve precision, a trailing Whisper confirmation pass for flags (see the brief), and removing the standalone page.

## Spikes

Each of these launches REAPER on the narrator's machine, so run them only with explicit go-ahead.

1. Which position anchors recorded audio: `GetPlayPosition` (what is heard) or `GetPlayPosition2` (next block), measured against a known click, plus input latency. Gates phase 6.
2. Whether `GetAudioDeviceInfo` (an input-name attribute) or `reaper.ini` exposes the input device name, and how it compares with `dshow` names. Gates the detect step in phase 5.
3. Whether PyAV can list `dshow` devices without an ffmpeg call. Gates the list in phase 1.
4. Whether a saved `.rpp` reflects a recording in progress, and how long after stopping. Bounds the standalone "as of last save" caveat.
5. REAPER's overlapping-recording setting ("trim existing items"), and whether it can be read. Only needed once record is added.

## Risks

| Risk | Level | Mitigation |
| --- | --- | --- |
| The `.rpp` is stale while REAPER holds unsaved recordings, so the resume point is wrong | High | Prefer live bridge state in a REAPER session; label the standalone value "as of last save" |
| ASR false flags annoy the narrator | High | Precision over recall; suppress early-segment flags; wording says "suspected" |
| Recorded audio and play position are misaligned | High | Spike 1 before phase 6; show the resolved time and pre-roll to the narrator before moving the cursor |
| The tail-audio match lands on a repeated passage | Medium | Show the matched sentence; require confirmation; offer "Pick a word" |
| REAPER's device name does not match a `dshow` name, or REAPER holds it exclusively | Medium | Best-effort detection with a full list fallback; explain a failed open |
| Modal drift from the page while both exist | Medium | Both mount the same session core and view; one set of tests |
| Lua has no automated tests | Medium | Keep the Lua thin (read state, set the cursor); manual checklist per command |
| ADR numbers collide with open PRs (#31, #32 also claim numbers) | Low | Re-check `docs/adr/` immediately before numbering |

## Workflow requirements per phase

Follow `CLAUDE.md`: plan, then `change-impact-scan` before touching `shared/ui` components or `shared/reaper`, TDD, `full-verification-gate` (full `pnpm check`, the visual suite when `shared/ui` changed, a manual REAPER pass when Lua changed), `design-spec-guard`, `feature-cleanup`.

- New visible states need `state-catalog.ts` rows and `app.spec.ts` drivers (`visual-catalog-sync`) and refreshed doc screenshots (`doc-screenshot-sync`).
- New primitives or `Highlight` kinds need a `.stories.tsx` and an atlas run.
- ADRs: modal replaces the page (amends 0024), the sidecar control channel, DAW reads and the cursor mutation, and the resume locate approach.
- Update [manuscript-teleprompter.md](manuscript-teleprompter.md), `roadmap.md` and `shared/config/roadmap.json` together when the feature changes state.

## Acceptance criteria

- The modal opens from a chapter in the Manuscript page and follows the narrator's voice exactly as the page does.
- Story bible entries and notes are readable from the modal without moving the highlight or scroll.
- Every flag is reviewable (tooltip and panel) and nothing edits the manuscript or audio.
- Clicking a word moves the tracker there without restarting the session.
- With a matching track present, the modal offers a resume point with the matched sentence; without one it starts from the top and says so.
- Punch moves the REAPER edit cursor to the word's time minus the pre-roll and changes nothing else, in one undo block.
- With no confident DAW microphone match, the narrator can choose from every input device.
- No loopback server, REST endpoint or browser tab is introduced.
- The standalone page still works until it is deliberately removed.

## Open items

- Pre-roll default length.
- Whether the modal remembers text size and rail state per user (likely browser storage, like the microphone choice today).
- Whether "Punch from here" on an extra-word flag should target the word before or after the inserted words.
- Whether Transcript Compare's existing per-word timing can replace the offline alignment for word-to-time when a compare run for that take already exists.
