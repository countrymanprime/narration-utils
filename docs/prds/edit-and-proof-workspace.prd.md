# Edit and Proof Workspace: One Chapter Screen to Listen, Follow the Script, See Mistakes, Compare Takes and Apply Effects

**Source:** owner request of 2026-09-24: "The Tracks page could have a built-in Whisper and proofing. I have the ability to listen to the track, and I know that it ties to a chapter. These things should be doable. What I really want out of the app, in some place, is a way to listen to the track as it goes through the script, showing me where it messed up; allowing me to listen to alternate configurations (different takes); allowing me to click on a word to back it up to that point; highlight and right-click on a section and add common effects or effect chains I have set up in the DAW. Basically one screen where I can do all of my editing and proofing visually as well as audibly." Follow-up the same day: "that might mean joining pages together in the long run." Citations are `file:line` at `3afa459`.

**Builds on:** the Tracks page and its `/media` player ([Tracks](../utilities/tracks.md), [ADR 0012](../adr/0012-media-route-for-track-playback.md)); the confirmed chapter-track link ([ADR 0100](../adr/0100-analysis-evidence-is-two-hash-keys-one-ledger-record-per-run-and-a-narrator-confirmed-track-map.md), [ADR 0110](../adr/0110-one-go-chapter-to-track-matcher-ported-from-transcript-compare-with-explicit-confidence-states.md)); the recording check's words cache and alignment ([recording check](../utilities/recording-coverage.md), ADRs [0126](../adr/0126-recording-coverage-reads-the-take-markers-sequencematcher-alignment-and-folds-chance-matches-into-gaps.md) to [0130](../adr/0130-the-home-recording-check-opens-on-the-stored-result-runs-only-on-a-press-and-labels-the-recorded-length-measured-or-estimated.md)); the findings store and the Review page ([Review Dashboard and Findings Adoption](review-dashboard-and-findings-adoption.prd.md)); REAPER Go to and Loop ([going to and looping a finding](../architecture/reaper-navigation.md), [ADR 0121](../adr/0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md)); [take review](../utilities/take-review.md) and take comparison ([ADR 0141](../adr/0141-per-take-divergence-is-localized-by-the-markers-diff-and-asr-word-timestamps.md), [ADR 0165](../adr/0165-a-take-comparison-is-one-finding-per-group-over-its-one-span-built-from-the-saved-project-and-never-ranked.md)); retakes on fixed lanes ([ADR 0147](../adr/0147-retakes-on-fixed-lanes-are-chosen-by-lane-play-state-and-the-app-never-converts-takes-and-lanes.md)).

**Takes over:** the "Transcript/waveform view and highlight-and-delete/apply-FX actions" that [Diagnostics, Delivery Reports and Cleanup Tools](diagnostics-delivery-and-cleanup-tools.prd.md) parked as later work (its "What We're NOT Building", `diagnostics-delivery-and-cleanup-tools.prd.md:67`), except delete (EP16). **Supplies:** the paragraph-to-time mapping that [Proofing Preview Suggestion](proofing-preview-suggestion.prd.md) Phase 6 and Q8 still need. **Delivers:** the "Make active" action that take review left as later work (`docs/utilities/take-review.md`, Decisions: "The app never sets the active take. An explicit, confirmed 'Make active' action is a later addition").

**Status (2026-09-25):** in progress, tracked by [#546](https://github.com/countrymanprime/narration-utils/issues/546). The open questions take this PRD's recommended answers (D39 in the [implementation plan](implementation-plan.md#6-owner-decisions-2026-09-24)), except EP8 and EP9, which [ADR 0234](../adr/0234-fx-chains-go-on-tracks-and-a-passage-of-a-take-gets-one-plug-in-at-a-time.md) replaced, and EP18, which only the owner can answer. The REAPER commands for Phases 6, 8 and 9 (`set_active_take`, `list_fx_chains`, `list_fx`, `apply_fx_chain`, `add_take_fx`) were built by stream B1 behind the experimental switch ([ADR 0230](../adr/0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md), [ADR 0233](../adr/0233-the-app-may-make-a-take-active-by-guid-in-one-undo-step.md)). Lane train streams: B3 (Phase 0's desk work, Phase 1's sidecar and wire slice, the host peaks for Phase 5), lane A (Phase 1's stored alignment and read binding, the peaks binding), lane C (Phases 2 to 9's UI).

## Problem Statement

A narrator proofing and editing a chapter today moves between five places and REAPER. The Tracks page plays a track but shows no text. Home's recording check lists missing regions by paragraph number. The Proofing page lists Transcript Compare's differences as rows. The Review page holds findings, take-review groups and take comparisons one at a time. REAPER holds the audio, the takes and the effects. Nothing shows the script *as the audio plays*, so the narrator cannot hear a mistake and see it in the text at the same moment. They cannot click a word to hear it again. They cannot hear the alternate takes of a passage in place and pick one. They cannot mark a passage and apply one of their own REAPER effect chains to it. Every check the app already runs produces words with times, but none of them is shown against the script as one timeline, and each edit means finding the same spot again in REAPER by hand.

## Evidence

**The Tracks page plays audio, but not as REAPER plays it, and with no text.**
- The page is a track list, a transport (play/pause, back and forward 30 s, previous and next track), the chapter links list and six REAPER tool dialogs (`apps/ui/src/components/tracks/TracksPage.tsx:91-132`, `:207-275`). It reads the saved `.rpp` directly and works with REAPER closed (`docs/utilities/tracks.md`, "How it works").
- Playback is a WebView `Audio` element over the in-process `/media` route (`useTrackPlayback.ts:16-17`, `apps/desktop/media.go:9-43`), with HTTP Range seeking (ADR 0012). `/media` serves any take's source that the selected `.rpp` references and nothing else (`media.go:61-76`, threat model row 6b).
- **The player ignores each item's trim.** It sets `audio.src` to the item's whole source file and starts at 0 (`useTrackPlayback.ts:81-83`), so it plays audio before `SOFFS` and after the item ends, skips the gaps between items, and ignores play rate. The wire item has only `position`, `length`, `name` and the active take's source (`apps/ui/src/api/schemas/tracks.ts:5-14`). `SOFFS`, `PLAYRATE`, `SECTION` and every take stay in Go (`apps/desktop/internal/tracks/tracks.go:31-61`, `:81-107`, all `json:"-"`). The mock says so: "The mock project's items carry no SOFFS or PLAYRATE on the wire" (`apps/ui/src/api/chapterTrackMatchMock.ts:57`). Word times are in source seconds (below), so a workspace player has to honour the played range before the text can follow it.
- No FX, fades, item or take gain, or crossfades are applied in the app. Analysis reads raw sources: the editing readiness PRD's "processed-audio caveat" (`editing-readiness-analysis.prd.md:147`).

**Word-level timings already exist and are cached per source range.**
- The recording check's sidecar transcribes each item's played range with `word_timestamps=True` and stores `(word, start, end)` in **source seconds** (`sidecars/transcript-compare/core/coverage_mode.py:255-265`). The host keeps these words files in the evidence cache, one blob per source with up to 256 range segments (`apps/desktop/internal/coverage/words.go:24-33`, `:15-18`), and reuses the narrowest segment that covers a played range (`words.go:105-119`). So a trim or split that narrows a range costs **no** new transcription.
- The sidecar then aligns the chapter's text to those words with the take markers' `SequenceMatcher` alignment (`coverage_mode.py:486`, ADR 0126). **It writes only counts and regions.** The per-token alignment (`alignment`, with its `index_map`) and the joined `timeline` are used to place each region's first word (`coverage_mode.py:374-396`) and are then thrown away (`:492`). A region carries one audio point, `RegionPosition{ItemIndex, ItemGUID, SourceTime}` (`apps/desktop/internal/coverage/report.go:84-98`). The model cascade PRD notes the same limit (`recording-check-model-cascade.prd.md:30`).
- **Take comparison already produces the karaoke data for one passage.** Each read has every script word's status (`matched`, `misread`, `skipped`, `unread`) with `start` and `end`, plus divergences with the script text, the audio text and times (`apps/ui/src/api/schemas/takeReview.ts:109-131`, ADR 0141). Whisper's word times put every constructed divergence on the right words within a quarter of a second on the synthetic fixtures (`docs/utilities/transcript-compare.md`, "Alignment and confidence").
- Transcript Compare (the Proofing page) also transcribes with word timestamps, but through the live bridge (`prepare_compare`) and a temp words file. Its rows become `transcript_discrepancy` findings with item and take GUIDs and a source time range (`docs/architecture/reaper-navigation.md`, "Finding the spot"). The Proofing nav item needs a linked DAW file (`apps/ui/src/components/layout/AppShell.tsx:24-30`).

**Cost of getting the words.** `small` takes about 5 minutes of CPU for a 30-minute chapter, `large-v3-turbo` about 10, and `tiny` 1.5 to 2 s per audio minute. Loading a model takes 0.2 s (`tiny`) to 3.2 s (`large-v3-turbo`), and cost is per 30-second block (`recording-check-model-cascade.prd.md:7`, `:22-28`). Once a chapter's words are cached, aligning it again costs seconds, with no transcription.

**Flags the app can already place on the text.**

| Flag | Source today | Carries a time? |
| --- | --- | --- |
| Skipped, read short, different text, start or end not read | Recording check regions (`report.go:91-98`) | First word only |
| Misread inside read text | Transcript Compare rows (findings); counted as present by the check ("misreads count as read", `recording-coverage.md`) | Yes, source range per finding |
| Extra words, repeats, restarts, pickups | Check's `extraTokens` (a count only); take review `pickup` and `duplicate_read` groups (findings with per-read ranges) | Take review: yes. Check: no |
| Proofer's pickup notes | `PICKUP:` project markers, read live over the bridge (`narration_pickups.lua`); plain markers are not parsed from the `.rpp` (`recording-check-summary.prd.md:41`) | Project time |
| Silence, clicks, breath (planned) | Editing readiness `silence_cleanup` findings (`editing-readiness-analysis.prd.md:194`) | Yes |

**REAPER already takes the narrator to a word; it cannot yet apply effects or change the active take.**
- `navigate_item(item_guid, take_guid, source_time)` selects the item and puts the edit cursor at the source time mapped through the take's offset and rate, with no undo point, and refuses a stale item, take or range (`integrations/reaper/narration_navigation.lua:330`, `docs/architecture/reaper-navigation.md`). `loop_context` loops a source window and `stop_loop` restores the narrator's selection, loop and repeat (ADR 0121). Those are exactly "click a word to back it up to that point" in REAPER, except that the host bindings take a finding id only (`apps/desktop/bindings_navigation.go:113-159`).
- `create_take` adds a read as a new take and **never calls `SetActiveTake`** (`narration_take_review.lua:73`, `:129`). `pick_retake_lane` changes which fixed lane plays, in one undo block, only for items carrying a line id (`narration_retake_lanes.lua:105`, ADR 0147). No command sets the active take.
- **No command applies FX.** Threat model row 5h: "Only `launch_cleanup_tool` calls `Main_OnCommand`, and only for a key in its allow-list" (`docs/architecture/threat-model.md:109`). The parser records whether a take or track has an FX chain, not what is in it (`tracks.go:98-100`). The only FX calls in the repo are in a spike that builds fixtures (`integrations/reaper/spikes/build_cases.lua:104-108`). The research lists action 40209, "Apply track/take FX to items", unverified (`docs/research/reaper-automation-surface.md:64`, `:221`).
- No bridge command reads the play position or the edit cursor for a consumer outside the pickups navigator. The teleprompter PRD's `chapter_track_state` (Phase 11) and `punch_to` (Phase 12) and the resume PRD's live cursor read are all unbuilt (`read-aloud-resume-from-daw.prd.md:34`, `teleprompter-manuscript-integration.prd.md:173-174`). Spike S4 (`GetPlayPosition` against `GetPlayPosition2`) is pending on audio hardware (`reaper-automation-follow-through.prd.md:224`).
- The heartbeat `PROJECT_STATUS` says only whether REAPER is reachable and which `.rpp` is open (`apps/desktop/internal/bridge/wire.go:68-73`). `project_state` returns a change count, so "REAPER has changes the saved file does not" can be detected (`docs/architecture/reaper-bridge.md`, commands table).

**Other gaps a workspace hits.**
- **No waveform code exists anywhere** (`native-recording-suite.prd.md:16`). The Go host has a streaming WAV reader (`apps/desktop/internal/measure/wav.go:81-241`) and a take source range reader (`measure/range.go`), for WAV only.
- **No context menu primitive.** `Menu` is a trigger-button dropdown over Base UI's menu (`apps/ui/src/components/primitives/Menu.tsx:1`, `:39`). The manuscript's selection toolbar is a portal toolbar, not a primitive (`apps/ui/src/components/manuscript/SelectionMenu.tsx:1-40`), and it reads the selection through `useTextSelection` (`apps/ui/src/hooks/useTextSelection.ts:56`).
- **No routes with parameters.** Nine flat routes (`apps/ui/src/App.tsx:289-330`) and no `useSearchParams` anywhere in `apps/ui/src`, so there is no deep link to a chapter, a word or a finding today.
- **The check does not filter fixed lanes.** The coverage manifest skips only muted items (`apps/desktop/internal/coverage/manifest.go:76-104`). On a track in fixed-lane mode, retakes on lanes that do not play would be aligned as extra audio (EP15).

## Proposed Solution

A **chapter workspace**: one screen per chapter that shows the chapter's script, its recorded audio and everything the app knows about the difference between them, and does every edit through REAPER.

1. **Listen and follow.** A transport plays the chapter's recorded audio in the app as REAPER's items describe it (each item's played range, in order). The script scrolls with it and the word being spoken is highlighted, karaoke-style. It works with REAPER closed.
2. **See where it went wrong.** Flags sit inline in the text: skipped words struck through in place, misreads shown with what was heard, extra words, repeats and restarts shown as a marker between words with the heard text, pickups and proofer notes as margin marks. Each flag is a finding the narrator can accept, dismiss, defer or note, in place.
3. **Click a word.** A click moves the in-app playhead to that word. A second action, or a setting (EP5), also moves REAPER's edit cursor there with the existing `navigate_item`.
4. **Compare takes.** Select a passage and open **Takes**: every alternate the project holds for it (other takes on the item, retakes on fixed lanes, take-review reads) with its per-word evidence. Audition each in the app, A/B, then **Use this take** in REAPER: make it active, pick its lane, or add it as a take and make it active, each one undo step.
5. **Waveform strip.** A timeline of the chapter's items with peaks, the playhead, flags and the selection, in step with the text.
6. **Apply an effect to a passage.** Select words (or drag on the waveform), right-click, and choose one of the narrator's REAPER FX chains or favourite effects. The host maps the words to item and source ranges and asks REAPER to apply it non-destructively, in one undo step (the mechanism is EP9).

**Source of truth.** REAPER owns the audio, the timeline, the takes and every edit. The app never writes an audio file, never edits the `.rpp` on disk, and never changes REAPER except through a bridge command the narrator pressed, each of which is one undo step or no undo step at all. The app owns the analysis (words, alignment, flags, peaks, in the evidence cache) and the review decisions (the findings store). The workspace reads the **saved** `.rpp`, and says so ("as of the project's last save") when REAPER reports changes that are not saved yet (EP11).

**Where it lives (EP1).** Recommended: a chapter route opened from the Tracks page, where the owner looks for it, and from Home, Review and the Manuscript. The route is keyed by chapter id (`/tracks/chapter/:chapterId`), so no nav item is added in the MVP and no doc screenshot is regenerated for one. Consolidating pages into it is a late phase (Phase 10) with its own open questions (EP13, EP14).

Sketch (desktop width, a current check, in-app playback):

```
Tracks › Chapter 6 — The Glass Orchard            as of last save 10:02 · REAPER connected   [Check again]
┌ waveform: item 1 ▁▂▅▇▅▂▁ | item 2 ▁▃▆▇▆▃▁▂ ... ▲flag ▲flag   ▮playhead         [selection ░░░] ┐
└──────────────────────────────────────────────────────────────────────────────────────────────┘
 ◀◀ 5s   ▶ Play   5s ▶▶   14:22 / 24:10   Speed 1.0×   Follow: [In app | REAPER]   [Go to in REAPER]

 ¶14  She crossed the yard and ~~opened the~~ door without a sound.    ⟵ skipped (2 words)   [Accept] [Dismiss]
 ¶15  The [pale|pink] eyes watched her from the ▾"the the" hedge.     ⟵ misread · repeat
 ¶16  ██Nobody██ had lived there since the fire.                       ⟵ highlighted word = now playing
      └ selection "since the fire" · right-click → FX chains ▸ De-ess light · Room tone fill · …  Takes (3) ▸
```

## Key Hypothesis

We believe a chapter screen that plays the recording against the script, flags the differences in the text, and takes every edit to REAPER in one click will let the narrator proof and fix a chapter without hunting for spots in REAPER or moving between Home, Proofing, Review and Tracks. We'll know we're right when the owner proofs a real chapter end to end in the workspace, and the time from "I heard a mistake" to "I hear it again in REAPER with the cursor on it" is one click, against today's route through the Proofing or Review page.

## What We're NOT Building

- **No audio written by the app.** No render, no bounce, no destructive edit, no `.rpp` edit on disk. REAPER does every change, in its undo history.
- **No new transcription engine or forced alignment.** The recording check's Whisper words and `SequenceMatcher` alignment are reused (ADR 0008 and ADR 0141 keep forced alignment deferred).
- **No ranking of takes and no composite score.** Take review's rule stands: evidence per category, the narrator chooses.
- **No delete, cut, ripple edit, crossfade or comp building from the app** unless EP16 says so. The owner asked for effects and takes.
- **No running of arbitrary REAPER actions or scripts.** Effects are FX chains (and, if EP8 says so, a narrator-curated allow-list), named by the host and resolved by REAPER.
- **No Audacity support** in this PRD. The Audacity PRD owns that DAW's surface.
- **No change to what the recording check measures or how it judges.** The check keeps its settings, thresholds and ADRs. This PRD adds output to it.
- **No live-recording view.** Recording with the script is the Teleprompter and Read aloud.
- **No pitch-correct play-rate emulation, FX preview or fade emulation in the app player.** The app plays raw sources. Hearing the processed result is REAPER's job (Follow REAPER mode).

## Success Metrics

| Metric | Target | How measured |
| --- | --- | --- |
| Follow accuracy | With a current check, every present script token in a played item has a time. The highlighted word is the one whose Whisper interval contains the playhead, drawn within one animation frame of the audio clock | Vitest on the pure token-at-time function; Playwright state with a mocked clock |
| Click-to-seek (app) | The playhead lands at the clicked word's start minus the pre-roll (EP5) in the right item | Vitest on the seek mapping; visual state |
| Click-to-seek (REAPER) | `navigate_item` puts the edit cursor within 10 ms of the word's mapped project time. A stale item answers the existing stale refusal and moves nothing | Harness (existing `navigation_test.lua`); Go test of the token-to-GUID mapping; scripted REAPER run |
| Flags equal the check | Every interior region of the stored report is a flag on the same tokens; head and tail show as "not recorded yet" | Go test over the coverage fixtures: alignment flags equal report regions |
| Played range honoured | The app plays each item from `SOFFS` for `length × rate` in position order, and never plays audio outside an item | Vitest on the playlist builder; Go contract test on the new item fields |
| Every REAPER change is one undo step | Make active, apply FX: exactly one undo point each, named "Narration Utils: …"; one Undo in REAPER restores the project | Harness tests with the fake's undo log and mutation checks; scripted REAPER run recorded |
| Nothing moves REAPER unasked | No bridge command is sent except from a press. Refusals (standalone, not running, stale, recording) change nothing | Go tests; threat-model rows updated |
| Offline works | With REAPER closed, script, flags, playback, waveform, audition and review decisions all work; REAPER actions are disabled with the reason | Visual states `standalone`, `not-running` |
| Owner proofing run | The owner proofs one real chapter in the workspace and records the time against their usual method | Owner session, recorded in the steady-state doc (pending until run) |
| Gate | `pnpm check`, the visual suite (axe clean, no new `axe-debt.ts` entry) at every viewport with the PNGs read, `pnpm --dir apps/ui run aria` for the new dialogs and menus, `pnpm --dir apps/ui atlas` for new primitives | `full-verification-gate` |

## Open Questions

- [x] **EP1. Where does the workspace live?** Options: (A) a chapter route under Tracks (`/tracks/chapter/:chapterId`), opened from a linked track on Tracks, from Home's chapter row, from a Review finding ("Open in workspace") and from the Manuscript chapter header, with no new nav item; (B) a new nav item ("Edit" or "Chapter") with a chapter picker; (C) evolve the Review page: select a chapter and the finding list becomes the workspace; (D) replace the Tracks page body: pick a linked track and the page becomes the workspace. Recommendation: A. It is where the owner looked ("the Tracks page could have…"), it is chapter-keyed like every analysis the app runs, it adds no nav item (a nav change regenerates every doc screenshot and must land serially, README "Adding a nav item"), and Phase 10 can still promote it to a nav item. C mixes a cross-chapter queue with a single-chapter editor. D loses the project-level tools on Tracks. **Answered (D39, D30): A.** A chapter route under Tracks, no nav item in the MVP.
- [x] **EP2. Which player does the MVP use?** Options: (A) the app's own player over `/media`, raw sources, works with REAPER closed, exact word sync; (B) REAPER's transport, with the app following REAPER's play position over the bridge (hears FX, fades and edits, needs REAPER, a latency of a few hundred ms per round trip, spike S4); (C) A in the MVP, then B as a "Follow REAPER" toggle (Phase 7). Recommendation: C. A is buildable now and matches the word times exactly. B is what the narrator hears after edits and effects, so it comes once the position feed is measured. **Answered (D39, D30): C.** The app's own player first; Follow REAPER is Phase 7.
- [x] **EP3. Where does the chapter's word alignment come from?** Options: (A) the recording check writes it as an additive artifact beside its report, so a current check is enough to open the workspace; (B) a separate "align" sidecar mode that reads only cached words and never transcribes; (C) A, plus B when the check is stale but every range is already in the cache, so the workspace re-aligns in seconds after a trim or split. Recommendation: C. The words cache already survives trims and splits, so most edits need only a re-align. Whether the workspace ever transcribes by itself (without a press) follows the auto-sync PRD's answer on background checks (`daw-chapter-track-auto-sync.prd.md`, Phase 7). **Answered (D39): C.** The check writes the alignment (Phase 1), and align-again re-aligns from cached words only.
- [x] **EP4. Which differences are flagged, and how loudly?** Candidates: skipped text, read short, different text (all from the check); misreads inside read text (the check counts them as read; Transcript Compare flags them); extra words, repeats and restarts (audio words the alignment did not match); take review's pickup and duplicate groups; proofer pickup markers; editing readiness candidates (silence, clicks). Options: (A) all, each kind with its own mark and a filter; (B) only the check's regions and misreads in the MVP, the rest in Phase 4; (C) B, with a low-confidence dimming like the Review page's 50% filter. Recommendation: C. ASR is not proof (`transcript-compare.md`, "Acceptance and risks"), so a flag says "heard" and never "wrong". **Answered (D39): C.** The check's regions and misreads in the MVP, low-confidence dimmed; the rest in Phase 4.
- [x] **EP5. What does a word click do?** Options: (A) move the app's playhead only, with "Go to in REAPER" as a button for the current word; (B) move both when REAPER is connected; (C) click moves the app, Alt-click (or a setting) also moves REAPER; and the pre-roll before the word (0, 1 or 2 s). Recommendation: C with a 1 s pre-roll in the app and none in REAPER (the narrator's own pre-roll applies there). B would move REAPER on every click, which threat row 5f treats as a narrator action, so it must stay explicit. **Answered (D39): C.** Click moves the app with a 1 s pre-roll; Alt-click also moves REAPER, with no pre-roll there.
- [x] **EP6. How are the alternate takes of a passage found and shown?** Sources: (1) other takes on the same item; (2) retakes on fixed lanes (today only for items with a line id, ADR 0147); (3) take-review reads whose span overlaps the passage (pickup track or later in the session). Options: (A) a Takes panel for the selected passage listing all three with source labels, per-word evidence for each (a take comparison over the passage), and in-app A/B audition; (B) only (1) and (2), with no transcription; (C) A, but a take that was never transcribed shows "not compared" until the narrator presses Compare (cost). Recommendation: C. Inactive takes are not in the check's words, and transcribing every take of a chapter up front costs as much as a second check. **Answered (D39): C.** All three sources, and a take never transcribed shows "not compared" until Compare is pressed.
- [x] **EP7. How is a take chosen?** Options: (A) "Use this take" makes it the item's active take in REAPER (new `set_active_take`, one undo step); for a lane retake it calls the existing `pick_retake_lane`; for a take-review read on another item it runs `create_take` and then makes the new take active, in one confirmed action; (B) the app only goes to the take in REAPER and the narrator chooses there; (C) A, but always behind a confirm dialog. Recommendation: A, with a confirm only for the two-step add-and-activate. This reverses take review's "the app never sets the active take" (a new ADR). The item's length and position never change, as with `create_take`. **Answered (D39): A.** Confirm only the two-step add-and-activate. `set_active_take` is built ([ADR 0233](../adr/0233-the-app-may-make-a-take-active-by-guid-in-one-undo-step.md), Accepted).
- [x] **EP8. Which effects are offered, and how are they found?** Options: (A) every `.RfxChain` in REAPER's `FXChains` folder (listed by the Lua under `GetResourcePath()`, names only, never a path from the app); (B) A, filtered to favourites the narrator picks in Settings; (C) B plus a short built-in list of REAPER stock plug-ins with presets (ReaEQ, ReaComp, ReaGate); (D) B plus narrator-picked custom actions or scripts from REAPER's action list. Recommendation: B. D widens threat row 5h from two allow-listed actions to anything the narrator picks. It needs the owner's say-so and its own ADR. **Answered by the owner (2026-09-25, [ADR 0234](../adr/0234-fx-chains-go-on-tracks-and-a-passage-of-a-take-gets-one-plug-in-at-a-time.md)), replacing the recommendation.** Chains are listed from `FXChains` for a track or the master track; a passage is offered single installed plug-ins (`EnumInstalledFX`); favourites (B) apply to both. D stays out.
- [x] **EP9. How is an effect applied to a passage?** Options: (A) split the item at the passage's edges and add the chain as **take FX** on the middle piece's active take: visible, removable, one undo step, but it creates two new items (new GUIDs on the right halves; line-id stamps survive a split per spike S0); (B) A, then REAPER's "Apply track/take FX to items as new take" (40209) to print it, keeping the original take; (C) a track FX with a bypass or wet envelope over the passage: no split, but it touches the whole track and needs envelope points; (D) add the chain as take FX on the whole item (no split) when the passage covers most of it. Recommendation: A, with a small handle (EP10) and crossfade left to REAPER's defaults. Spike SF (Phase 0) must confirm REAPER loads an `.RfxChain` onto a take by API (`TakeFX_AddByName` with a chain file, or the chain text inserted into the take's `<TAKEFX>` through the item state chunk), and what a split does to the take's FX, markers and extension data. **Answered by the owner (2026-09-25, [ADR 0234](../adr/0234-fx-chains-go-on-tracks-and-a-passage-of-a-take-gets-one-plug-in-at-a-time.md)), replacing the recommendation.** A passage is split at its edges and one installed plug-in goes on the middle piece's take per request (A's mechanics, never a chain); a chain goes on a whole track or the master track. Spike SF's remaining questions are scripted in `integrations/reaper/spikes/spike_ep0_workspace.lua`.
- [x] **EP10. Immediate or queued?** Options: (A) each edit is sent when the narrator confirms it; (B) edits collect in an "edit list" the narrator reviews and applies in one go, as one undo step or one per edit; (C) A while REAPER is connected, and B when it is not, applied on reconnect with every GUID re-checked. Recommendation: A for the MVP of each action. B and C need a stored edit list whose targets can go stale while REAPER is closed, and the existing stale refusals only protect one command at a time. **Answered (D39): A.**
- [x] **EP11. What about changes in REAPER that are not saved?** The workspace reads the saved `.rpp`. Options: (A) show "REAPER has changes that are not saved; the workspace shows the last save" (from `project_state`'s change count) and ask the narrator to save; (B) read the chapter track's live items over the bridge (the teleprompter's and resume PRD's `chapter_track_state`) and prefer them; (C) A in the MVP, B once `chapter_track_state` exists. Recommendation: C. After an edit from the workspace (make active, apply FX) the saved file is stale by definition, so the workspace should expect it and re-read on save. **Answered (D39): C.** The notice first; `chapter_track_state` now exists ([ADR 0231](../adr/0231-chapter-track-state-is-one-read-only-answer-of-the-transport-the-arms-the-input-device-and-one-tracks-items.md), Proposed) for the live read.
- [x] **EP12. Is the waveform in the MVP, and where do the peaks come from?** Options: (A) the host computes min and max peaks from WAV sources with the existing reader, cached per source identity in the evidence cache; (B) REAPER's own `.reapeaks` files next to the media (undocumented binary format, present only after REAPER has built them); (C) peaks from REAPER over the bridge (`GetMediaItemTake_Peaks`, main thread, needs REAPER). Recommendation: A, and not in the MVP. The text is the timeline the owner asked for. A non-WAV source shows "no waveform" rather than decoding in Go. **Answered (D39): A.** Host peaks from WAV sources; the UI is Phase 5, after the MVP.
- [x] **EP13. Which pages join the workspace in the long run?** See [Page inventory and consolidation](#page-inventory-and-consolidation). Options per page: merge, link, or keep. Recommendation there: merge the Tracks player, the Proofing page's per-chapter results and the Home recording check result into the workspace; keep Review as the cross-chapter queue with "Open in workspace"; keep Manuscript, Teleprompter, Story Bible and Delivery; retire the Retakes on lanes dialog into the Takes panel. **Answered (D39, D30):** the recommendation; the pages merge in Phase 10, later.
- [x] **EP14. What is it called, and does it get a nav item?** Options: (A) "Chapter" (the screen is a chapter); (B) "Edit & Proof"; (C) "Studio"; and (1) no nav item, reached from Tracks and the chapter rows; (2) a nav item that opens the last chapter; (3) Tracks renamed, with the workspace as its main view. Recommendation: A and (1) for the MVP, then (3) in Phase 10 if the owner merges the Tracks player. **Answered (D39): A and (1)** for the MVP; Phase 10 decides (3).
- [x] **EP15. Fixed-lane tracks.** The check aligns every unmuted item, including retakes on lanes that do not play. Options: (A) the check (and so the workspace) reads only items on lanes that play (`Track.PlayingLanes`, `tracks.go:139-144`), a change to the check that makes some stored results stale; (B) leave the check alone and let the workspace hide words from lanes that do not play; (C) not now. Recommendation: A, only if the owner records on fixed lanes. It is a real correctness gap in the check whether or not the workspace ships. **Answered (D39): A, only if the owner records on fixed lanes.** Not scheduled until the owner says so (EP18).
- [x] **EP16. Delete and silence?** The diagnostics PRD parked "highlight-and-delete" with apply-FX. Options: (A) out of this PRD; (B) a "Mute passage" (split and mute the middle piece) that is as reversible as FX; (C) ripple delete. Recommendation: A, with B as a Could if the owner asks. C moves everything after it, which the app never does today. **Answered (D39): A.**
- [x] **EP17. Playback speed.** Options: (A) 0.75× to 2× with pitch kept (the WebView's `playbackRate` and `preservesPitch`); (B) 1× only. Recommendation: A, because proofing at 1.25× to 1.5× is common and it costs one control. **Answered (D39): A.**
- [ ] **EP18. Which chapter runs the MVP on the owner's machine?** The owner's real chapter and timeline layout (chapters one after another on one track, or one track per chapter; takes or lanes; pickup track) decide EP6, EP9 and EP15. Recommendation: pick one recorded, checked chapter before Phase 2 is verified. **Waits for the owner** (#510): the chapter used to verify Phase 2.

## Users & Context

**Primary user:** the narrator (the owner) after a recording session, proofing and editing their own chapter. Secondary: a proofer working in the same project on the same machine.
**Current behavior:** runs the recording check on Home, reads regions by paragraph, runs Transcript Compare on the Proofing page, opens findings on Review, presses Go to in REAPER, listens in REAPER, fixes it there, and does the takes and effects in REAPER by ear.
**Trigger:** a chapter has been recorded and checked, or the narrator wants to listen through it.
**Success state:** the narrator plays the chapter, sees it follow the text, stops at a flag, clicks the word, hears it again, auditions the other take, uses it, applies their de-ess chain to the sibilant passage, accepts or dismisses the flag, and moves on, all in one screen, with REAPER showing the same edits in its undo history.
**Job to be done:** When I proof a chapter, I want to hear it against the script and fix what I find without hunting for the spot, so I can finish editing in one pass.

## Solution Detail

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | The chapter's per-word alignment (status, item, take and source time for each script token; heard extra words with times) stored with the check and read by a binding | 1 |
| Must | Items on the wire with their played range (`sourceStart`, `playRate`, take GUID), so the app player plays what REAPER plays | 1 |
| Must | Workspace route and header: chapter name, check state (current, stale, never) with Check again, "as of last save", REAPER status | 2 |
| Must | In-app playback of the chapter's items in order, honouring each item's played range; play, pause, back and forward, speed (EP17) | 2 |
| Must | Karaoke highlight and auto-scroll, with scroll-lock when the narrator scrolls away | 2 |
| Must | Inline flags from the alignment (EP4) with a legend and a next and previous flag | 2 |
| Must | Click a word to seek the app player (EP5) | 2 |
| Must | Keyboard: Space play/pause, arrow keys by word and paragraph, `[` and `]` by flag, a shortcut for Go to in REAPER | 2, 3 |
| Should | Go to in REAPER for a word or flag, and Loop in REAPER for a selected passage (existing commands) | 3 |
| Should | Findings overlaid on the text (Transcript Compare, take review, editing candidates) and reviewed in place: accept, dismiss, defer, note | 4 |
| Should | "Open in workspace" from Review, Home and the Manuscript chapter header, landing on a finding or a word | 4 |
| Should | Waveform strip with playhead, flags and selection | 5 |
| Should | Takes panel for a selected passage: alternates, per-word evidence, in-app A/B, Use this take (EP6, EP7) | 6 |
| Could | Follow REAPER: highlight from REAPER's play position (EP2) | 7 |
| Should | FX chain discovery and favourites (EP8) | 8 |
| Should | Right-click a passage to apply an FX chain in REAPER, non-destructively, one undo step (EP9) | 9 |
| Could | Mute passage (EP16 B) | 9 |
| Could | Consolidation of overlapping pages (EP13) | 10 |
| Won't | Audio written by the app, delete or ripple edit, take ranking, arbitrary actions or scripts, Audacity | - |

**MVP scope:** Phases 0 (the owner's answers and the alignment-output part of the spikes), 1, 2 and 3: listen, follow, flags and click-to-seek, in the app and in REAPER. That uses only existing REAPER commands.

**User flow (MVP, EP1 A, EP2 C, EP5 C):**
1. Tracks shows **Open workspace** beside each linked chapter (and Home's chapter row does the same). The workspace opens at the chapter's first word.
2. With no current check, the header says so and offers **Check recording** (the existing job) or, when every range is cached, **Align again** (EP3). With a stale check, the text still shows, labelled "from the last check".
3. Play. The text scrolls and the spoken word is highlighted. Flags show in the text. `]` jumps to the next flag and plays from one second before it.
4. The narrator clicks a word. The app plays from there. Alt-click, or **Go to in REAPER**, also puts REAPER's cursor on it. With REAPER closed, the button is off with "Open this app from the Narration Utils action in REAPER".
5. Later phases: select the passage, **Takes**, audition, **Use this take**; right-click, **Apply FX chain ▸ De-ess light**, confirm; accept the flag.

### Page inventory and consolidation

The owner's follow-up ("that might mean joining pages together in the long run") asks which pages overlap. Today:

| Page or view | What it does | Overlap with the workspace | Proposed long-run fate (EP13) |
| --- | --- | --- | --- |
| **Tracks** (`/tracks`) | Track list, transport, chapter links, six REAPER tool dialogs | Its player is the workspace's player without text; the chapter links are the workspace's entry | **Split.** The player and "listen to a chapter" move into the workspace. The project-level tools (Link chapters, Pickups import and export, Prepare chapter render, Embed chapter tags, Cleanup tools) stay on a project page, which is what Tracks becomes ("REAPER project") |
| Tracks › Retakes on lanes dialog | Pick which lane plays per line | Same job as the Takes panel, for lanes only | **Merge** into the Takes panel, then retire the dialog |
| Tracks › Pickups dialog | Import a proofer's CSV as markers; step through them | Pickup markers are flags in the workspace | **Keep** import and export on the project page; show and resolve a chapter's markers in the workspace |
| **Proofing** (`/proofing`) | Run Transcript Compare for a chapter track; results with inline diffs; Export markers | Its results are the workspace's misread flags; its run is a second transcription of the same audio | **Merge** the per-chapter results into the workspace. Keep the run and Export markers as workspace actions until the check's alignment covers misreads (then decide whether Transcript Compare still runs separately). Retire the page and redirect `/proofing` to the workspace's chapter picker |
| **Home** › recording check dialog | The chapter's check result | The workspace header is the same summary ([Recording Check Summary](recording-check-summary.prd.md) RS7 asks where it lives) | **Link.** The summary component is shared; the dialog gets "Open workspace". If the auto-sync PRD retires the Check button, the summary can live in the workspace only |
| **Review** (`/review`) | Every finding in one queue; take-review groups; take comparison; audition | Chapter findings are the workspace's flags; take comparison is the Takes panel's evidence | **Keep** as the cross-chapter queue. A finding's detail gets "Open in workspace". The take comparison view is shared, not duplicated |
| **Manuscript** (`/manuscript`) | Read, search, annotate the text; Read aloud | The workspace renders the same paragraphs | **Keep.** Share the paragraph renderer; the chapter header gets "Open workspace" |
| **Teleprompter** and Read aloud | Record with the script | Different job (recording, live) | **Keep** |
| Home › chapter track panel (planned, [Chapter Track Link Control](chapter-track-link-control.prd.md) Phase 2) | Track facts, relink, and in its Phase 4, play and "Select in REAPER" | Its Phase 4 is a small version of the workspace | **Link.** The panel gets "Open workspace" and drops its own player if this PRD lands first |
| Story Bible, Delivery, Settings | Unrelated jobs | Settings gains the FX favourites (EP8) | **Keep** |

**Navigation and deep links.** Phase 2 adds the first parameterised route (`/tracks/chapter/:chapterId`, with `?t=<seconds>` for a word or `?finding=<id>`), so Back and Forward ([App Navigation and Zoom Controls](app-navigation-and-zoom-controls.prd.md)) return to the same place. Phase 10, if the owner merges pages: `/proofing` redirects to the workspace's chapter picker, Review's "Open in workspace" and Home's row link stay valid, the Tracks nav item is renamed per EP14, and every doc screenshot is regenerated once, in one serial pull request.

## Technical Approach

**Feasibility:** HIGH for the MVP (Phases 1 to 3): the words exist, the alignment is computed and only needs writing out, the `/media` route and `navigate_item` exist, and the rest is UI. MEDIUM for takes (Phase 6: one new Lua command and a passage-based take comparison) and the waveform (Phase 5: new peaks code, WAV only). MEDIUM-LOW for effects (Phases 8 and 9) until spike SF shows how REAPER loads a chain onto a take by API. LOW-MEDIUM for Follow REAPER (Phase 7) until spike S4 and the position feed are measured.

**What is feasible where.**

| Capability | In the WebView (app) | Must be driven in REAPER |
| --- | --- | --- |
| Play the recording | Raw sources over `/media`, each item's played range, pitch-kept speed. No FX, fades, gain, crossfades, stretch markers or reversed sources | What the narrator will deliver: FX, fades, edits, the active lane |
| Follow the text | Exact to the word times, from the audio clock (`requestAnimationFrame` reading `currentTime`; `timeupdate` alone fires only every 15 to 250 ms) | Needs a play-position feed over the file bridge (Phase 7) |
| Seek to a word | Yes | `navigate_item` (exists) |
| Audition alternates | A/B from raw source ranges (`useRangePlayer.ts`, exists) | In-context audition (swap, loop, restore) is later work |
| Choose a take | No | `set_active_take` (new), `pick_retake_lane`, `create_take` (exist) |
| Apply an effect | No | New `apply_fx_chain` (Phase 9) |
| Waveform | Canvas over host-computed peaks | REAPER's own peaks are an alternative (EP12 C) |
| Alignment, flags, findings | Host and sidecar, offline | No |

**Architecture**

- **Alignment artifact (Phase 1).** `compare.py --coverage` writes, beside its existing tagged lines, one `COVERAGE_TOKEN` line per chapter token (or one compact array: token index, paragraph, status, the item index and the audio word's source start and end) and one `COVERAGE_EXTRA` line per run of unmatched audio words (text, item, source times). Everything it needs is already in memory at `coverage_mode.py:486` (`alignment`, `timeline`). The host stores it next to the report under `narration-utils/analysis/coverage/results/` with the same hash and staleness, and adds item and take GUIDs from the manifest. Coverage settings, thresholds and verdicts are untouched. The report's schema version goes up, and an older report reads as "align again". Size: about 50 bytes a token, so under 1 MB for a 15,000-word chapter. A new read binding returns the artifact joined with the chapter's paragraphs and the items' played ranges. Per `CLAUDE.md` wire contracts: a Zod schema in `apps/ui/src/api/schemas/`, a golden written by a Go test (`UPDATE_CONTRACTS=1`), a `wireContracts.test.ts` row and a mock that passes. **Align again** (EP3 B) is a sidecar mode that reads the manifest and the cached words and fails when any range is missing, so it never transcribes.
- **Played ranges on the wire (Phase 1).** `TrackItem` gains `takeGuid`, `sourceStart` (SECTION start plus `SOFFS`) and `playRate`, computed as `ChapterTrackMatch`'s `recordedEnd` already does (`chapterTrackMap.ts:37-50`). This is additive, but it changes the `tracks-list` golden and every consumer of `TracksList` (`change-impact-scan`).
- **The player (Phase 2).** A new `useChapterPlayback` hook builds a playlist of `{sourceFile, sourceStart, sourceEnd, projectStart}` segments and plays them one after another on one `Audio` element, seeking to `sourceStart` on each switch. The Tracks page's `useTrackPlayback` then plays through the same builder, which fixes its trim bug. A gap between items is skipped in the app (and shown on the waveform). Items that overlap on one track (not lanes) play in position order and are flagged "overlapping". The item switch costs a seek, so a gapless join is not promised. Phase 7 is for hearing REAPER's own mix.
- **Token at time.** A pure function maps (segment, source time) to the token whose `[start, end]` contains it, or to the nearest token before it during a pause. The highlight is a CSS class on one span. The text is virtualised by paragraph, because a chapter has thousands of word spans.
- **REAPER seek (Phase 3).** New bindings `WorkspaceGoTo(chapterId, tokenIndex)` and `WorkspaceLoop(chapterId, firstToken, lastToken)` resolve the token to item GUID, take GUID and source time **in the host**, from the stored artifact checked against the saved project. The page never sends a GUID or a time, as with `FindingsGoTo(id)`. They send the existing `navigate_item` and `loop_context` through `bridge.Navigator`, with the same refusal order and messages (`reaper-navigation.md`, "From the Review page"). No Lua change. Threat model row 5f gains these callers.
- **Findings overlay (Phase 4).** `FindingsList({chapterId})` exists. A finding with an item GUID and a source range maps onto tokens through the artifact (same item, overlapping source time). Review decisions use `FindingsReview` (exists).
- **Peaks (Phase 5).** A host binding computes min and max per bucket (for example 50 buckets a second, 8-bit) from the WAV reader, for each item's played range, cached in the evidence cache by source identity. It is sent as base64 per item and drawn on a canvas. If the owner wants zoom, a second, finer resolution is served per window. It uses no new route. If a route is ever needed, it reuses the `/media` middleware and its authorisation (ADR 0012).
- **Takes (Phase 6).** A host read lists alternates for a token range. Other takes on the item come from `Item.Takes`. Lane retakes come from `lanes.go` and the retake-lanes binding. Take-review reads are findings whose `evidence.members` overlap the passage in manuscript words. A passage-based take comparison job reuses `compare.py --take-divergence` with a manifest built from the saved project (ADR 0165's rules). Today it is started only from a take-review finding (`TakeComparisonStart(findingID)`, `apps/desktop/bindings.go:817`). **Use this take** sends a new Lua command `set_active_take(item_guid, take_guid)`: the take is re-resolved by GUID, `SetActiveTake` runs inside one `Undo_BeginBlock2`/`Undo_EndBlock2` ("Narration Utils: use take"), and nothing else changes. It refuses while recording and when the item or take is stale. Its harness tests and mutation checks come first (ADR 0066, ADR 0067), in a new `narration_workspace.lua` listed in `FEATURE_FILES` and `scripts/release/reaper-files.mjs`, with its events in `wire.go`. It needs a new ADR (it reverses take review's "never sets the active take") and a threat-model row beside 5i.
- **Follow REAPER (Phase 7).** A read-only position feed: either the host polls a `play_position` command (one answer per poll, under the 150 ms dispatch loop) or the Lua emits a position event on each tick while a subscription is held. The events file grows, so the subscription must end with the page. It maps project time to item and source time with the live or saved items. **It should extend the one read-only REAPER state command the resume and control-bar PRDs agree on (`chapter_track_state`) rather than add a third.** Spike S4 decides `GetPlayPosition` against `GetPlayPosition2`.
- **FX discovery (Phase 8).** Lua `list_fx_chains` walks `GetResourcePath()/FXChains` with `EnumerateFiles` and `EnumerateSubdirectories` (the bridge already wraps `EnumerateFiles`, `narration_bridge_core.lua:44-51`). It returns relative names only, capped, and follows no link outside the folder. Settings stores the narrator's favourites (EP8) as names.
- **Apply FX (Phase 9).** The page sends a chapter id, a token range and a chain name. The host resolves the token range into one or more (item GUID, take GUID, source start, source end) pieces and refuses a passage that crosses an item boundary unless the owner wants multi-item edits. The Lua `apply_fx_chain` re-resolves every GUID and resolves the chain **by name inside `FXChains`**, refusing `..`, separators outside the folder and names it did not list. Then, in one undo block ("Narration Utils: apply FX chain <name>"), it splits at the edges (EP9 A) and adds the chain to the middle piece's active take. It answers the new item GUIDs so the workspace can say what changed. It refuses while recording, and when stale. This is a **new trust boundary**: threat model row 5h ("a command makes REAPER run an action (render, apply FX, a script)") must be rewritten for FX chains with the Lua-side name resolution and its mutation checks, and `SECURITY.md` updated. A new ADR records the mechanism. The context menu needs a **new primitive** (Base UI's context menu, wrapped in `apps/ui/src/components/primitives/`, with a story, the atlas, `design-spec-guard`, and an aria snapshot for the open menu, ADR 0065).
- **Offline and REAPER closed.** Everything but Phases 3, 6's Use this take, 7, 8's discovery and 9 works from the saved project and the cache. REAPER actions read `FindingsReaperStatus`-style connection state and are disabled with its reason (`standalone`, `not_running`), as on the Review page. Nothing is queued (EP10 A), so nothing acts later without the narrator (threat row 5f).
- **After an edit.** Make active and apply FX change the project in REAPER. The workspace marks itself "REAPER has changes; save to update" (EP11 A), re-reads the `.rpp` when its modification time changes, and re-aligns from the cache. A split narrows ranges, so the words cache covers them (`words.go:105-119`). A new active take that was never transcribed needs a check.

**Technical risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Word times drift from what is heard (Whisper's timestamps are about ±0.25 s) | Medium | Highlight by interval with the pre-roll on seeks; ADR 0141's fixtures; the owner's real chapter (EP18) |
| The app player sounds different from REAPER (no FX, fades, gain) | Certain | Label the player "raw recording"; Follow REAPER (Phase 7) for the processed sound |
| REAPER loads no `.RfxChain` onto a take by API | Medium | Spike SF first; the fallback is the item state chunk (`<TAKEFX>`), which has its own risk (chunk edits are fragile, so harness-test every form SF sees) |
| A split for FX breaks other analyses (new GUIDs, findings go stale) | High | Findings re-anchor by source time on the same take. Line identity survives splits (S0). Stale findings say so rather than move |
| A large chapter's word spans make the page slow | Medium | Virtualise by paragraph; one highlighted span; measure a 15,000-word chapter in WebView2 before Phase 2 is done (no performance budget exists in the suite today) |
| The model cascade and this PRD both change the coverage sidecar's output | Certain if both ship | Additive tagged lines; whichever lands second rebases; one schema version bump each |
| The play-position feed floods `events.log` | Medium | Subscription with an end; the rate capped; poll instead of push if the spike says so |
| Owner confusion between the app's player and REAPER's transport | Medium | One visible "Follow: App / REAPER" switch; the REAPER status always in the header |
| Fixed-lane tracks give wrong flags | Medium on lane tracks | EP15 |
| Scope creep into a DAW | High | "What We're NOT Building"; every edit is a REAPER command with an undo step |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | Decisions and spikes | Owner answers EP1 to EP18. Spike SF (REAPER 7.x, isolated `-cfgfile`, scripted): chain onto a take by API or chunk, split plus take FX in one undo step, `SetActiveTake` undo, FX folder listing. Peaks cost on a 60-minute WAV. Record results in `docs/research/` | desk work complete (B3): answers applied, spike script and [research note](../research/edit-and-proof-spike-ep0.md); the REAPER run is **pending** on the owner (#510) | 1 | - | - |
| 1 | Alignment and played ranges | Sidecar token and extra lines, stored artifact, align-again mode, read binding; `TrackItem` played-range fields; Zod, goldens, `wireContracts` rows, mocks; Python and Go tests | complete: lane B (B3), the sidecar's `COVERAGE_TOKEN` and `COVERAGE_EXTRA` lines, `--align-only`, `TrackItem` played ranges with golden, schema and mocks ([ADR 0242](../adr/0242-the-recording-check-writes-the-chapters-word-alignment-as-additive-lines-and-align-again-never-transcribes.md)); lane A (A9), the stored alignment folded into the existing coverage report/results store, the `WorkspaceAlignment` read binding joining paragraphs and each item's live played range, and its Zod schema, golden and mock ([ADR 0212](../adr/0212-the-workspace-alignment-reuses-the-coverage-results-store-and-joins-played-ranges-from-the-saved-project-on-read.md)) | 0 | EP3, EP4 | - |
| 2 | Workspace MVP: listen, follow, flags, click | Route and entry points, header, `useChapterPlayback` (and Tracks' player on it), highlight, auto-scroll, flags, click to seek, keyboard, speed; visual states, aria, guide | pending | - | 1; EP1, EP2, EP5, EP14, EP17 | - |
| 3 | Go to and Loop in REAPER | `WorkspaceGoTo`, `WorkspaceLoop` over the existing commands; status and refusals; threat row 5f; scripted REAPER run | pending | 4 | 2 | - |
| 4 | Findings in the text | Overlay of chapter findings, review in place, "Open in workspace" from Review, Home and Manuscript | pending | 3, 5 | 2; EP4 | - |
| 5 | Waveform strip | Host peaks (WAV), cache, binding and contract, canvas component with playhead, flags and selection | host peaks complete (B3): `measure.ComputePeaks`/`PeaksFile`, 50 buckets a second, `ErrNotWAV` for a non-WAV source, 3.4 s for an hour ([cost](../research/edit-and-proof-spike-ep0.md#peaks-cost)); the cache and binding (lane A) and the canvas (lane C) are pending | 4 | 2; EP12 | - |
| 6 | Takes panel | Alternates read, passage-based take comparison, in-app A/B, `set_active_take` (harness first), Use this take; ADR; threat row | Lua `set_active_take` built by B1 (#520); the rest pending | 5 | 2, 0 (SF); EP6, EP7 | - |
| 7 | Follow REAPER | Play-position feed (extends `chapter_track_state`), mapping to tokens, the Follow toggle; harness, `wire.go`, scripted run | pending | 8 | 2; spike S4; resume and control-bar PRDs | - |
| 8 | FX discovery and favourites | Lua `list_fx_chains`, host read, Settings favourites; harness tests | Lua `list_fx_chains` and `list_fx` built by B1 (#520); the rest pending | 7 | 0 (SF); EP8 | - |
| 9 | Apply FX to a passage | Context menu primitive, token range to pieces, confirm, Lua `apply_fx_chain` (harness and mutations first), refusals; threat model row 5h rewritten, `SECURITY.md`; ADR; scripted REAPER run | Lua `apply_fx_chain` and `add_take_fx` built by B1 (#520, ADR 0234); the rest pending | - | 5, 8; EP9, EP10, EP16 | - |
| 10 | Consolidation | Per EP13 and EP14: move the Tracks player, fold the Proofing results, share the check summary, retire the Retakes dialog, rename or add the nav item, redirects, doc screenshots regenerated once | pending | - | 2 to 6; EP13, EP14; sibling PRDs settled | - |

### Phase Details

**Phase 0: Decisions and spikes.** Scope: the owner's answers in this PRD; `integrations/reaper/spikes/` scripts run by `run-reaper.ps1` on a scratch project with an isolated `-cfgfile` (as the navigation check was), results in `integrations/reaper/spikes/results/` and a research note; a Go benchmark of peaks over a 60-minute WAV. Success: SF answers, for REAPER 7.80, whether a chain file loads onto a take by API, what a split does to take FX, markers and extension data, and whether `SetActiveTake` leaves one undo point. Anything needing audio hardware or the owner is marked pending. Done as desk work on 2026-09-25 (stream B3): `integrations/reaper/spikes/spike_ep0_workspace.lua` scripts SF against the commands B1 built and rows A6 to A8b of the [verification pass](../operations/reaper-verification-pass.md); running it needs a machine with REAPER and is pending on the owner (#510). The results and the peaks cost are in [edit-and-proof-spike-ep0.md](../research/edit-and-proof-spike-ep0.md).

**Phase 1: Alignment and played ranges.** Scope: `sidecars/transcript-compare/core/coverage_mode.py` and tests, an align-again mode, `apps/desktop/internal/coverage/{report.go,results.go,view.go,contract_test.go}` or a new `alignment.go`, a binding, `apps/desktop/internal/tracks/tracks.go` wire fields, `tests/fixtures/contracts/`, `apps/ui/src/api/{schemas,contracts}/`, mocks. Success: metric "flags equal the check" and "played range honoured" (contract side). Verification: TDD in pytest and Go; `pnpm check`. Bumps `hostAPIVersion` (47 today, `apps/desktop/app.go:52`) for the new binding.

**Phase 2: Workspace MVP.** Scope: a new `apps/ui/src/components/workspace/` (page, text, transport, flag legend, hooks), `App.tsx` route, entry buttons on Tracks and Home, `useTrackPlayback.ts` moved onto the playlist builder, `state-catalog.ts` and `app.drivers.ts` rows (never, stale, current, playing, flag selected, standalone), an aria snapshot for the page's regions if it adds a slide-over or dialog, `docs/guides/using-the-app/` and a doc screenshot. The mock needs a chapter with an alignment and a playable fake source (`mockAudioSource`). Success: metrics follow accuracy, click-to-seek (app), offline. Verification: `npx playwright test tests/visual/app.spec.ts -g "workspace"` and every PNG at desktop, small-desktop and tablet read; `pnpm --dir apps/ui run aria`.

**Phase 3: Go to and Loop in REAPER.** Scope: `apps/desktop/bindings_workspace.go` (new) on `h.services()` with a `stressReaders` row, tests with a fake bridge; UI buttons; `docs/architecture/reaper-navigation.md` ("From the workspace"); threat model row 5f. Success: metric click-to-seek (REAPER). Verification: Go tests; the existing harness; a scripted REAPER run of `navigate_item` from a token; hearing it is pending on the owner.

**Phase 4: Findings in the text.** Scope: the workspace, `findingsMock.ts`, `ReviewPage.tsx`/`FindingDetail.tsx` ("Open in workspace"), Home and Manuscript entry points. Success: every chapter finding with an item and a source range is on the right tokens, and a decision made in the workspace shows on Review. Verification: Vitest; visual states.

**Phase 5: Waveform strip.** Scope: `apps/desktop/internal/measure` or a new `peaks` package, a binding and contract, a canvas component (a primitive only if another page needs it), visual states with masked peaks if non-deterministic. Success: peaks for a 60-minute WAV within the Phase 0 budget, cached. Verification: Go benchmarks; the visual suite.

**Phase 6: Takes panel.** Scope: `apps/desktop/internal/takecompare` (a passage manifest), a new `narration_workspace.lua` with `set_active_take`, `integrations/reaper/tests/workspace_test.lua` and `mutations.json`, `FEATURE_FILES`, `scripts/release/reaper-files.mjs`, `wire.go`, bindings, the panel (reusing `AuditionDialog`'s players and `TakeComparisonView`), the ADR, threat model, `docs/utilities/take-review.md` (the "Make active" item). Success: metric "one undo step"; a take chosen in the panel is active in REAPER and the check goes stale for that item. Verification: harness first; Go; visual; a scripted REAPER run; hearing it is pending on the owner.

**Phase 7: Follow REAPER.** Scope: the agreed state command (with the resume and control-bar PRDs), its harness tests, `wire.go`, a Go subscription, the toggle. Success: the highlight follows REAPER's playback within the latency spike S4 measures, stated in the UI. Verification: harness; Go with a fake bridge; scripted and owner runs.

**Phase 8: FX discovery and favourites.** Scope: `list_fx_chains` in `narration_workspace.lua` with tests, a binding, a Settings row (`fieldSchemas`, `config/defaults.json`, `Settings.tsx`). Success: the narrator's chains are listed by name and favourites persist per project or globally (owner's call). Verification: harness (a fake resource folder); Go; visual.

**Phase 9: Apply FX to a passage.** Changed by [ADR 0234](../adr/0234-fx-chains-go-on-tracks-and-a-passage-of-a-take-gets-one-plug-in-at-a-time.md) (owner, 2026-09-25): a passage gets one installed plug-in per request (`add_take_fx`), and a chain goes on a whole track or the master track (`apply_fx_chain`); both Lua commands, their harness tests and mutation checks, threat row 5h and `SECURITY.md` are built (#520). What is left is the host mapping, the bindings and the UI. Original scope: `apps/ui/src/components/primitives/ContextMenu.tsx` with its story and atlas run, the workspace's selection menu (also offered from the waveform), a confirm dialog, `apply_fx_chain` with harness tests and mutation checks (a chain outside the folder, a stale GUID, an edit outside the undo block, a split without the FX, recording not refused), the host mapping and binding, `docs/architecture/threat-model.md` rows 5h and a new one, `SECURITY.md`, an ADR, `docs/architecture/reaper-bridge.md` commands table. Success: metric "one undo step" for FX; the chain is on the passage's take in REAPER and Undo removes the split and the FX together. Verification: `design-spec-guard`; `pnpm --dir apps/ui atlas`; harness first; a scripted REAPER run on a copy of a project; listening pending on the owner.

**Phase 10: Consolidation.** Scope, per EP13 and EP14: `AppShell.tsx` NAV, `App.tsx` routes and redirects, `TracksPage.tsx` split, `components/proofing/*`, the recording-check summary component, `RetakeLanesDialog.tsx` retired, every doc screenshot under `docs/images/ui/`, the guides, `docs/utilities/tracks.md` and `transcript-compare.md`. Success: no page is left that duplicates the workspace's player, flags or take choice, and every old entry point still lands. Verification: the full visual suite and aria; doc screenshots regenerated in one pull request.

### Parallelism Notes

Phase 0's owner answers gate Phases 2, 6 and 9. The spike can run beside Phase 1. Phase 1 is sidecar, Go and contracts and has no UI. Phases 3, 4 and 5 all hang off Phase 2 and touch different layers (bridge bindings, findings overlay, peaks), so they can run in parallel with small rebases on the workspace component. Phase 6 needs the spike's `SetActiveTake` answer. Phases 7 and 8 are independent Lua features in the same new file, so they serialise on `narration_workspace.lua` and `mutations.json`. Phase 9 needs 5 (selection on the waveform) and 8. Phase 10 waits until the sibling PRDs that move Home's chapter row settle.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 0 | `integrations/reaper/spikes/`, `docs/research/` | [REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) spikes S1 to S4 (same spike folder and runner) |
| 1 | `sidecars/transcript-compare/core/coverage_mode.py` and tests, `apps/desktop/internal/coverage/*`, `apps/desktop/internal/tracks/tracks.go`, `tests/fixtures/contracts/{coverage-*,tracks-list*}.json`, `apps/ui/src/api/{schemas,contracts}/{coverage,tracks}.ts`, `coverageMock.ts`, `wireContracts.test.ts`, `apps/desktop/{app.go,app_test.go,bindings*.go}`, `hostApi.ts`, `Host.*` | **High:** [Recording Check Model Cascade](recording-check-model-cascade.prd.md) Phases 2 to 5 (same sidecar mode, `report.go`, `schemas/coverage.ts`, goldens); [Recording Check Summary](recording-check-summary.prd.md) Phase 2 (`view.go`, `report.go`); [DAW Chapter-Track Auto-Sync](daw-chapter-track-auto-sync.prd.md) Phase 7 (`coverage/{service,run}.go`); [Actual Recorded Column](actual-recorded-column.prd.md) Phase 2 (`tracks/recorded.go`, played ranges); every binding PR (`hostAPIVersion`) |
| 2 | new `apps/ui/src/components/workspace/*`, `App.tsx`, `components/tracks/{TracksPage,useTrackPlayback,ChapterLinksTable}.tsx`, `components/home/AudiobookEstimatePanel.tsx` (entry), `tests/visual/{state-catalog.ts,app.drivers.ts,doc-screenshots.json}`, `tests/aria/*`, `docs/guides/using-the-app/*` | **High:** [Chapter Track Link Control](chapter-track-link-control.prd.md) Phases 1, 2, 4 (`TracksPage`, `ChapterLinksTable`, `useTrackPlayback` reuse, the row); auto-sync Phases 3 and 6 (Tracks files, Home row); [Recording Check Summary](recording-check-summary.prd.md) Phase 4 (RS7, where the summary lives); `chapter-title-display-consistency.prd.md` (the chapter name in the header: use its component); `read-aloud-control-bar.prd.md` (`ReadingControlBar`: share a transport bar pattern rather than build two); [App Navigation and Zoom Controls](app-navigation-and-zoom-controls.prd.md) (history and the first parameterised route) |
| 3 | new `apps/desktop/bindings_workspace.go`, `hostrace_test.go`, `internal/bridge/navigation.go` (reuse only), `docs/architecture/{reaper-navigation,threat-model}.md` | [Review Dashboard](review-dashboard-and-findings-adoption.prd.md) Phases 7 and 8 open owner checks on the same commands; teleprompter Phase 12 `punch_to` (a second "cursor to a word" path: agree that `navigate_item` serves both) |
| 4 | `components/review/{ReviewPage,FindingDetail}.tsx`, `findingsMock.ts`, `components/manuscript/*` (entry), Home (entry) | Review Dashboard; [Proofing Readiness Signals](proofing-readiness-signals.prd.md) Phase 6 and [Proofing Preview Suggestion](proofing-preview-suggestion.prd.md) Phases 3 and 5 (Proofing page and findings overlay); [Editing Readiness Analysis](editing-readiness-analysis.prd.md) Phase 7 (its findings shown here too); manuscript PRDs (`ParagraphView`, chapter header) |
| 5 | `apps/desktop/internal/measure/*` or a new package, evidence cache keys, a binding | [Diagnostics](diagnostics-delivery-and-cleanup-tools.prd.md) and Editing Readiness Phase 2 (`measure` range API); [Analysis Evidence Ledger](analysis-evidence-ledger.prd.md) Phase 8 (cache) |
| 6 | new `integrations/reaper/narration_workspace.lua`, `narration_ui_bridge.lua` `FEATURE_FILES`, `scripts/release/reaper-files.mjs`, `integrations/reaper/tests/{workspace_test.lua,mutations.json}`, `internal/bridge/wire.go`, `internal/takecompare/*`, `components/review/{AuditionDialog,TakeComparisonView}.tsx` (reuse), `docs/utilities/take-review.md`, `docs/adr/` | Every Lua-touching PRD (`FEATURE_FILES`, `mutations.json`, `wire.go`): auto-sync Phases 4 and 5, teleprompter Phases 11 and 12, resume PRD, chapter-track-link Phase 4 ("Select in REAPER"); ADR numbering (0170 is the highest today) |
| 7 | the shared read-only state command (Lua, harness, `wire.go`, Go client) | **High:** [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md) (live cursor), `read-aloud-control-bar.prd.md` Phase 6, [Teleprompter Manuscript Integration](teleprompter-manuscript-integration.prd.md) Phase 11 (`chapter_track_state`), auto-sync Phase 5 (`narration_track_list.lua`): one command, agreed once |
| 8 | `narration_workspace.lua`, `apps/desktop/app.go` `fieldSchemas`, `config/defaults.json`, `Settings.tsx` | Any settings PRD (`fieldSchemas` and defaults are textual hot spots) |
| 9 | `apps/ui/src/components/primitives/ContextMenu.tsx` (new) and story, `styles.css` if tokens are needed, `narration_workspace.lua`, harness, `docs/architecture/threat-model.md`, `SECURITY.md`, `docs/architecture/reaper-bridge.md`, `docs/adr/` | Primitive additions serialise on the atlas and `baseUiBoundary.test.ts`; threat model edits by every bridge PRD; [REAPER Automation Follow-Through](reaper-automation-follow-through.prd.md) row 5h (cleanup launchers) |
| 10 | `AppShell.tsx` NAV, `App.tsx`, `components/{tracks,proofing,home}/*`, `docs/images/ui/*`, the guides and utility docs | **Nav change is a serialisation point** (README "Adding a nav item"); every PRD that edits Tracks, Proofing or Home's row |

Cross-cutting: each phase follows `CLAUDE.md`: an issue and `Closes #<n>`; `change-impact-scan` (consumers of `TracksList`, `useTrackPlayback`, the coverage report and `bridge.Navigator`; for the Lua, the harness tests of every command a consumer touches); TDD; `full-verification-gate` with `pnpm check`, the visual suite and every PNG read at every viewport, the aria run for new dialogs and menus, and the atlas for new primitives; `design-spec-guard` for Phase 9's primitive; `feature-cleanup` with the trust-boundary check: `/media` (row 6b) is reused unchanged, the sidecar manifest (row 4e) gains output only, and the bridge gains `set_active_take`, a position feed, `list_fx_chains` and `apply_fx_chain` (rows 5d to 5i and a new row, `SECURITY.md`). A new or changed command gets its harness tests first, and REAPER's own behaviour gets a scripted run on a copy of a project with an isolated `-cfgfile`, with what needs audio hardware or the owner marked pending.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| REAPER owns every audio edit (proposed) | The app sends one-undo-step commands on a press; it never writes audio or the `.rpp` | An in-app editor; editing the `.rpp` on disk | The narrator's undo history stays whole; matches every bridge command so far |
| The MVP plays in the app (proposed, EP2 C) | `/media` raw sources, played ranges honoured | REAPER transport first | Works with REAPER closed; word times are source times; no new bridge command |
| Words and alignment come from the recording check (proposed, EP3) | Additive output, plus a cache-only re-align | A new transcription pass for the workspace | The words already exist and survive trims and splits; one alignment rule for the check and the screen |
| Click-to-seek in REAPER reuses `navigate_item` (proposed) | New bindings that resolve a token in the host | A new `punch_to`-style command | Same GUID-and-source-time rule and refusals as Review (ADR 0121) |
| A chapter route under Tracks (proposed, EP1 A) | `/tracks/chapter/:chapterId`, no nav item | New nav page; evolve Review; replace Tracks | Where the owner looked; no serial nav change in the MVP |
| The app may set the active take (proposed, EP7 A) | `set_active_take`, one undo step, a new ADR | Leave it to REAPER | The owner asked to choose takes on this screen; take review named it as later work |
| FX chains are named, not pathed (proposed, EP8 B) | Lua lists and resolves names inside `FXChains` | Host sends a path; arbitrary actions | Keeps threat row 5h's rule that the host never names what REAPER runs |
| Open questions (owner, 2026-09-24) | Every open question takes this PRD's recommended answer, as shown in its approved Visual Spec mockups, except where a row below says otherwise | Answer each question separately | The owner approved the mockups that depict the recommendations; see D39 in the [implementation plan](implementation-plan.md#6-owner-decisions-2026-09-24) |
| Unbuilt data in the real app (owner, 2026-09-24, D24) | Visible UI is built in full; in mock mode it runs on sample data, and in the real app a surface whose data is not built yet shows an honest "not available yet" state. Controls that would act on REAPER stay disabled with the reason | Hide unbuilt UI until its data exists | The owner can use and judge every screen now; each backend phase switches on a screen that already exists |
| REAPER commands before the owner's verification pass (owner, 2026-09-24, D38) | Built in full with harness tests, their ReaScript calls documented from the API reference, and behind an "Experimental REAPER actions" Settings switch (off) until the owner and Claude verify them on a copy of a test project; commands that write to REAPER stay off until then | Wait to build them until the owner can test | Nothing waits on hardware, and nothing touches a real project before it is verified |
| Where it lives and who plays (owner, 2026-09-24, EP1, EP2, D30) | A chapter route under Tracks for the MVP; audio plays in the app first, with Follow REAPER later | A new nav item now; REAPER transport only | Ships without a nav change while the workflows are refined |
| Consolidation (owner, 2026-09-24, EP13, D30) | This workspace is meant to become one of the most-used places: Teleprompter, Tracks and Proofing will merge into it. They stay separate while the workspace is built and its workflows refined; Phase 10 then rebuilds and integrates them | Merge now; never merge | Refine the workflows before rebuilding three pages around them |
| Tracks per chapter and pickups (owner, 2026-09-24, D32, D33) | One track per chapter; "pickups" are the recording check's missing regions, other sources keep their own labels | | Consistent with the recording check summary and auto-sync |
| Effects on a passage (owner, 2026-09-25, [ADR 0234](../adr/0234-fx-chains-go-on-tracks-and-a-passage-of-a-take-gets-one-plug-in-at-a-time.md)) | FX chains go on a track or the master track; a passage of a take gets one installed plug-in at a time, never a chain | EP9 A: a chain as take FX on the passage | The owner's review of the first design; replaces EP8 and EP9's recommendations |
| Peaks (2026-09-25, EP12 A) | `measure.ComputePeaks` gives the minimum and maximum over every channel per bucket, as two signed bytes scaled to ±127 (minimum rounded down, maximum up), 50 buckets a second by default and at most 1,000, over an item's played range; a source that is not a WAV answers `ErrNotWAV`, which the page shows as "no waveform" | REAPER's `.reapeaks` (EP12 B) or `GetMediaItemTake_Peaks` (EP12 C) | Works with REAPER closed, and an hour takes 3.4 s, so no REAPER round trip is needed |
| Who builds what (2026-09-25, [implementation plan §8](implementation-plan.md#8-the-lane-train-2026-09-24)) | Lane B: Phase 0's desk work, Phase 1's sidecar output, align-again and `TrackItem` fields, the host peaks; lane A: Phase 1's stored alignment and read binding, the peaks binding; lane C: every screen, including the trim-aware Tracks player | One stream per phase | Lanes own files, so no two parallel sessions edit the same package |

## Research Summary

- Read: `docs/prds/README.md`, `CLAUDE.md`; this branch's sibling PRDs (recording check summary, chapter-track link control, auto-sync, actual recorded, read-aloud resume, and the two in-progress ones: chapter title display and read-aloud control bar), the review dashboard, proofing preview, proofing readiness, editing readiness, evidence ledger, REAPER automation, teleprompter, diagnostics and model cascade PRDs; `docs/utilities/{tracks,recording-coverage,take-review,transcript-compare}.md`, `docs/architecture/{reaper-bridge,reaper-navigation,threat-model}.md`, `docs/research/reaper-automation-surface.md`, the S0 spike result; ADRs 0012, 0121, 0126, 0141, 0147, 0165.
- Code: `TracksPage.tsx`, `useTrackPlayback.ts`, `useRangePlayer.ts`, `media.go`, `tracks/tracks.go`, `schemas/tracks.ts`, `chapterTrackMap.ts`, `coverage/{words,report,manifest}.go`, `coverage_mode.py`, `schemas/takeReview.ts`, `bridge/wire.go`, `narration_navigation.lua`, `narration_take_review.lua`, `narration_retake_lanes.lua`, `narration_bridge_core.lua`, `bindings_navigation.go`, `bindings.go` (take comparison), `AppShell.tsx`, `App.tsx`, `primitives/Menu.tsx`, `SelectionMenu.tsx`, `useTextSelection.ts`, `measure/wav.go`.
- Not done: nothing was run in REAPER or the desktop app. Whether REAPER loads an `.RfxChain` onto a take through `TakeFX_AddByName` is **not verified** here and is spike SF's first question. The play-position latency over the file bridge is unmeasured (spike S4). Whisper's word-time accuracy on the owner's real narration is unmeasured (EP18). The performance of thousands of word spans in WebView2 is unmeasured.

---

*Generated: 2026-09-24*
*Status: in progress (see the status line at the top)*

## Visual Spec

Mockups approved by the owner on 2026-09-24. They were rendered from the real app (dark theme, the app's own fonts and components) with throwaway edits and invented sample data, so names, numbers and body text are placeholders; the layout, controls, states and wording are the spec. Each shows the recommended answer to the open questions unless its caption says it is an alternative. Where a mockup and the text above disagree, raise it before building rather than silently following either.

![Before 1024](mockups/edit-and-proof-workspace/00-before-1024.webp)

*Before 1024* (`00-before-1024.webp`)

![Before](mockups/edit-and-proof-workspace/00-before.webp)

*Before* (`00-before.webp`)

![Playing follow 1024](mockups/edit-and-proof-workspace/01-playing-follow-1024.webp)

*Playing follow 1024* (`01-playing-follow-1024.webp`)

![Playing follow](mockups/edit-and-proof-workspace/01-playing-follow.webp)

*Playing follow* (`01-playing-follow.webp`)

![Entry open workspace from tracks 1024](mockups/edit-and-proof-workspace/01a-entry-open-workspace-from-tracks-1024.webp)

*Entry open workspace from tracks 1024* (`01a-entry-open-workspace-from-tracks-1024.webp`)

![Entry open workspace from tracks](mockups/edit-and-proof-workspace/01a-entry-open-workspace-from-tracks.webp)

*Entry open workspace from tracks* (`01a-entry-open-workspace-from-tracks.webp`)

![Flag detail open 1024](mockups/edit-and-proof-workspace/02-flag-detail-open-1024.webp)

*Flag detail open 1024* (`02-flag-detail-open-1024.webp`)

![Flag detail open](mockups/edit-and-proof-workspace/02-flag-detail-open.webp)

*Flag detail open* (`02-flag-detail-open.webp`)

![Click word to seek 1024](mockups/edit-and-proof-workspace/03-click-word-to-seek-1024.webp)

*Click word to seek 1024* (`03-click-word-to-seek-1024.webp`)

![Click word to seek](mockups/edit-and-proof-workspace/03-click-word-to-seek.webp)

*Click word to seek* (`03-click-word-to-seek.webp`)

![Takes panel ab 1024](mockups/edit-and-proof-workspace/04-takes-panel-ab-1024.webp)

*Takes panel ab 1024* (`04-takes-panel-ab-1024.webp`)

![Takes panel ab](mockups/edit-and-proof-workspace/04-takes-panel-ab.webp)

*Takes panel ab* (`04-takes-panel-ab.webp`)

![Selection context menu fx 1024](mockups/edit-and-proof-workspace/05-selection-context-menu-fx-1024.webp)

*Selection context menu fx 1024* (`05-selection-context-menu-fx-1024.webp`)

![Selection context menu fx](mockups/edit-and-proof-workspace/05-selection-context-menu-fx.webp)

*Selection context menu fx* (`05-selection-context-menu-fx.webp`)

![Apply fx confirm 1024](mockups/edit-and-proof-workspace/05c-apply-fx-confirm-1024.webp)

*Apply fx confirm 1024* (`05c-apply-fx-confirm-1024.webp`)

![Apply fx confirm](mockups/edit-and-proof-workspace/05c-apply-fx-confirm.webp)

*Apply fx confirm* (`05c-apply-fx-confirm.webp`)

![Reaper offline 1024](mockups/edit-and-proof-workspace/06-reaper-offline-1024.webp)

*Reaper offline 1024* (`06-reaper-offline-1024.webp`)

![Reaper offline](mockups/edit-and-proof-workspace/06-reaper-offline.webp)

*Reaper offline* (`06-reaper-offline.webp`)

![Unsaved changes in reaper 1024](mockups/edit-and-proof-workspace/07-unsaved-changes-in-reaper-1024.webp)

*Unsaved changes in reaper 1024* (`07-unsaved-changes-in-reaper-1024.webp`)

![Unsaved changes in reaper](mockups/edit-and-proof-workspace/07-unsaved-changes-in-reaper.webp)

*Unsaved changes in reaper* (`07-unsaved-changes-in-reaper.webp`)

![Long run page consolidation](mockups/edit-and-proof-workspace/08-long-run-page-consolidation.webp)

*Long run page consolidation* (`08-long-run-page-consolidation.webp`)

![Alternative (not the recommendation): Phase10 chapter nav item 1024](mockups/edit-and-proof-workspace/08b-alt-phase10-chapter-nav-item-1024.webp)

*Alternative (not the recommendation): Phase10 chapter nav item 1024* (`08b-alt-phase10-chapter-nav-item-1024.webp`)

![Alternative (not the recommendation): Phase10 chapter nav item](mockups/edit-and-proof-workspace/08b-alt-phase10-chapter-nav-item.webp)

*Alternative (not the recommendation): Phase10 chapter nav item* (`08b-alt-phase10-chapter-nav-item.webp`)
