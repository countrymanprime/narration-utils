# Teleprompter Manuscript Integration (Reading Mode)

**Supersedes:** `docs/architecture/teleprompter-manuscript-integration.md` (whole file; coverage audited, nothing left uncarried) and, in `docs/architecture/manuscript-teleprompter.md`, the sections "Confirming suspected misreads", "Findings and review", the "Still open here" list and flagged-word design under "UI: what shipped and what is still open", the "Planned next" pointer, and the flag-, punch- and resume-related "Open items". **Source:** `manuscript-teleprompter.md` stays as the shipped design record (see `teleprompter-engines-and-input-devices.prd.md` for what stays).

Source plan: PR #35, `docs/architecture/teleprompter-manuscript-integration.md` (merged to `main` as ce5d9aa; this PRD supersedes it and the docs-replacement change removes the brief from the tree; recover it with `git show d5cc994:docs/architecture/teleprompter-manuscript-integration.md`). Later mentions of "PR #35" or "the plan" mean that brief. This PRD turns that plan into PR-sized phases and adds the gaps found while verifying it against the code. Citations are `file:line` on `main` (d5cc994; no code in the desktop host, the sidecars or the shared Python library changed since b9d348d apart from tests and dependency bumps) for anything checked in code; "per docs" marks a claim taken from a document and not verified.

## Problem Statement

A solo narrator reading a chapter aloud in REAPER today gets a standalone Teleprompter page that shows only plain chapter text: no story bible entries or manuscript notes, no marking of words they misread, added or skipped, no way to start or move to a chosen word, and no knowledge of what is already recorded in REAPER. A narrator who resumes a chapter halfway, or flubs a line and wants to punch back in, must find the place by hand in two windows, every time. That is repeated dead time and broken concentration inside the most expensive part of audiobook production (recording), and it is why the feature still sits under "Deferred" in the roadmap.

## Evidence

Verified in code (main, d5cc994):

- The page is standalone: chapter picker plus a typed microphone name (`apps/ui/src/components/teleprompter/TeleprompterPage.tsx:256-282`). It is a separate nav page, and the reader does not use `ParagraphView`, so it has no entity or note marks (ADR 0024 decision 1; `ReaderText.tsx:57-83` renders plain words only).
- No flags exist. The tracker deliberately ignores heard words that fit nothing nearby and steps over up to `MAX_SKIP = 2` script words (`sidecars/manuscript-teleprompter/core/script_tracker.py:20-26,34,73-87`). The only events it emits are `position` (with `jump`/`skipped` only for restarts and skips ahead, `script_tracker.py:98-127`). The frontend event union has no flag type (`apps/ui/src/api/contracts/teleprompter.ts:21-27`) and `reduceEvent` ignores unknown types (`readerModel.ts:111-122`).
- No seek and no host-to-sidecar channel other than `--stop-file` (`live_asr.py:486-494,628-664`). There is no `--control-file`, `--start-word` or `--locate` (grep of `sidecars/manuscript-teleprompter` found none).
- The host relays every valid JSON line verbatim (`apps/desktop/internal/teleprompter/service.go:209-231`), so new event types need no Go relay change. But the snapshot keeps only the last `script` and `position` (`service.go:219-227`), so any flag state would be lost when a view mounts mid-session.
- The reader ignores a one-word backward step unless the event carries a `jump` (`readerModel.ts:77-80`). A seek back by exactly one word would be swallowed as a "correction" unless the seek marks its position event as a jump. `usePacedCursor` already lands backward moves immediately (`usePacedCursor.ts:21`); PR #35 lists this as work to do, but it is already done.
- The REAPER Lua bridge has no play-state, play-position, track-state or audio-device command (commands at `integrations/reaper/narration_ui_bridge.lua:525-553`; grep of `integrations/reaper` for `GetPlayPosition`, `GetPlayState`, `GetAudioDeviceInfo`, `GetCursorPosition` finds nothing). Its only cursor move is `jump_to_compare_marker`, `SetEditCurPos(row.project_time, true, false)` with no undo block (`narration_ui_bridge.lua:531-543`).
- The static `.rpp` reader gives item position, length, name and source file only (`apps/desktop/internal/tracks/tracks.go:18-26`, `parse.go:65-98`). It does not read the source start offset (`SOFFS`) or `PLAYRATE`, so "the last 60 seconds of the last item's source audio" cannot be computed from it today.
- The chapter-to-track matching rule PR #35 says to port is `find_chapter_by_track_name` (`sidecars/transcript-compare/core/compare.py:900-940`). It depends on `normalized_tokens`, which merges spelled-out numbers (`compare.py:880-890`, `merge_number_words` at `:271`), so a faithful Go port is more than a string compare. Transcript Compare also owns a homophone canon (`compare.py:175-184`) that the live tracker does not have (`normalize_word` is lowercase plus stripping non-word characters, `script_tracker.py:46-47`; `words_match` is equality or a 0.8 spelling ratio for words of 4+ letters, `:56-63`). Numbers, hyphenation ("so-called") and homophones are therefore likely false-flag sources.
- The review actions a live flag might reuse do not fit as written. Transcript Compare's result row offers "Jump to manuscript", "Play recorded audio" (its tooltip says "Play heard audio", but `transcriptJump` only moves the REAPER edit cursor; nothing plays) and "Add pronunciation equivalence" (`Results.tsx:150-185`; `TranscriptAddEquivalence(id)` at `apps/desktop/bindings.go:456` takes a Compare result id and is enabled only for single-word misreads). There is no "Open in review" button, and a live flag has no result id, so those actions need their own binding or stay out of the first cut. The older brief's statement that `Results.tsx` plays back heard audio is wrong.
- The tracker's matching window is 40 script words back and 30 ahead of the anchor (`BACK_WORDS`, `AHEAD_WORDS`, `script_tracker.py:35-36,107`), not "the current paragraph plus the next" as the older brief describes it, and word matching is its own `difflib` ratio check, not the word-diff of `InlineDiffRow.tsx` or `compare.py`. `ReaderText` gives the current paragraph no background tint (only the `Cursor` fill, dimming and the dotted skipped underline, `ReaderText.tsx:19-38`). Transcript Compare's mismatch colors already exist as `KIND_STYLES` (`InlineDiffRow.tsx:3-7`: MISREAD `--review`, SKIPPED `--warn`, EXTRA `--info`).
- The modal primitive cannot host a full-screen reader: `Dialog` caps width at `max-w-[70vw]` and height at `80dvh` (`primitives/Dialog.tsx:20-24`, ADR 0001), and it has no Escape, focus trap or initial focus (when this was written `Dialog.tsx` had no key handling: the retired UI-defects register's defect 2, fixed since by the Base UI dialog, [ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)).
- Host API version lives in three places, all currently 5: `apps/desktop/app.go:33`, `apps/ui/src/hostApi.ts:2`, `apps/desktop/app_test.go:40`.
- The next free ADR number is whatever is free at merge time (0027 at d5cc994; `docs/adr/` ended at 0026); PR #35 warns numbers can collide with open PRs, so re-check before numbering and never hard-code one in a phase.

Per docs (not verified in code):

- Word times from Moonshine are noisy and only order is reliable (ADR 0021 decision 4). Whisper tiny confirmed-word lag median about 1.2 s; speculative partials expected to cut it to about 0.5-0.8 s (`manuscript-teleprompter.md`). True cursor lag on a live mic is not yet measured for either engine (project memory).
- REAPER automation research is Medium confidence on behavior and marks `GetPlayPosition` versus `GetPlayPosition2` as an open spike, and whether `GetAudioDeviceInfo` exposes the input device name as unverified (`docs/research/reaper-automation-surface.md` sections 2, 10).
- PromptVO markets live misread detection but documents no DAW mechanism (research doc section 7). Hard evidence that "losing place after a flub" is a top narrator pain point was not found; only marketing claims (research doc section 8).

Assumption - needs validation through a timed manual run: how long the narrator currently spends finding the resume place or the punch-in point per session. No baseline exists. Method: stopwatch the user doing it by hand on two real chapters before Phase 10.

## Proposed Solution

Make the teleprompter a reading mode of the Manuscript page: a full-size modal opened from a chapter header that reuses one extracted session core with the existing page, shows story bible and note marks and a key, flags suspected misreads, extra words and skipped words from the sidecar's own alignment (precision over recall, always "suspected"), lets the narrator start or move the tracker to a chosen word through a sentinel-file control channel, asks REAPER (or the saved `.rpp`) where the chapter's recorded audio ends and runs the tracker over that tail audio to offer a confirmed resume word, and finally moves the REAPER edit cursor to a word's time minus a pre-roll for punch-and-roll. Nothing edits text or audio; the only REAPER mutation is one narrator-triggered cursor move.

## Key Hypothesis

We believe a Manuscript-embedded reading mode with flags, seek, DAW-aware resume and cursor-only punch will remove the manual "find my place in two windows" step for solo narrators recording in REAPER. We'll know we're right when, on the user's own chapters, (a) a mid-chapter resume lands within 5 words of the true stopping point in at least 9 of 10 trials and takes under 30 seconds from opening the chapter, and (b) flags are trusted enough to be left on, meaning at most 1 false flag per 100 words on clean reads (both targets are proposals; baselines TBD, see Success Metrics).

## What We're NOT Building

- Record arm, transport control, or auto-punch by time selection - decided out of the first punch scope; cursor plus pre-roll only.
- A loopback server, REST endpoint, port or browser tab - recorded rule (`daw-integration.md`, ADR 0022).
- Any automatic edit of manuscript text, item notes, take names or audio - recorded rule; findings stay "suspected" and Transcript Compare stays authoritative.
- A trailing Whisper confirmation pass behind the live engine, or recheck-on-click of flags - deferred; the questions to settle first are recorded under Open Questions ("Confirming a flag later").
- Sherpa-ONNX or any other new live engine here - engine work is PRD 2; Sherpa-ONNX stays a fallback candidate only.
- Per-flag audio playback in the review panel - a live flag has no audio source (see "Confirming a flag later").
- Forced alignment (PyTorch, WhisperX, MFA) for word-to-time - ADR 0008 defers it; adopting it needs an ADR superseding 0008 with false-positive evidence.
- ReaStream, OSC or web-interface transports, or a native REAPER extension - the research doc lists them as the longer-term route; out of scope.
- Creating REAPER tracks or writing line IDs from this feature - resume only reads; line-identity stamping (ADR 0026) stays a separate initiative.
- The engine choice, Moonshine provisioning, packaging, auto-stop, manual-scroll fix and the microphone picker UX - owned by `teleprompter-engines-and-input-devices.prd.md`.
- macOS or Linux - Windows-first; the sidecar captures with `dshow` (ADR 0022 consequences).
- Removing the standalone Teleprompter page inside the feature phases - decided: it stays until the new feature is built and tested, then goes as its own change (Phase 13) because a nav change regenerates every doc screenshot.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Resume-point accuracy | Within 5 words of the true stopping word in at least 9 of 10 trials (proposal; corpus TBD) | Python `--locate` test over a fixture set of recorded tails plus 10 manual trials on the user's real chapters |
| Time from opening a chapter mid-way to reading at the right word | Under 30 s (baseline TBD; manual find not yet timed) | Stopwatch during the acceptance run |
| False flags on clean reads | At most 1 per 100 heard words (proposal; today 0 because no flags exist) | `replay.py` over the 3 existing real 55-word readings (per docs) plus at least 3 new mic readings, counted by a human |
| Flags surfaced on seeded errors | Report only; no recall gate (precision-first, spirit of ADR 0020) | Same replay corpus with deliberate misreads, extras and skips |
| Punch landing accuracy | Cursor within 0.5 s of target word onset minus pre-roll in 10 of 10 trials (proposal; gated on spike 1) | Manual REAPER checklist with a known click track |
| No unreviewed edits | Zero code paths that write manuscript, audio, notes or take names; exactly one REAPER mutation (edit cursor and view) | Code review of Lua commands plus the manual REAPER checklist |
| Existing page unaffected until Phase 13 | All current Teleprompter tests and visual states pass unchanged | `pnpm check`; Playwright suite (`ui-visual` CI job) |
| Reading invariants hold in the modal (carried from the shipped design record) | The view advances only in response to recognized speech, never a timer; a pause, ad-lib or restart never blocks the view or demands an exact retry; every flagged word is reviewable and none is auto-corrected; the batch sidecars (Manuscript Guide, Transcript Compare) behave unchanged | Modal tests over `?mockTeleprompter=` states; sidecar and Go service tests; `pnpm check` |
| Visual verification | Every new state reviewed as PNG at desktop, small-desktop, tablet, mobile | `apps/ui/screenshots/app/<page>/<state>/<viewport>.png`, per CLAUDE.md |

## Open Questions

- [x] **Microphone picker overlap with PRD 2 - RESOLVED (option (b) delivered).** PRD 2 (`teleprompter-engines-and-input-devices.prd.md`, PRs #300/#304/#307) landed the real dropdown-only `MicrophoneField` first; Phase 2 here merged that branch in and both `TeleprompterPage` and the new `ReadAloudDialog` import the same component (`apps/ui/src/components/teleprompter/MicrophoneField.tsx`) rather than rebuilding it. REAPER detection (Phase 11) and the confident-match preselect stay this PRD's, unbuilt until Phase 11.
- [ ] **Undo block for a cursor-only punch.** PR #35 says `punch_to` "runs in an undo block" and acceptance says "in one undo block", but moving the edit cursor changes no project data and the existing `jump_to_compare_marker` uses no undo block (`narration_ui_bridge.lua:537-540`); `daw-integration.md` requires undo blocks for mutations. Options: (a) no undo block for cursor and view only, consistent with the existing jump; (b) force an undo point anyway. Recommendation: (a), and record it in the ADR so the acceptance criterion is rewritten to "changes nothing except cursor and view"; add an undo block the day record arm or transport is added.
- [ ] **Source of word-to-time for the first punch.** PR #35 lists anchors file first, offline alignment second. Anchors need the host to poll REAPER's play position through the file bridge during a live session (about 50-100 ms per call in comparable bridges, per docs) and correlate it with engine word times that are advisory. Options: (a) anchors then offline alignment; (b) offline alignment only for the first punch, anchors as a later precision improvement; (c) reuse Transcript Compare per-word timing when a compare run exists. Recommendation: (b), consistent with the recorded decision that resume works from tail audio and must work for audio not recorded through the teleprompter. Anchors and (c) become follow-ups. When anchors are built (recorded shape from the plan): a file `<project>/narration-utils/teleprompter/<chapter>.anchors.json` written by live sessions as (word index, play position minus ASR latency), with anchors at or after word N dropped after a punch at N; which play position it samples is spike 1. Anchors are never written in this PRD's phases.
- [ ] **Where the chapter-to-track matcher lives.** Options: (a) port `find_chapter_by_track_name` and its number-word merge to Go with shared parity test cases; (b) call a Python sidecar mode; (c) reuse the future DAW Project Scan matcher (Phase 8 of `diagnostics-delivery-and-cleanup-tools.prd.md`; the retired DAW Project Scan brief planned the same mapping and it is unbuilt). Recommendation: (a), built once in Phase 8 here and consumed by that PRD's Phase 8, by PRD 2's "chapter from track name" phase and by the Review page's chapter grouping; never create a track.
- [ ] **What a live flag becomes after the session.** Options: (a) session-only, cleared when the modal closes; (b) written as `transcript_discrepancy` findings, status `unreviewed`, in the project sidecar via `apps/desktop/internal/findings` (contract exists, no host binding yet). Recommendation: (a) for this PRD; persistence is a separate decision because it needs a project-time anchor (findings contract) that only exists once punch/DAW correlation exists, and Transcript Compare over the recorded take is authoritative anyway. If (b) is chosen later it uses the shared findings contract (not a parallel data model) and, when REAPER is recording concurrently, anchors to the take being recorded (GUIDs first, project time as fallback, per `daw-integration.md`) so a review action can jump straight to it, as Transcript Compare rows do today.
- [ ] **Closing the modal during a live session.** Options: (a) closing stops the session, with a confirm while active; (b) session keeps running and the modal can be reopened (the host snapshot already supports mid-session hydration). Recommendation: (a). An orphaned live microphone capture is a privacy and CPU surprise; snapshot hydration stays for the standalone page and reopen-after-reload.
- [ ] **Which flag classes render by default.** Options: (a) all three (misread, extra, skipped); (b) skipped and misread on by default, extra behind a toggle until its replay false-flag rate meets the target. Recommendation: (b). `extra` is the most speculative class (a heard word that fits nothing nearby is exactly what the tracker treats as noise, `script_tracker.py:73-87`).
- [ ] **Do restarts count as flags?** The shipped design record said a skipped or repeated span "becomes a flagged item". Options: (a) flag only `skipped`, `misread` and `extra` (the plan's three classes); a `jump: "restart"` is the narrator's normal recovery after a flub and is not flagged; (b) also list a restarted span. Recommendation: (a). Flagging every re-read would penalize the recovery this feature exists to speed up; the restart already drives the highlight back and is what "Punch from here" is for.
- [ ] **Confirming a flag later (deferred, not in these phases).** A live result is never proof of a misread; even a final result only means the engine will not revise that line, and a wrong engine word looks identical to a genuine misread, so flags stay "suspected" and Transcript Compare over the recorded take stays authoritative. Two follow-ups were sketched. **Recheck on click (build first if pursued):** re-decode only the flagged audio span with `faster-whisper` (a larger model than the live path may be used) and show whether it agrees with the live engine; no continuous second pass. **Trailing confirmation pass:** run `faster-whisper` a few seconds behind the live engine, over flagged spans or every closed segment, so flags are confirmed or cleared automatically. Questions before either: CPU budget (the live engine must stay real-time on a CPU-only machine while a second model runs, which may force checking only flagged spans or only when idle); flagged spans only or every closed segment; lag budget and model size; how a flag moves from pending to confirmed or cleared without flicker; whether a cleared flag is kept as a dismissed, auditable finding (`findings-contract.md`); and, for both, where a span's audio comes from (a rolling buffer in the sidecar, or REAPER's concurrent recording, which needs the same word-to-time resolution as punch). The same audio-source question blocks any "play what I said" button on a flag: nothing in the app plays audio for a live flag today (see Evidence). Recommendation: defer all of it until Phases 6 and 7 have measured false-flag rates on real reads.
- [x] **Full-size dialog and modality scope - RESOLVED (delivered, [ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)).** Dialog focus trap, Escape, initial focus, hidden siblings and the modality decision belong to the Base UI `Dialog` for every dialog. This PRD's Phase 1 only adds the `size="full"` variant, so the reading modal is never a dialog that a stray Escape or Tab can escape, and no second modality ADR exists. Remaining question for this PRD: Escape must not silently stop a live session (ties to the close-behavior question); the dialog's Escape rule (close only when `onClose` or `onEscape` exists, or `escapeCloses` is false) is what the reader modal supplies or omits.
- [ ] **"Punch from here" on an extra-word flag: before or after the inserted words.** Options: (a) word before the insertion; (b) word after. Recommendation: (a). The cursor plus pre-roll should land ahead of the first unwanted audio; the extras sit between the two words, so the word after can fall inside them.
- [ ] **Pre-roll default length.** Options: 2 s, 3 s, 5 s, or read REAPER's own pre-roll preference (not investigated; TBD - needs research). Recommendation: 3 s as an assumption, a layered setting (`Teleprompter.punch_preroll_seconds`, global and project scope), range 0-10 s, revisit after the first real punch trials.
- [ ] **Where per-viewer reading preferences (text size, rail state) live.** Options: (a) browser storage like the microphone name today; (b) global settings. Recommendation: (a) for pure UI preferences; hardware and engine choices belong in settings (see PRD 2), so the two PRDs use one rule: UI layout in browser storage, machine facts in settings.

## Users & Context

**Primary User**
- **Who**: a solo author-narrator recording an audiobook in REAPER on Windows, reading from a manuscript already imported into the app, working chapter by chapter.
- **Current behavior**: reads from the Manuscript page or the Teleprompter page, types a microphone name, and locates the resume point or punch-in point by scrubbing REAPER and scrolling the manuscript by hand.
- **Trigger**: starting a session partway through a chapter, or flubbing a line mid-take and wanting to go back.
- **Success state**: opens the chapter, sees "Resume at word N (...the door opened)", confirms, keeps reading with the highlight following; after a flub, clicks "Punch from here" and finds the REAPER cursor a few seconds ahead of the word, ready to record.

**Job to Be Done**
When I sit down to record a chapter I have already partly recorded, I want the reading view to know where I left off and let me return to any word, so I can keep recording without hunting through two windows.

**Non-Users**
- Proofers and editors reviewing finished takes (Transcript Compare is their tool).
- Multi-narrator or studio setups with several concurrent sessions (single-session service by design, `service.go:166-178`).
- macOS or Linux users (Windows `dshow` capture).
- Narrators who record in a DAW other than REAPER: the reading mode, seek and flags work without REAPER; resume and punch need REAPER (Audacity is a deferred adapter).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | Open reading mode from a Manuscript chapter header as a modal; follows the voice exactly as the page does | 1, 2 |
| Must | Key/legend for every mark; new marks obey ADR 0016/0017 and pass the atlas | 2, 5, 7 |
| Must | Story bible and note marks readable in a side rail; clicking a mark never moves cursor or scroll | 5 |
| Must | Start at, or move back to, a chosen word without restarting the session | 3, 4 |
| Must | Suspected misread, extra and skipped flags, reviewable, dismissible, never editing anything | 6, 7 |
| Must | Resume point from tail audio with the matched sentence shown for confirmation; standalone `.rpp` path labelled "as of last save" | 8, 9, 10 |
| Must | Punch: move the REAPER edit cursor to word time minus pre-roll, nothing else changes | 12 |
| Should | Live REAPER state (track GUID, item ends, play state, cursor) preferred over the saved `.rpp` when the bridge is up | 11 |
| Should | Detect the DAW microphone; preselect only on a confident match and say why | 11 |
| Should | Pre-roll as a layered setting | 12 |
| Could | Use Transcript Compare per-word timing for word-to-time when a compare run exists | later |
| Could | Line identity (ADR 0026) as a coarse word-to-time source | later |
| Won't | Arm/record, time-selection auto-punch, anchors file, trailing Whisper pass, findings persistence, standalone page removal before acceptance | later / 13 |

### MVP Scope

Phases 1 to 7 (modal, marks, seek, flags) need no REAPER and are the first shippable slice. Phases 8 to 10 add resume from a saved `.rpp`. Phases 11 and 12 need REAPER and are gated on spikes that launch REAPER on the narrator's machine (run only with explicit go-ahead). Phase 13 retires the old page.

### User Flow

1. On the Manuscript page the narrator presses "Read aloud" on a chapter header. A full-size dialog opens with that chapter's text (taken from the manuscript context, so there is no chapter picker), a status bar, and a side rail (Key, Notes, Story bible).
2. The modal asks the host about the chapter's track. With a match it shows "Resume at word N ('...the door opened') / Start from the top / Pick a word" and never starts anything by itself.
3. The narrator confirms, accepts the DAW-detected microphone or picks one from the dropdown (never typed), and Start listens. The highlight follows the voice; read words dim; suspected flags appear as marks; opening a story bible entry or note in the rail does not move the highlight or scroll.
4. To move, the narrator clicks a word and chooses "Start here" or "Go back to here"; the tracker jumps there without restarting.
5. After a flub the narrator clicks a flag's "Punch from here" (or a word). The host shows the resolved time and pre-roll, then moves the REAPER edit cursor and view; transport and record arm are untouched. The tracker seeks to the same word in the same step, so the reader and the DAW agree on where the narrator is.
6. Closing the modal stops the session (subject to the open question) and nothing is written to the manuscript or audio.

## Technical Approach

**Feasibility**: MEDIUM overall. HIGH for phases 1 to 7 (extends existing seams). MEDIUM for 8 to 10 (resume accuracy on repeated passages, stale `.rpp`). MEDIUM-LOW for 11 and 12 (REAPER position anchoring and device name are unverified spikes; Lua has no automated tests).

**Architecture Notes**

- **One session core, two hosts.** Extract session logic from `TeleprompterPage.tsx` (reducer, subscriptions, start/stop, install prompt: `TeleprompterPage.tsx:101-226`) into `useTeleprompterSession`, and the word reader plus status bar into `ReadAlongView`. Page and modal mount the same two pieces, so one set of tests covers both until Phase 13.
- **Flags come from the sidecar's alignment.** The tracker already aligns heard words to script words (`advance`, `script_tracker.py:73-87`). Phase 6 adds `flag` events (`misread`, `extra`, `skipped`, each with script index and heard text) computed from confirmed words only, suppressed for the first words of a segment (where both engines revise most, per ADR 0021 context). Flag normalization needs Transcript Compare's number-word merge and homophone canon or the false-flag rate will be dominated by numbers and hyphenation; whether to move those helpers into `libs/python/narration_common` (change-impact-scan on both tools) or duplicate a subset is decided in Phase 6 (TBD - needs research).
- **Snapshot must carry flags.** Go stores only `script` and `position` for late subscribers (`service.go:219-227`); either the snapshot keeps a bounded flag list or the flag list lives in the session core above the modal (which the close-behavior decision makes moot). Decide in Phase 6.
- **Control channel.** `--control-file PATH`: the host appends one JSON object per line (`{"cmd":"seek","word":N}`), the sidecar tails it from a saved offset inside the existing chunk loop. `--start-word N` starts a session at a word. `ScriptTracker.reset_to(index)` sets anchor, display and committed together and the next `position` event carries `jump:"restart"` so `nextCursor` follows a one-word back-seek (`readerModel.ts:77-80`). Same sentinel-file pattern as `--stop-file`; no server or port.
- **Marks on words.** `ParagraphView` composes character-offset annotations (`ParagraphView.tsx:5-31`, `resolveNoteAnchor` at `:46`); the reader works on words. Map offsets onto word ranges in `readerModel` (words are whitespace tokens with their gaps, `readerModel.ts:7-15`). Marks are memoized per row like the cursor (ADR 0024 consequences). Formatting spans (ADR 0014) are out of scope for the reader.
- **Key and flag marks.** The key is a legend for every mark the reader can show: read words (dimmed), the current word (solid `Cursor` fill, ADR 0024), skipped (dotted underline, as today), misread (wavy underline), extra words heard (a caret between words), and story bible and note marks. New marks get a `Highlight` kind or a documented equivalent (ADR 0016/0017), reusing the Transcript Compare colors (`KIND_STYLES`) so a flag looks like the same finding there. A flagged word is a clickable `<mark role="button" tabIndex>` wrapped in `TooltipTarget` showing what was heard, and its click opens the detail panel, the same interaction `ParagraphView` wires for entities (`openEntity`) and notes (`openNote`). Panel actions in the first cut: dismiss and "Punch from here" (Phase 12). Whether the current paragraph row also gets a background tint (the original intended design; not implemented) is decided in Phase 7 against ADR 0024's `Cursor`-only choice.
- **Resume pipeline.** (1) Match chapter to track (Phase 8). (2) Recorded end = max(`Position + Length`) over the track's items, but audio time needs `SOFFS` and `PLAYRATE` added to `tracks` parsing (`parse.go:65-98`); the parser also takes only the first `<SOURCE>` of an item (`firstChild("SOURCE")`), so an item with several takes (comping) needs its active take resolved before "the last item's source audio" means anything, and the section-wrapped source (`SECTION`) start and length must feed the same offset arithmetic. (3) Host cuts the last ~60 s and runs the sidecar `--locate` (tracker "jump elsewhere when 3 or more words match" logic, `MIN_JUMP_MATCHES = 3`, `script_tracker.py:37`) against the whole chapter, returning a script word index plus matched sentence. (4) The narrator confirms. A `.rpp` mid-recording may have a stale header/length (growing WAV: research doc 5.2 E, unverified); label as of last save.
- **Live REAPER state.** New read-only Lua command `chapter_track_state` returning track GUID, item ends, play state, edit cursor, and a device read (spike 2). Protocol per `manuscript-line-identity.md`: `1|<command>|<args>` in `commands/NNNNNNNN.cmd`, results via `events.log` (`apps/desktop/internal/bridge/bridge.go:66-108`); report "uncertain outcome" on timeout instead of guessing (research doc 4.6). Lua stays out of the live listening loop entirely (the boundary the shipped design record drew): DAW reads are one-shot commands at chapter open or on demand, and the only mutation is the narrator-triggered punch.
- **Punch.** Lua `punch_to(time, preroll)` sets the edit cursor and scrolls the view only; failure reports without partial effects (`daw-integration.md`). Word-to-time comes from an offline alignment mode over the resolved range (the `--locate` machinery emitting word times), bounded by Whisper word-timestamp accuracy (ADR 0008). After the cursor moves, the tracker seeks to the same word through the Phase 3 control channel, so the reader and the DAW agree. Resolve the target by track GUID, not by name or index; a stale GUID reports a reviewable warning and never operates on an adjacent track (`daw-integration.md` acceptance criteria).
- **Host API.** Seek, resume lookup, punch and any device call add bindings: bump `hostAPIVersion` in `apps/desktop/app.go:33`, `apps/ui/src/hostApi.ts:2`, `apps/desktop/app_test.go:40` and regenerate `apps/ui/wailsjs/go/main/Host.{js,d.ts}`. New services snapshot pointers under `RLock` like `teleprompterService` (the `h.services()` pattern of `docs/architecture/host-binding-concurrency.md`). This PRD plans host API 5 to 6 (Phase 3), and `review-dashboard-and-findings-adoption.prd.md` also plans 5 to 6 then 6 to 7; whichever PR lands second increments again; check `hostAPIVersion` at merge time.
- **Dialog.** Phase 1 adds only a `size="full"` variant to `Dialog`; focus trap, Escape, initial focus and the hidden siblings are the delivered Base UI dialog's ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)). The reader modal keeps ADR 0002's button placement.
- **Constraints to honor**: ADR 0015 (real progress only; the highlight never runs ahead), 0016/0017 (all highlights through `Highlight`, no shadowing CSS; new kinds need a story and atlas pass, and the atlas debt list cannot grow), 0024, 0026.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Saved `.rpp` is stale while REAPER holds unsaved recording, so the resume point is wrong | High | Prefer live bridge state; label standalone value "as of last save"; always show the matched sentence and require confirmation |
| False flags (numbers, hyphenation, homophones, engine revisions) make the narrator distrust the overlay | High | Confirmed words only, suppress segment-initial words, reuse Transcript Compare normalization, `extra` off by default, measure on replay before enabling |
| `GetPlayPosition` vs `GetPlayPosition2` anchoring and input latency misalign word time and cursor | High | Spike 1 gates Phase 12; show the resolved time and pre-roll before moving the cursor |
| Tail-audio match lands on a repeated passage | Medium | Show matched sentence, require confirmation, offer "Pick a word" |
| REAPER's device name does not match a `dshow` name, or REAPER holds the device exclusively | Medium | Best-effort detection with full-list fallback; explain a failed open; never steal the device silently |
| Lua has no automated tests | Medium | Keep Lua thin (read state, move cursor); manual REAPER checklist per command; user sign-off before "verified" |
| `live_asr.py` becomes a merge hotspot (phases 3, 6, 9, 12 and PRD 2 all add arguments) | Medium | Put each feature in its own module (`control_channel.py`, `flags.py`, `locate.py`) and keep `live_asr.py` edits to argument wiring |
| Modal and page drift while both exist | Medium | Both mount one session core and one view |
| Status drift: `docs/README.md`, `docs/roadmap.md`, `config/roadmap.json` and the kept design record `manuscript-teleprompter.md` disagree as phases land (the planning brief is folded into this PRD, so its inbound links must not be left dangling) | Low | Each phase that changes state updates them together; Phase 13 does the final pass; re-check ADR numbers before writing |
| Two initiatives bump the host API version concurrently | Low | Treat the bump as a merge-time serialization point: the later PR bumps again and rebases |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Dialog full-size variant | `Dialog` gains `size="full"` only; stories and atlas coverage. Modality (Escape, focus trap, initial focus, hidden siblings) is delivered ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)) | complete | 3, 6, 8 | - | - |
| 2 | Session core and read-aloud modal | Extract `useTeleprompterSession` and `ReadAlongView`; add `ReadAloudDialog`, chapter-header button, `MicrophoneField` seam; page unchanged in behavior | complete (start/stop only; seek, marks, flags, resume, punch are Phases 3-12) | 3, 6, 8 | 1 | - |
| 3 | Seek channel | Sidecar `--control-file`, `--start-word`, `reset_to`; Go `TeleprompterSeek`; contract and mock; host API bump; ADR | complete | 1, 2, 8 (6 with rebases) | - | - |
| 4 | Seek UI | "Start here" / "Go back to here" on a word; back-seek follows via `jump`; visual states | pending | 6, 8 | 2, 3 | - |
| 5 | Story bible and notes marks | Offset-to-word mapping, rail tabs, `EntitySummary` reuse and a notes list, no cursor or scroll change on click | pending | 3, 6, 8 | 2 | - |
| 6 | Live flag events | `flag` events in the sidecar with precision gates, replay false-flag report, contract types, mock recording regenerated | pending | 1, 2, 5, 8 (3 with rebases) | - | - |
| 7 | Flags UI | Marks, heard-text tooltip, review panel, dismiss, "Punch from here" placeholder, key entries | pending | 8 | 2, 6 (sequence after 4 and 5); tooltip reachability is delivered ([ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md)), and this phase adds the inline (flowing text) mode to `TooltipTarget`, which the component accessibility PRD deferred here; `palette-contrast-wcag-aa.prd.md` Phase 4 (Highlight colours) | - |
| 8 | Chapter-track match and recorded end | Go matcher (with number-word merge), `SOFFS`/`PLAYRATE` parse, recorded end, binding | pending | 1, 2, 3, 4, 5, 6, 7 | - | - |
| 9 | Tail-audio locate | Sidecar `--locate`, Go orchestration (cut tail, run, return word index and sentence), binding | pending | 4, 5, 7 | 8 | - |
| 10 | Resume UI | Resume card in the modal (resume / top / pick), "as of last save" label, visual states | pending | 11 | 2, 9 | - |
| 11 | Live REAPER state and input detection | Lua `chapter_track_state` (read-only), device read, Go bridge client, confident-match preselect; manual REAPER checklist | pending | 9, 10 | 8; spikes 2 and 4; PRD 2 phase 2 (soft) | - |
| 12 | Punch and roll | Offline word-time alignment, Lua `punch_to`, pre-roll setting, "Punch from here", ADR; manual REAPER checklist | pending | - | 7, 9, 11; spike 1 | - |
| 13 | Retire the standalone page | Remove page, nav item and duplicated tests; regenerate all doc screenshots; docs and roadmap update | pending | - | 2-12 accepted | - |

### Phase Details

**Phase 1 - Dialog full-size variant**
- **Goal**: a dialog that can host a full-screen reader. It is modal because it builds on the delivered Base UI dialog ([ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)); this phase does not plan its own modality work or ADR.
- **Scope**: `primitives/Dialog.tsx` (the `size="full"` variant only), a story for it, and atlas coverage that reuses the dialog PRD's `play()` (tabs past the last control, Escape). No key handling, focus trap or `inert` changes here and no modality ADR (both belong to the dialog PRD). No Manuscript changes.
- **Success signal**: existing dialogs (Story Bible delete, Import) unchanged visually at all four viewports; the full variant fills the viewport with a margin and scrolls its body; the dialog PRD's Tab/Escape assertions pass for the new variant.

**Phase 2 - Session core and read-aloud modal**
- **Goal**: open reading mode from a chapter and read exactly as on the page.
- **Scope**: extraction listed above; `Manuscript.tsx` chapter-header button; key for existing marks (read, current, skipped); `MicrophoneField` extracted from `TeleprompterPage.tsx:267-282` and used by both; state-catalog rows and drivers; doc screenshot; atlas stories.
- **Success signal**: the page's current tests pass unchanged; modal reaches the same highlight behavior via `?mockTeleprompter=listening`; PNGs reviewed at four viewports.

**Phase 3 - Seek channel**
- **Goal**: the host can move a running tracker to a word, and a session can start at a word.
- **Scope**: `sidecars/manuscript-teleprompter/core/control_channel.py`, `script_tracker.py` `reset_to`, `live_asr.py` argument wiring, tests; Go service append-only control file plus `TeleprompterSeek` binding; version bump in three places plus regenerated Wails bindings; contract, `wailsClient.ts`, mock; ADR for the control channel.
- **Success signal**: Python tracker tests for seek forward, back by one word, back by many, out of range; Go test with a fake sidecar (existing pattern, `service_test.go`); one-word back-seek is followed.

**Phase 4 - Seek UI**
- **Goal**: click a word, start or move there.
- **Scope**: word click affordance in `ReaderText`/`ReadAlongView` (never triggered by mark clicks in Phase 5), `readerModel` seek handling, paced cursor behavior for seek, visual states and docs.
- **Success signal**: seek lands within one paced step; next spoken word advances from the new place (mock and a manual live check).

**Phase 5 - Story bible and notes marks**
- **Goal**: see entities and notes while reading without disturbing the highlight.
- **Scope**: offset-to-word mapping in `readerModel`, `Highlight` reuse (existing kinds), rail tabs reusing `EntitySummary` and a notes list (`NotesPanel` was deleted as unused by the Knip cleanup, verification PRD phase 8: recover it with `git log --diff-filter=D -- apps/ui/src/components/manuscript/NotesPanel.tsx` or write a new one), sharing annotation helpers from `ParagraphView` (change-impact-scan: the Manuscript reader consumes them).
- **Success signal**: model unit tests for entity and note ranges across word boundaries; clicking a mark leaves cursor and scroll position unchanged; Manuscript page tests still pass.

**Phase 6 - Live flag events**
- **Goal**: the sidecar reports suspected misreads, extras and skips with a measured false-flag rate.
- **Scope**: `flags.py`, tracker alignment output, `replay.py` extended to count flags per reading, contract types, regenerated `teleprompterRecording.json` via `record_mock_stream.py`, decision on normalization sharing and on snapshot retention, Go relay unchanged.
- **Success signal**: replay report on the 3 existing real readings plus new ones meets the false-flag target or the class stays off by default.

**Phase 7 - Flags UI**
- **Goal**: review flags without leaving the modal.
- **Scope**: marks (misread wavy underline, extra-word caret, skipped dotted underline; new `Highlight` kinds or a documented equivalent, ADR 0016/0017, stories, atlas with no debt growth), heard-text tooltip via `TooltipTarget`, panel with dismiss, key entries for every mark, "Punch from here" disabled until Phase 12. Depends on the delivered tooltips ([ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md): a hint is hoverable, persistent and closes on Escape), adds the inline (flowing text) mode to `TooltipTarget` (a flag is a `<mark role="button">` inside running text, so the trigger must render as the mark and flow with the line; the component accessibility PRD's question 8 deferred it here because nothing else uses it), and on `palette-contrast-wcag-aa.prd.md` Phase 4 (the `Highlight` kinds and their text colours meet WCAG AA); build the flag marks on those, not on today's `Tooltip` and `Highlight`.
- **Success signal**: every flag reviewable and dismissible; nothing edits text or audio; visual states at four viewports.

**Phase 8 - Chapter-track match and recorded end**
- **Goal**: given a chapter, find its track and where the recorded audio ends, standalone.
- **Scope**: Go matcher with parity cases from `compare.py` (the narrator can pick a track when no match is confident; never create one), `tracks` parse of `SOFFS`/`PLAYRATE` and the active take, testdata `.rpp` cases (multi-item, multi-take, trimmed section, playrate), host binding, version bump; update `docs/utilities/tracks.md` to point at the matcher's owner (the DAW Project Scan brief was superseded by `diagnostics-delivery-and-cleanup-tools.prd.md` and removed). The matcher also considers project region names (for example the chapter regions created by `create_chapter_regions`), not only track names. It returns a confidence and an explicit `ambiguous` state and never silently picks between near-equal candidates. It honours a narrator-stored manual override (kept in the project sidecar) over fuzzy matching. Its result is the one shared track-to-chapter mapping used by Home measured duration, resume, line identity and review dashboard chapter grouping.
- **Success signal**: Go tests including "Chapter 1" vs "Chapter 11" and "CHAPTER ONE" vs "Chapter 1"; no match is a state, never a created track. Tests also cover multi-take tracks, renamed or reordered tracks, and chapters with no matching track yet; an ambiguous or renamed track is flagged, not silently mismatched.

**Phase 9 - Tail-audio locate**
- **Goal**: turn the recorded tail into a resume word.
- **Scope**: `locate.py`, `--locate` mode (audio range in, script index and sentence out), Go orchestration and binding, fixtures (recorded tails, including a repeated passage), ADR for the tail-audio locate approach (why not anchors from past sessions).
- **Success signal**: locate test hits the accuracy target on fixtures and reports low confidence on the repeated-passage fixture.

**Phase 10 - Resume UI**
- **Goal**: offer resume with confirmation.
- **Scope**: resume card states (found, none, low confidence, stale `.rpp`, source audio missing or unsupported per `tracks.Item.SourceAvailable`/`Supported`), a track picker when the match is not confident, "Pick a word" flow reusing Phase 4, mock, visual states.
- **Success signal**: without a matching track the modal starts from the top and says so; with one it never starts by itself.

**Phase 11 - Live REAPER state and input detection**
- **Goal**: prefer live REAPER state and identify the microphone REAPER uses.
- **Scope**: Lua read-only commands, Go bridge client with timeout and "uncertain" reporting, fuzzy match to `dshow` names, preselect with reason, manual checklist doc, ADR for DAW reads.
- **Success signal**: manual REAPER checklist passes and the user signs off; with the bridge down the modal falls back to the `.rpp` and the full device list.

**Phase 12 - Punch and roll**
- **Goal**: cursor to word time minus pre-roll, nothing else.
- **Scope**: word-to-time over a range, Lua `punch_to` (with the tracker seeking to the same word afterwards), settings entry (`fieldSchemas` at `apps/desktop/app.go:673-679`, `config/defaults.json`, `Settings.tsx`, `mockFixtures.ts`), UI showing resolved time and pre-roll before moving, ADR (cursor mutation and undo-block decision).
- **Success signal**: manual REAPER checklist with a known click; only cursor and view change.

**Phase 13 - Retire the standalone page**
- **Goal**: one reading surface.
- **Scope**: delete page and nav item, `App.tsx`/`App.test.tsx`, `AppShell.tsx` NAV, visual catalog and drivers, `doc-screenshots.json`, all `docs/images/ui/*.webp`, the guide (`docs/guides/using-the-app/teleprompter.md` is rewritten into the Manuscript page or removed, and `README.md` index plus the Previous/Next footers of its neighbors must stay consistent or `docsGuide.test.ts` fails), `docs/README.md` inventory rows, `codebase-map.md`, ADR amending 0024 (modal replaces page), `manuscript-teleprompter.md`, `roadmap.md` and `config/roadmap.json` together.
- **Success signal**: full `pnpm check`, visual suite green, screenshots regenerated and reviewed.

### Parallelism Notes

Phases 1, 3, 6 and 8 have no dependencies and touch disjoint areas (primitives, sidecar plus Go seek, sidecar flags, Go tracks), so they can run concurrently, subject to the shared-file notes below. Phases 4, 5 and 7 all edit `ReaderText.tsx` and `readerModel.ts`; run them in order 4, 5, 7 (or accept rebases). Phases 9 to 12 form a chain. Phase 13 is last and must not overlap anything that touches the nav or the screenshots.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `primitives/Dialog.tsx`, `Dialog.stories.tsx`, atlas tests | The dialog PRD's Phase 2 (same `Dialog.tsx`; land it first), any session editing dialogs or `styles.css` |
| 2 | `components/teleprompter/*`, `components/manuscript/Manuscript.tsx`, `tests/visual/{state-catalog.ts,app.drivers.ts,doc-screenshots.json}`, `docs/guides/using-the-app/{manuscript.md,teleprompter.md}` (guarded by `apps/ui/src/docsGuide.test.ts`), `docs/images/ui/*` (new) | PRD 2 phases 2, 3, 4, 7, 9 and 11 and `release-readiness-provisioning-and-docs-site.prd.md` Phase 1 (all touch `TeleprompterPage.tsx`; PRD 2 phase 4 and release-readiness Phase 1 change the install loop that Phase 2 here would extract, so land them first). Recommended sequence: release-readiness Phase 1, PRD 2 Phase 4, then this Phase 2, then PRD 2's remaining phases; anyone landing out of order rebases (the dialog PRD's Phase 4 also touches this file's one `ConfirmDialog` call). Other Manuscript work |
| 3 | `sidecars/manuscript-teleprompter/core/{live_asr.py,script_tracker.py,control_channel.py}`, `apps/desktop/internal/teleprompter/service.go`, `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/contracts/teleprompter.ts,api/wailsClient.ts,api/mockApi.ts,api/teleprompterMock.ts}`, `apps/ui/wailsjs/go/main/Host.*`, ADR | Every phase that adds a binding or a sidecar argument; host API version and ADR number |
| 4 | `ReaderText.tsx`, `readerModel.ts`, `usePacedCursor.ts`, visual catalog | 5, 7 and PRD 2 phase 10 (manual scroll edits the same follow logic in `ReaderText.tsx`) |
| 5 | `readerModel.ts`, `ReaderText.tsx`, `manuscript/ParagraphView.tsx`, `EntitySummary.tsx`, `ReadAloudDialog.tsx` | Anything touching the Manuscript reader |
| 6 | `script_tracker.py`, new `flags.py`, `live_asr.py`, `replay.py`, `contracts/teleprompter.ts`, `teleprompterMock.ts`, `teleprompterRecording.json`, `spikes/record_mock_stream.py`, maybe `libs/python/narration_common`, `sidecars/transcript-compare/core/compare.py` | Phase 3 and PRD 2 phases 1 and 6 (`live_asr.py`), PRD 2 phase 7 (contract) |
| 7 | `ReaderText.tsx`, `readerModel.ts`, `Highlight.tsx` and stories, atlas debt list, tooltip use | Phases 4, 5; other `Highlight` users; adds the inline mode to `TooltipTarget` (delivered tooltips, [ADR 0049](../adr/0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md); `TooltipTarget` on a `<mark role="button">`) and must follow `palette-contrast-wcag-aa.prd.md` Phase 4 (Highlight colours; both edit `Highlight.tsx`) |
| 8 | `apps/desktop/internal/tracks/*` (+testdata), new matcher file, `apps/desktop/{bindings.go,app.go,app_test.go}`, `hostApi.ts`, Wails bindings, `docs/utilities/tracks.md` | Any Tracks page work; diagnostics PRD Phase 8 and the review dashboard's chapter grouping (consumers of the mapping); host API version |
| 9 | new `locate.py`, `live_asr.py`, `apps/desktop/internal/teleprompter/*`, bindings and version | 3, 6 (`live_asr.py`), PRD 2 phases 1 and 6 |
| 10 | `ReadAloudDialog.tsx`, visual catalog, mock | 2, 4 |
| 11 | `integrations/reaper/narration_ui_bridge.lua`, `apps/desktop/internal/bridge`, teleprompter service, checklist doc | Any Lua work (no tests; needs the user's REAPER); the `integrations/reaper` bridge is shared with Transcript Compare |
| 12 | `narration_ui_bridge.lua`, sidecar alignment mode, settings files (`apps/desktop/app.go`, `defaults.json`, `Settings.tsx`, `mockFixtures.ts`), UI | PRD 2 phases 3 and 7 (same `fieldSchemas` map and `Settings.tsx`) |
| 13 | `AppShell.tsx`, `App.tsx`, `App.test.tsx`, all doc screenshots, roadmap files, guide | Everything; do this alone |

Cross-cutting: every phase re-checks `docs/adr/` numbering immediately before writing an ADR; every phase that adds a binding bumps `hostAPIVersion` in `apps/desktop/app.go`, `apps/ui/src/hostApi.ts`, `apps/desktop/app_test.go` and regenerates `Host.{js,d.ts}`; every `apps/ui` phase runs `visual-catalog-sync`, the Playwright suite with PNG review at all four viewports, `doc-screenshot-sync`, and (for primitives or `styles.css`) the atlas and `design-spec-guard`; every phase follows CLAUDE.md: plan, `change-impact-scan`, TDD, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard`, `feature-cleanup`. Phases 11 and 12 add Lua: nothing automated proves them, so the user must run the manual REAPER checklist before they count as verified.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Teleprompter as a Manuscript reading mode | Modal from a chapter header (prior decision) | Keep only the standalone page | The chapter and notes are already in Manuscript context |
| Standalone page | Keep until the new feature is built and tested, then remove as its own change (prior decision) | Remove immediately | A nav change regenerates every doc screenshot |
| Resume point | Run the tracker over the tail audio of the track (prior decision) | Anchors from past live sessions | Works for audio not recorded through the teleprompter; anchors later |
| First punch scope | Move the edit cursor to word time minus pre-roll only (prior decision) | Arm and record; auto-punch | Smallest safe mutation |
| Microphone | Detect what REAPER uses if reliable, else list all inputs and let the narrator choose from a dropdown; a typed name is never accepted (prior decision, reaffirmed by the user 2026-09-20) | Typed name | Typed names are error-prone |
| Local-first, no loopback server, REST or port (prior decision, `daw-integration.md`, ADR 0022) | Sentinel files and Wails events | WhisperLive server, web interface server | Recorded boundary |
| Findings are suspected; Transcript Compare stays authoritative (prior decision) | Flags labelled "suspected" | Present as errors | Live ASR is never proof (`manuscript-teleprompter.md`) |
| Never edit text or audio automatically (prior decision) | Read-only plus one narrator-triggered cursor move | Auto-fix | Product boundary |
| Position tracking model (prior decision, shipped design record) | Continuous alignment with pause and resume, driven only by recognized speech; a match anywhere in the window jumps and resumes | A hard gate ("do not advance until said exactly right"); a pace-based clock with rewind | A gate turns every filler word or ad-lib into a stall; a clock has no grounding in what was said, drifts for slow readers, dense passages and pauses, and scores against a timeline instead of the narrator's speech |
| Where listening runs (prior decision, ADR 0022) | Native Wails host; the Python sidecar owns mic capture and inference, Go owns process lifecycle, device plumbing and event relay; Lua is not in the live loop | Loopback server, Lua-driven capture | Consistent with the no-loopback rule and the DAW boundary |
| Both engines behind one event contract (prior decision, ADR 0021) | Flags are engine-independent events | Engine-specific flag logic | Adapters swap without UI change |
| Highlight rules (prior decisions, ADR 0016, 0017, 0024) | New marks through `Highlight`; no shadowing CSS | Ad hoc styles | Consistency; atlas gate |
| Line identity in item extension data (prior decision, ADR 0026) | Not written by this feature | Sidecar mapping | Separate initiative |
| Timing confidence over forced alignment (prior decision, ADR 0008) | No forced alignment for word-to-time | WhisperX / MFA | No PyTorch dependency |
| Precision over recall for flags (spirit of ADR 0020) | Confirmed words only, early-word suppression | Flag every mismatch | Trust in the overlay |
| Control channel | Sentinel file the sidecar tails (proposed, from PR #35) | Loopback socket | Same pattern as `--stop-file` |
| Workflow | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup (prior decision, CLAUDE.md) | Fast check only | History of silent regressions |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |
| Flag persistence, undo block for cursor punch, word-to-time source, matcher location, close behavior | Recommendations under Open Questions | See there | Pending the user's answers |
| Dialog modality ownership (implementation plan D4) | The Base UI foundation stack owns dialog modality (delivered, [ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md)); this PRD's Phase 1 adds only the `size="full"` variant on the existing modal shell, no second modality ADR | A modality ADR scoped to this PRD | Avoids re-litigating a decision the foundation stack already settled; matches the "Full-size dialog and modality scope" open question, resolved |

## Research Summary

**Market Context**
- PromptVO markets a voice-following teleprompter with live misread detection (skipped, added, swapped words) and post-recording proofing, and says it "integrates with existing DAWs" without a mechanism; TelePrompterProTools drives Pro Tools over PTSL; Descript's teleprompter has no DAW sync; DialogueWorkflow drives a browser teleprompter through REAPER's web interface (all per `docs/research/reaper-automation-surface.md` section 7, secondary sources). The research doc found no public punch-and-roll navigator on ReaPack (inferred from absence in search results). The differentiator is local, DAW-aware resume and cursor punch tied to the manuscript, with flags that never edit.

**Technical Context**
- Reused, verified: streaming supervisor and Wails events (ADR 0022), tracker and event contract (ADR 0021), reader model and paced cursor (ADR 0024), `Highlight` (ADR 0016), `Tooltip`/`TooltipTarget`, `EntitySummary` (the former `NotesPanel` was deleted as unused, see phase 5), `.rpp` parser (`tracks`), Lua file bridge and its command protocol, the layered settings files.
- Unverified and gated on spikes (each launches REAPER, run only with the user's go-ahead): which play position anchors recorded audio (`GetPlayPosition`, what is heard, or `GetPlayPosition2`, the next block), measured against a known click plus input latency; whether an input device name (a `GetAudioDeviceInfo` attribute, documented only for `MODE`, `BSIZE` and `SRATE`, or `reaper.ini`) is readable from REAPER; whether a saved `.rpp` reflects a recording in progress and how long after stopping (this bounds the standalone "as of last save" caveat); whether `dshow` device names can be listed without an ffmpeg call (owned by PRD 2); REAPER's overlapping-recording setting ("trim existing items") and whether it can be read (only needed once record is added).
- Doc and code discrepancies found while verifying the plan are recorded under Evidence; none block a phase but Phase 8 must fix the `tracks` parse gap.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
