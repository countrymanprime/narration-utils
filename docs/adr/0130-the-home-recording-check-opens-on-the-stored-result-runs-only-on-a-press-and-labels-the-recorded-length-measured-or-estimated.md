# 0130. The Home recording check opens on the stored result, runs only on a press, and labels the recorded length measured or estimated

- **Status:** Proposed
- **Date:** 2026-09-23
- **Related:** Partly superseded by [ADR-0193](0193-homes-actual-recorded-is-the-linked-tracks-recorded-length-from-the-saved-project-and-never-an-estimate.md) (the "The recorded column names its source" clause) and by [ADR-0204](0204-the-recording-check-result-carries-the-hosts-judgement-by-the-stage-signals-rule.md) (the "The report states counts, not a verdict ... Thresholds belong to the Phase 7 signal" clause).

## Context and problem

Phase 6 of `docs/prds/recording-coverage-analysis.prd.md` puts the recording check of [ADR 0129](0129-the-coverage-bindings-answer-refusals-as-results-end-with-one-job-event-and-fill-recordedfraction-only-from-a-current-check.md) on Home. The PRD fixes that a check runs only when the narrator asks (Q14), that a stale result keeps its report, that an unmeasured chapter keeps its status estimate with a label (Q12 A), and that the chapter-track link is confirmed where the check needs it (analysis evidence ledger PRD, Q7 A). Four things were left open:

- Whether the row's button starts a check at once or opens something first. A check transcribes minutes of audio, and the narrator may only want to read the last result.
- How progress, Cancel and the model download are shown. The app already has one work dialog (ADR 0075, ADR 0076) and one first-use download prompt (`AssetInstallPrompt`).
- What the recorded column says about where its number came from.
- Which refusals the dialog can fix in place.

## Decision drivers

- A check runs only when the narrator asks (Q14).
- A stale result keeps its report, and an unmeasured chapter keeps its status estimate with a label (Q12 A).
- The chapter-track link is confirmed where the check needs it (analysis evidence ledger PRD, Q7 A).
- A check transcribes minutes of audio, and the narrator may only want to read the last result.
- The app already has one work dialog (ADR 0075, ADR 0076) and one first-use download prompt (`AssetInstallPrompt`).

## Considered options

1. A row's Check opens the chapter's stored result, and only a press in the dialog starts a check
2. A row's button starts a check at once

## Decision outcome

**Chosen option: a row's Check opens the chapter's stored result, and only a press in the dialog starts a check**, because a check transcribes minutes of audio, and the narrator may only want to read the last result.

- **A row's Check opens the chapter's stored result.** The dialog reads `CoverageResult` and shows it: never (what a check does), current, or stale (the plain-language reasons, with the old counts labelled as from then), always with the saved-project basis. **Check recording** or **Check again** in the dialog is the only thing that starts a check. The Home table never starts one.
- **Progress is the shared work dialog.** A started check swaps the result for `WorkDialog` fed by the `coverage:state` event: the host's percent and messages, Cancel, and Continue in background, which is allowed because the check ends with a `job:ended` the app announces (ADR 0076). The row shows the running percent, and pressing it reopens the progress. A completed check goes back to the result, and the panel reads the chapters again for the new measured number. `WorkJob.kind` gains the client-side `recording_coverage`.
- **The model download asks first.** An `asset_required` answer opens the same `AssetInstallPrompt` Proofing uses. After a successful install the check starts, and nothing downloads without a yes.
- **Every reason has a plain sentence in the UI.** `recordingCheckText.ts` maps every refusal and staleness word (28 distinct ones) to a sentence (a test covers the whole list from the schema). The host's own message, written for a log, is shown small as the detail. A chapter with no link (`unmapped`) gets `MappingConfirm` in the dialog. A link to a missing track or two links go to Tracks, because a new link does not replace an old one (the store keys links by track), so it has to be cleared first. A missing project file goes to Tracks and a missing sidecar goes to Settings.
- **The report states counts, not a verdict.** "All the text is recorded" only when no word is missing, otherwise "N words not recorded". Then each missing region with its paragraphs, first and last words, item and source time, a Go to paragraph link, and the paragraphs. When text is missing, only the short paragraphs are listed. Thresholds belong to the Phase 7 signal.
- **The recorded column names its source.** Under each actual recorded length: **measured** when the chapter payload has `recordedFraction` (a current check), otherwise **estimated from status**. The mock's fixtures now leave chapters 7 to 12 unmeasured, so both labels can be seen.

### Consequences

- **Good:** Opening a result never costs a transcription, and a check can never start by accident from the table.
- **Neutral:** A stale result stays readable but no longer counts as measured, so the headline "Actual recorded" can drop when the project changes. That is the intended honesty.
- **Neutral:** The dialog repeats nothing from Phase 7: when the signal lands, its met or not met can sit beside these counts without changing them.
- **Bad:** Relinking a chapter whose track is missing takes a trip to Tracks. Fixing that in place means a replace operation on the mapping store, which is a separate change.

### Confirmation

`recordingCheckText.ts` maps every refusal and staleness word to a sentence, and a test covers the whole list from the schema.

## Pros and cons of the options

### A row's button starts a check at once

- Bad, because a check transcribes minutes of audio, and the narrator may only want to read the last result.
