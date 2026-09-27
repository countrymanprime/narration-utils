# Recording Check (recording coverage)

**Status: Implemented.** The Home check, the stored result, the measured recorded length and the `recording` stage
signal all work. The four settings ship with values chosen on synthetic fixtures and are labelled uncalibrated on real
narration ([ADR 0132](../adr/0132-the-recording-check-ships-0-8-3-8-3-chosen-on-synthetic-fixtures-and-labelled-uncalibrated.md)).
The model cascade (a fast first pass, then a stronger re-check of only what it reports missing) also ships, opt-in
and off by default until a real corpus confirms the first pass never gives a false "met" (see
[The model cascade](#the-model-cascade)).

## User problem

A chapter is recorded when all of its text is on the track, in order, even with mistakes. Before this check the app
could not say whether that was true. Transcript Compare finds mistakes inside what was read, and by design ignores what
was never read. The Home breakdown guessed the recorded length from the chapter's status. So a narrator decided "done
recording" from memory. The cost of a wrong call is an editing pass started on a chapter with a hole in it.

## Workflow

Save the REAPER project. Every narration chapter's row of the Home breakdown already shows its check without a click
(Phase 6, S14 below): a bold label ("Current", "Out of date", "Never checked", "Needs a track", "Suggested track",
"Track missing" or "No track yet") and, under it, when it was checked or last changed. There is no separate Check
button any more; the row itself opens the chapter's recording-check panel, a slide-over with the stored result and
**Check recording** (or **Check again**). The check reads the chapter's confirmed REAPER track from the saved project
file. It transcribes each item's played range that it has not transcribed before, and then aligns the chapter's text
to the words in order. The result reads "Text present: N of M words" and lists each missing region: which paragraphs,
how many words, the first and last missing words, and where the gap sits in the audio. When every paragraph passes the
two thresholds, the chapter's `recording` signal is `met`, and the stage recommendations can suggest moving it on. The
narrator always confirms. See [Using the app: Home](../guides/using-the-app/home.md#checking-a-chapters-recording) for
the screens and [Settings](../guides/using-the-app/settings.md) for the four numbers.

Each chapter's status is known without a click for exactly this reason. Chapter sync's `chaptersync:state` event
([DAW chapter-track auto-sync](../prds/daw-chapter-track-auto-sync.prd.md) Phase 6) carries one row per narration
chapter: its track, whether its check is `current`, `stale` (with the reasons above) or `never` run, when the check
finished, whether one is running, and when the track last changed. The row is this evaluation of the stored result
against the saved project, so reading it still never starts a check (Q14). The event is sent after each sync, each
save the watcher picks up, and each check that ends; Home re-reads its chapter list and stage suggestions on the same
event, so the row and the rest of the page never disagree.

A chapter with no confirmed track yet reads its link trouble instead of a freshness word ("Needs a track", "Suggested
track", "Track missing" or "No track yet": chapter-track-link-control.prd.md), since a check's freshness means nothing
until there is a track to check. The row is still clickable in every state: opening the panel on an unlinked chapter
shows the same in-place track-link prompt a refused check always has.

A chapter whose recording changed since its check is also re-checked in the background
([ADR 0211](../adr/0211-a-changed-chapter-is-rechecked-in-the-background-only-on-mains-power-with-reaper-quiet-and-not-recording.md)):
one at a time, the oldest change first, and only when the setting **Check changed chapters in the background** is on,
no other job runs, the Whisper model is installed, the computer is on mains power, REAPER is closed (until the bridge
says whether it is recording), and nothing has changed for three minutes. It is the same check as a press, labelled
background, and pressing **Check recording** pre-empts it. `chaptersync:state`'s `background.wait` says why none runs.

## How it works

```mermaid
flowchart LR
  home["Home: Check recording"] -->|CoverageStart| svc["apps/desktop/internal/coverage"]
  svc -->|reads| rpp["saved .rpp, confirmed track map"]
  svc -->|manifest, words files| side["compare.py --coverage"]
  side -->|COVERAGE lines| svc
  svc --> ledger["ledger record, stored report"]
  ledger -->|thresholds on read| out["Home result, recordedFraction, recording signal"]
```

- **The manifest comes from the saved project, not from REAPER.** `apps/desktop/internal/coverage` reads the `.rpp`
  the Tracks page selected, the chapter's one confirmed track (`chapter-track-map.json`, analysis evidence ledger), and
  each item's active take and played range, `[SOFFS, SOFFS + LENGTH × PLAYRATE]`, in position order. Muted items are
  listed and skipped. A chapter that cannot be checked gets a typed reason and nothing runs: not linked, several
  tracks, the linked track missing, a missing or non-audio source, an empty range, not a narration chapter, or no
  project file ([ADR 0128](../adr/0128-the-coverage-service-reads-the-saved-project-keeps-words-per-source-range-and-leaves-model-and-language-out-of-the-parameter-hash.md)).
- **Words are kept per source range.** The sidecar keeps one words file per item. The host moves them between the
  run's `--words-dir` and the evidence cache (`narration-utils/analysis/cache/`). The cache is keyed by source identity,
  model, language and hints, so a trim that narrows a range reuses the words and only a changed item is transcribed
  again ([ADR 0127](../adr/0127-the-coverage-sidecar-mode-reads-a-json-manifest-keeps-one-words-file-per-item-and-writes-tagged-json-lines.md)).
- **The alignment is the take markers' own.** `core/recording_coverage.py` reads the `SequenceMatcher` opcodes that
  `diff_and_build_markers` computes, so coverage and the markers cannot disagree. The marker output is unchanged,
  pinned by a golden file. The Phase 2 spike kept `SequenceMatcher` over a word-level DP
  ([ADR 0126](../adr/0126-recording-coverage-reads-the-take-markers-sequencematcher-alignment-and-folds-chance-matches-into-gaps.md),
  [the spike](../research/recording-coverage-alignment-spike.md)).
- **The sidecar measures, the host judges.** `compare.py --coverage` writes counts only: `COVERAGE`, `COVERAGE_ITEM`,
  `COVERAGE_PARAGRAPH` and `COVERAGE_REGION` lines, each with a JSON payload. A region names its kind, paragraphs,
  word count and first and last words, and three points in the audio, each `{itemIndex, itemGuid, sourceTime}` in
  source seconds: `position`, where the missing text would sit; `before`, the end of the last matched word before it;
  and `after`, the start of the first matched word after it. A read title never bounds a region, so `before` is `null`
  for a head and `after` for a tail, and all three are `null` when nothing was said. A result stored before the bounds
  existed reads with none, and is still current
  ([ADR 0168](../adr/0168-a-coverage-region-carries-its-bounds-as-optional-before-and-after-points-with-no-version-bump.md)).
  After those lines comes the word alignment the edit and proof workspace reads
  ([ADR 0242](../adr/0242-the-recording-check-writes-the-chapters-word-alignment-as-additive-lines-and-align-again-never-transcribes.md)):
  - one `COVERAGE_TOKEN` per chapter token: its paragraph, the ordinal of its word in the paragraph's text, and its status,
    which is `read`, `misread`, `heading` or the region kind the check counted it as; plus the item and source seconds
    where it was heard;
  - one `COVERAGE_EXTRA` per run of heard words the chapter does not account for.

  `--align-only` re-aligns from the cached words files and never transcribes. The host does not read these lines yet
  (the stored alignment and its binding are the PRD's Phase 1 host side).
  Every run writes one ledger record
  (`complete`, `partial` on cancel, or `failed`). A complete run's report is stored under
  `narration-utils/analysis/coverage/results/` with a hash of the chapter's text. The host applies the thresholds when
  it reads a report, so a threshold change never transcribes or aligns again.
- **Progress is real and a check runs only on a press.** Progress is the seconds transcribed over the seconds to
  transcribe. Cancel keeps the finished items. One check runs at a time, and a run ends with one `job:ended` event
  ([ADR 0129](../adr/0129-the-coverage-bindings-answer-refusals-as-results-end-with-one-job-event-and-fill-recordedfraction-only-from-a-current-check.md),
  [ADR 0130](../adr/0130-the-home-recording-check-opens-on-the-stored-result-runs-only-on-a-press-and-labels-the-recorded-length-measured-or-estimated.md)).
- **A result is current, stale or never.** It goes stale when the saved project changes under it: an item added,
  removed, trimmed, moved, muted or switched to another take, or an audio file changed. It also goes stale when the
  chapter's text, the equivalences, the vocabulary hints or an alignment setting changes. A different Whisper model or
  language keeps it current and labelled with the model (Q13).
- **Three readers.** The Home slide-over (`RecordingCheck.tsx`, opened from the row's check-status cell since Phase 6
  retired the row's own Check button) shows the stored report. The `CoverageResult` payload also
  carries `judgement`: met or not met by the narrator's thresholds, with the gap that fails first. It comes from
  `coverage.Judge`, the same function the stage signal uses, so the two cannot disagree. It is set for any complete
  result with a report, a stale one included (as of the last check)
  ([ADR 0204](../adr/0204-the-recording-check-result-carries-the-hosts-judgement-by-the-stage-signals-rule.md)). `recordedFraction` on the chapter
  payload is the present share of a current complete check only; it no longer feeds Home's **Actual recorded** column,
  which instead reads `recordedSeconds`, a real duration from the chapter's linked track in the saved project, unrelated
  to any check ([Actual Recorded](../prds/actual-recorded-column.prd.md) Phase 3, superseding Q12 below).
  `coverage.RecordingSignal` gives the stage recommendations engine the tri-state
  `recording.text_present` signal
  ([ADR 0131](../adr/0131-the-recording-signal-is-read-from-stored-checks-with-thresholds-applied-on-read-and-alignment-from-settings.md),
  [stage recommendations](../architecture/stage-recommendations.md)).

### What counts as read

- **Body tokens** are the chapter's paragraph words after `compare.py`'s tokenizing: homophones, number words,
  equivalences and hyphen fusing all apply. The title and subtitle are optional heading tokens. They are never in the
  denominator and never extra (Q11).
- **Present.** An `equal` block of at least `min_anchor_run` tokens is read text. A shorter block counts only at either
  end of the alignment or next to another `equal` block. Elsewhere it is a chance match and joins the gap around it.
  In a gap of up to `max_misread_run` body tokens, up to as many tokens as were said count as present. That is a
  misread, and misreads count as read.
- **Missing** is everything else, including an unread head and tail (which the take markers ignore). The regions are
  `head`, `tail`, `skip` (not said, or said again as a retake), `short_read` (fewer words said than written) and
  `different_text` (a larger gap of other speech).
- **Extra** speech, such as retakes, false starts and asides, is counted and never held against the narrator. A
  paragraph read only out of place, like a pickup recorded at the end, is missing where it belongs.
- **A chapter is complete** when every paragraph has at least `min_paragraph_present` of its words present, and no run
  of missing words, counted across paragraph boundaries and including the head and tail, is longer than
  `max_missing_run`.

### Settings

The `RecordingCoverage` settings tool, layered project over global over the built-in defaults like every other tool
([ADR 0155](../adr/0155-settings-gain-a-number-kind-with-a-declared-range-and-delivery-limits-are-the-narrators-own.md)):

| Setting | Default | Kind | What it decides |
| --- | --- | --- | --- |
| `min_paragraph_present` | 0.8 | threshold, applied on read | The share of each paragraph that must be read. This sets how much transcriber error is tolerated |
| `max_missing_run` | 3 | threshold, applied on read | The longest run of missing words allowed. This is the check's resolution: a skipped phrase of 4 or more words always fails |
| `max_misread_run` | 8 | alignment, stale on change | The largest gap of words that still counts as a misread. More than this said as other text is `different_text` |
| `min_anchor_run` | 3 | alignment, stale on change | The shortest match that counts as read on its own. At 2, common word pairs inside unrelated speech count |
| `cascade_enabled` | off | switch | Turns the model cascade on (MC1). Off, `CoverageStart` reads `TranscriptCompare.model_size` exactly as it always has |
| `cascade_first_pass_model` | `tiny` | Whisper model, cascade only | The fast first pass's own model (MC2), independent of `TranscriptCompare.model_size` |
| `cascade_recheck_model` | `large-v3-turbo` | Whisper model, cascade only | The model that re-checks anything the first pass reports missing (MC2) |

The Settings page labels them **Proposed values, not yet calibrated**. They were chosen by the Phase 8 calibration:
the synthetic fixtures run through the shipped path, 600 candidates, and five levels of simulated transcriber error.
The shipped values give no false "met" on the held-out cases at any level. They pass every complete chapter under
light error, where the owner's starting value of 0.95 failed 7 of 35. On Piper renders of the committed cases,
transcribed by the real sidecar with `small` and `tiny`, all 16 cases come out right. A second Piper take compared
`small` with `large-v3-turbo`: neither passed an unread chapter, `small` failed one complete chapter with a
repeated passage, and `large-v3-turbo` got all 16 right at about twice the time. `medium` was slower than
`large-v3-turbo` and no more accurate. The full tables and the time
budget (about 10 s of CPU per audio minute with `small` and about 20 s with `large-v3-turbo` on the machine measured) are in
[the calibration note](../research/recording-coverage-calibration.md).

## The model cascade

**Status: Implemented, opt-in and off by default.** `RecordingCoverage.cascade_enabled` (MC1). Until a real,
permissioned corpus confirms the first pass never gives a false "met" ([#425](https://github.com/countrymanprime/narration-utils/issues/425)),
this stays a narrator's own choice, not the shipped default.

Checking a chapter with the cascade off is unchanged: one pass, `TranscriptCompare.model_size`. With it on, the
check runs in up to three sidecar stages under one job, one cancel and one `job:ended`, exactly as a plain check
(ADR 0344):

```mermaid
flowchart LR
  first["First pass: cascade_first_pass_model"] -->|regions?| plan{"planRecheck"}
  plan -->|nothing missing| done1["stored, no Recheck"]
  plan -->|windows| recheck["--recheck: cascade_recheck_model"]
  plan -->|over 60% of the chapter| whole["whole-chapter pass: cascade_recheck_model"]
  recheck --> realign["--align-only: cascade_first_pass_model"]
  realign --> done2["stored, Recheck{model, windows, seconds}"]
  whole --> done2
```

- **The first pass** runs `cascade_first_pass_model` (default `tiny`) over the whole chapter, exactly like a plain
  check. A chapter it calls complete is stored as-is: no second pass ever runs over a chapter with nothing missing.
- **The window planner** (`internal/coverage/plan.go`, pure, no I/O) turns every reported region into a window
  bounded by ADR 0168's `before`/`after` points, padded past each bound and up to a minimum size, merged when two
  windows of the same item are close together, and replaced by one whole-chapter pass when the windows would cover
  most of the chapter's played audio (MC3's constants: pad 3 s, minimum 25 s, merge under 20 s apart, whole-chapter
  past 60%, chosen from the PRD's Evidence benchmark - Whisper's cost is per roughly-30-second block, so a shorter
  window costs about the same as a 25-second one).
- **The re-check** runs `cascade_recheck_model` (default `large-v3-turbo`) either as `compare.py --recheck` over
  the planned windows only, splicing the result into the same words files with per-span model provenance (ADR
  0341), or as one more whole-chapter pass. A windowed re-check is followed by `--align-only`, re-reading the
  now-spliced words with no further transcription; either way the chapter is judged by the same rules and
  thresholds as a plain check, over merged words.
- **The stored result names both models.** `StoredResult.Model`/`ReportView.model` keep naming the first pass only,
  for compatibility (ADR 0344's "stays the first-pass model for compatibility", Q13); a `recheck` field
  (`{model, wholeChapter, windows, seconds}`, ADR 0345) carries the rest, absent for a plain check or a cascade run
  that found nothing missing. The dialog reads "Checked ... with the tiny Whisper model; 1 passage re-checked with
  the large-v3-turbo Whisper model", and every pickup still listed - windowed or whole-chapter, every one of them
  was seen by both models - reads "Confirmed missing by the large-v3-turbo Whisper model."
- **The missing-model choice (MC4).** The first-pass model keeps the existing first-use gate
  (`asset_required`, shared with Transcript Compare and the teleprompter): not installed, the check cannot run.
  A missing re-check model instead answers `recheck_asset_required`, and the dialog offers "Check with tiny only"
  beside the download - a one-run choice (`CoverageStart`'s `options.skipRecheck`), never a settings change.
- **Live progress** (`coverage:state`'s `pass`, `firstPassModel`, `recheckModel`, `recheckWindows`) names which of
  the up to four stages is running, ahead of the sidecar's own message: "First pass (tiny)", "Re-checking 3
  passages (large-v3-turbo)", "Re-checking the whole chapter (large-v3-turbo)" or "Combining the two passes".
- **Staleness and caching are unchanged in kind.** A cascade result is judged, evaluated for staleness and read
  back exactly like a plain one (Q13); the words cache key gains the re-check model (empty for a plain check), so
  a cascade's spliced words are never silently reused by, or reused from, a plain check of the same first-pass
  model (ADR 0344).

## Decisions

The code comments name these decisions by their labels from the delivered PRD (`git log --diff-filter=D --
docs/prds/recording-coverage-analysis.prd.md` finds it); MC1-MC7 are the model cascade's own, from its delivered PRD
(`git log --diff-filter=D -- docs/prds/recording-check-model-cascade.prd.md` finds it).

| Label | Decision |
| --- | --- |
| D1 | Suggestions only. The check never changes a chapter's status, and the narrator confirms |
| D2 | Tri-state signal: `unknown` for never checked, stale, unmapped, partial or unavailable, and `unknown` is never `met` |
| D5 | One confirmed track per chapter. An unconfirmed name match is never used |
| D11 | `recordedFraction` is the share of the chapter's words present, from a current complete check only |
| D12 | No default ships before it has been scored on labelled chapters (amended by Q15) |
| Q1 | Word-level alignment reported per paragraph (`p-NNNNNN`), with each region's first and last words |
| Q2 | Reuse the take markers' `SequenceMatcher` alignment. The spike found no reason to move to a DP |
| Q3 | Four settings: two thresholds and two alignment parameters. Started at 0.95, 3, 8 and 3, and shipped at 0.8, 3, 8 and 3 (ADR 0132) |
| Q4 | Narration chapters only. Front Matter is not a target |
| Q5 | The active take of each item only |
| Q6 | The saved `.rpp` is the only basis. A live Transcript Compare run never feeds the signal |
| Q7 | The narrator's Transcript Compare model (`small` by default), recorded on each result |
| Q8 | The live teleprompter tracker is not reused: its "done" is a cursor position |
| Q10 | Muted items are skipped and listed |
| Q11 | A spoken title or subtitle is optional, and never counted as missing or extra |
| Q12 | *Superseded* by [Actual Recorded](../prds/actual-recorded-column.prd.md) Phase 3: an unmeasured chapter kept the status estimate, labelled "estimated from status"; the column now reads a real recorded length or a plain dash, never a guess |
| Q13 | Another model or language keeps a result current (labelled). Another alignment setting makes it stale |
| Q14 | On demand only: Home reads stored results and never starts a check. Superseded in part by [ADR 0211](../adr/0211-a-changed-chapter-is-rechecked-in-the-background-only-on-mains-power-with-reaper-quiet-and-not-recording.md): the host re-checks a changed chapter on its own, only on mains power with REAPER quiet and not recording (`RecordingCoverage.background_checks`, on by default); reading a status still never starts one |
| Q15 | Synthetic fixtures now, with `NARRATION_COVERAGE_CORPUS` for a real permissioned corpus later ([ADR 0125](../adr/0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md)) |
| MC1 | The cascade is opt-in, off by default, until a real corpus confirms the first pass never gives a false "met" |
| MC2 | Two independent settings: `cascade_first_pass_model` (default `tiny`) and `cascade_recheck_model` (default `large-v3-turbo`), from the approved catalog |
| MC3 | Window rules are constants, not settings: pad 3 s past each bound and up to a 25 s minimum, merge windows under 20 s apart, whole-chapter fallback past 60% of the chapter's played audio |
| MC4 | A missing re-check model offers the download or "Check with tiny only" (`recheck_asset_required`, `options.skipRecheck`), never blocking the check the way a missing first-pass model does |
| MC5 | The result names both models and how many windows were re-checked (`Recheck`); every pickup still listed on a cascade result was confirmed by the re-check model |
| MC6 | Spot-checking "met" paragraphs is not in this delivery; revisit with a real corpus |
| MC7 | The model cascade keeps Q13 (model and language outside the parameter hash): the label says which models made a result |

## Tests and tooling

- `sidecars/transcript-compare/tests/`: `test_coverage.py` (the definitions), `test_coverage_mode.py` (the sidecar
  mode with a fake transcriber), `test_marker_golden.py` (markers unchanged), `coverage_harness.py` and
  [the fixture set](../research/recording-coverage-fixtures.md), `coverage_spike.py` (Phase 2) and
  `coverage_calibration.py` (Phase 8), each pinned by its own test file.
- `apps/desktop/internal/coverage`: service tests with a fake sidecar (fresh, all-cached, one-item edit, cancel, every
  refusal and staleness cause), the signal table, settings and a provider test through `stages.Collect`. A test runs
  the real sidecar over cached words when the checkout has a Python environment. `corpus_test.go` stores the
  sidecar's pinned output for every fixture case (`fixtures/coverage/results.golden.json`, written by
  `test_coverage_results_golden.py`) as a complete check and runs `stages.Service` over it: `editing` is suggested
  for exactly the cases labelled complete. `plan_test.go` (the window planner: bounds, merging, the whole-chapter
  fallback, muted items) and `recheck_test.go` (the cascade end to end with a fake sidecar: no second pass when
  nothing is missing, a windowed re-check and realign, the whole-chapter fallback, cancel and failure in each
  stage, the words-cache-key separation, `Recheck`'s own fields and `State`'s pass/model/window fields).
- UI: `RecordingCheck.test.tsx` (including the re-check gate and "Check with tiny only"),
  `recordingCheckText.test.ts` (`passLabel`, `recheckLabel`), `RecordingCheckSummary.test.tsx`, the wire contracts
  for `coverage:state`, `CoverageStartResult` and `CoverageReport.recheck`
  ([wire contracts](../architecture/wire-contracts.md)), the visual states `home/recording-check-*` (including
  `recording-check-cascade` and `recording-check-recheck-model-required`) and `settings/*-recording-check`, and the
  aria snapshot of the dialog.

## Non-goals and review boundary

The check judges presence, not performance. It never edits the project, moves audio, activates a take or changes a
status. It does not use forced alignment or any PyTorch model ([ADR 0008](../adr/0008-timing-confidence-over-forced-alignment-model-for-transcript-compare.md)),
send audio anywhere, or run in the background. It does not move a pickup back to its place, which is take review's
job. It does not use Lua or a running REAPER, and does not handle multi-track chapters. The trust boundary (the
manifest names the audio the sidecar reads and the words files it writes) is row 4e of the
[threat model](../architecture/threat-model.md).

## Not done yet

Tracked in [#425](https://github.com/countrymanprime/narration-utils/issues/425):

- **A cross-check against REAPER.** An optional, owner-run check that the standalone manifest matches the Lua
  `manifest_<run>.txt` for one chapter. It is read-only, but it needs REAPER open.
- **A real, permissioned corpus.** It would replace the synthetic calibration and drop the "uncalibrated" label,
  and is also what turns the model cascade on by default (MC1): the first pass has never given a false "met" on the
  synthetic corpus, but that has not been checked against real narration (noise, breaths, pace).
- **Play from a region** over `/media`, a Could in the PRD.
- **Spot checks of "met" paragraphs** (MC6, a Could in the model cascade PRD): re-checking a small sample of
  paragraphs the first pass calls complete, so a false "met" would show up in use even before a real corpus exists.
