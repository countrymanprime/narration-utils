# Take review

**Status: Implemented. The checks on a real chapter and in the owner's REAPER are pending (see [What is still open](#what-is-still-open)).**

## User problem

A narrator records a line more than once: a restart after a stumble, a pickup of part of a line on a pickup track or later
in the session, an exact copy, a near-identical re-read. Finding the alternates by ear, lining them up against the script,
listening to them side by side and putting the chosen one in the right item is slow, and a single "best take" score would
hide why one read is better than another. Take review finds the repeated reads, lets the narrator review them with
evidence, adds a chosen read as a take, and compares the takes of one part of the script category by category. It never
makes a take active, moves or deletes audio, or ranks the reads.

## Workflow

Everything happens on the [Review page](../guides/using-the-app/review.md#pickups-and-duplicates):

1. **Find pickups and duplicates…**: the narrator picks the chapter track and at most one pickup addition, a pickup track
   or a stretch of the timeline. The scan is a cancellable job with the sidecar's own progress.
2. Each group of repeated reads is a finding (category `pickup` or `duplicate_read`) with its reads: range in its own file,
   whole or partial coverage of the span, match quality, exact-copy flag. Go to and Loop per read in REAPER; Audition two
   reads from their raw source over `/media`.
3. **Add as take…** on an accepted group: the narrator chooses the target item and the read that becomes the take; REAPER
   adds it in one undo step, with provenance in the take's extension data.
4. **Compare takes…**: a `take_comparison` finding that sets the group's reads side by side over the same words, how each
   read the script and its audio evidence per category.
5. The narrator makes the chosen take active in REAPER.

The narrator's flow is also in the [recording and comping workflow](../workflows/recording-and-comping.md).

## How it works

| Step | Code | Decision |
| --- | --- | --- |
| Take-aware project model: every take of every item, its GUID, source, `SOFFS`, `PLAYRATE`, `SECTION`; `Project.ItemByGUID` | `apps/desktop/internal/tracks` ([Tracks](tracks.md)) | [ADR 0100](../adr/0100-analysis-evidence-is-two-hash-keys-one-ledger-record-per-run-and-a-narrator-confirmed-track-map.md) (parser superset) |
| Scan scope (chapter track plus one pickup track or range), manifest, thresholds from project settings | `apps/desktop/internal/takereview` (`buildManifest`, `ValidateScope`, `ResolveThresholds`, `ResolvePickupScope`) | [ADR 0124](../adr/0124-take-review-groups-are-reviewed-on-the-review-page-each-read-is-navigated-by-its-index-and-the-scan-is-a-cancellable-job.md) |
| Repeated-span detection: transcribe each read, align to the manuscript with the markers' diff, group reads whose spans overlap, flag exact copies by source identity | `compare.py --find-repeats` (`sidecars/transcript-compare/core/compare.py`) | |
| Groups to findings: `pickup` (`evidence.kind` `restart`, `pickup`, `exact_copy`) or `duplicate_read` (`near_duplicate`), stable ids and evidence versions | `apps/desktop/internal/repeats` | |
| The scan job, review surface, per-read navigation | `apps/desktop/takereview_job.go`, `bindings_navigation.go`; `apps/ui/src/components/review/TakeReviewReads.tsx`, `TakeReviewScanDialog.tsx` | [ADR 0124](../adr/0124-take-review-groups-are-reviewed-on-the-review-page-each-read-is-navigated-by-its-index-and-the-scan-is-a-cancellable-job.md), [ADR 0121](../adr/0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md) |
| Add as take: `create_take` in REAPER, re-resolving GUIDs, active take and item length untouched, one undo step | `integrations/reaper/narration_take_review.lua`, `apps/desktop/internal/takereview/createtake.go` | [ADR 0098](../adr/0098-take-provenance-in-take-extension-data-extends-adr-0026.md) |
| Audition: two raw-source ranges with pre and post roll, one playing at a time | `apps/ui/src/components/review/AuditionDialog.tsx`, `apps/ui/src/components/tracks/useRangePlayer.ts` | |
| Take metrics: clipping, noise, level against neighbours, duration, pause profile, each measured or unavailable with a reason | `apps/desktop/internal/measure` (`MeasureTake`, `TakeSourceRange`) | [ADR 0140](../adr/0140-take-metrics-are-per-category-evidence-over-a-takes-source-range.md) |
| Per-take divergence: every span word's status and time, every divergence as words plus seconds | `compare.py --take-divergence` (`core/take_divergence.py`, `core/take_divergence_mode.py`) | [ADR 0141](../adr/0141-per-take-divergence-is-localized-by-the-markers-diff-and-asr-word-timestamps.md) |
| Take comparison: same-span checks, manifest from the saved project, one `take_comparison` finding, the view | `apps/desktop/internal/takecompare`, `apps/desktop/takecompare_job.go`; `apps/ui/src/components/review/TakeComparisonView.tsx`, `TakeComparisonDialog.tsx` | [ADR 0165](../adr/0165-a-take-comparison-is-one-finding-per-group-over-its-one-span-built-from-the-saved-project-and-never-ranked.md) |

The wire contracts (`TakeReviewScanStart/State/Cancel`, `TakeReviewCreateTake`, `TakeComparisonStart/State/Cancel`, the
evidence of both finding kinds) are in `apps/ui/src/api/schemas/takeReview.ts`, pinned by the goldens under
`tests/fixtures/contracts/` (`takereview-*`, `takecomparison-*`, `findings-list-take-review.json`,
`findings-list-take-comparison.json`, and `take-divergence-results.json`, the sidecar's own results file that the Go parser
reads). The trust boundaries are rows 4a and 4f of the [threat model](../architecture/threat-model.md).

### Settings

Project settings, tool `TakeReview` (built-in defaults in `config/defaults.json`; an unparseable or out-of-range stored value
falls back to the default rather than failing a scan):

| Key | Default | Meaning |
| --- | --- | --- |
| `full_coverage_threshold` | `0.9` | A read covering at least this much of its group's span is a full re-read; less is a partial pickup. |
| `near_duplicate_quality_threshold` | `0.97` | A group whose reads are all full and all match the script at least this well is a near duplicate (`duplicate_read`), not a restart. |
| `pickup_track_name` | empty | The pickup track the scan dialog starts with. |
| `pickup_range_start_seconds`, `pickup_range_end_seconds` | empty | The stretch of the timeline the scan dialog starts with (never both a track and a range). |

## Decisions

These were the take-review PRD's open questions; the PRD is retired (`git log --diff-filter=D -- docs/prds/take-review-pickups-duplicates-take-intelligence.prd.md`
finds it, with every phase's evidence).

- **Detection** is transcript-to-manuscript alignment of every read in scope plus exact-copy detection from source identity.
  Acoustic similarity (fingerprints, DTW) and a Silero VAD restart cue were not adopted; they need the local-dependency
  protocol first.
- **The detector** is an additive sidecar mode reusing Transcript Compare's tokenizing, number and homophone equivalence and
  diff; Go only adapts its output.
- **Scope** is the chapter track's items and all their takes, plus at most one pickup track or time range. A cross-session
  index is later work.
- **Take creation** adds the candidate's source range as a new take on the target item (`AddTakeToMediaItem`); the active
  take and the item's length never change; one undo step; provenance in take `P_EXT` (ADR 0098).
- **Line identity stamps are not required**: spans come from alignment, and the item's own GUID is the target identity.
- **Audition** is in the app, from raw source, with no REAPER change. A REAPER-side, timeline-context audition is later work.
- **The app never sets the active take.** An explicit, confirmed "Make active" action is a later addition.
- **No composite score** anywhere: every surface shows evidence per category.
- **Divergence** is localized by the markers' diff and Whisper word timestamps, evaluated on synthetic fixtures
  ([evaluation](../research/take-divergence-evaluation.md)); forced alignment was not needed.
- **Categories**: no new `restart` category; restarts, pickups and exact copies are `pickup`, near-identical re-reads are
  `duplicate_read`.
- **Thresholds** live in project settings, above.

## What is still open

- **A scan of a real chapter** end to end, with the Whisper sidecar and the owner's project, and the calibration the PRD
  proposed (recall 80% and precision 60% on an annotated set of at least 25 known locations over 3 to 5 chapters). No
  annotated set exists yet; the fixture suites (`sidecars/transcript-compare/tests/test_repeated_spans.py`,
  `tests/test_divergence_harness.py`) are the evidence so far, and synthetic evidence is weaker than real chapters.
- **The owner's REAPER checks** for Go to and Loop per read, and what a split or a take-specific duplicate does to a take's
  own provenance block (ADR 0098's open item; the scripted run in `integrations/reaper/spikes/take_review_smoke.lua` covered
  creation, active take, length and undo).
- **Analysis time per hour of audio** and **time to locate an alternate** against the manual workflow: not measured.
- **Later work**: narrator-adjustable weights (only once decisions accumulate), a "Make active" action, REAPER-side audition,
  a cross-session index, recording-time collection of alternates, and take review for Audacity.
