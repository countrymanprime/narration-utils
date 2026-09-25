# 0204. The recording check result carries the host's judgement, by the stage signal's rule

- **Status:** Accepted
- **Date:** 2026-09-25
- **Related:** Supersedes the "The report states counts, not a verdict ... Thresholds belong to the Phase 7 signal" clause of [ADR-0130](0130-the-home-recording-check-opens-on-the-stored-result-runs-only-on-a-press-and-labels-the-recorded-length-measured-or-estimated.md)

## Context and problem

The owner asked on 2026-09-24 for the recording check to read as a chapter summary, starting with whether the chapter passes (`docs/prds/recording-check-summary.prd.md`, RS1). D39 answered it with the PRD's recommendation, option A: lead with the host's verdict. ADR 0130 had kept the dialog to counts and left the thresholds to the stage signal. When that signal landed (ADR 0131), `measuredSignal` applied the narrator's thresholds and named the gap that fails first (`largestGap`), but only the stage suggestion's evidence view ever showed it. A dialog that computed its own verdict from Settings could disagree with the stage engine over the same stored result.

## Decision drivers

- The owner asked for the recording check to read as a chapter summary, starting with whether the chapter passes (RS1).
- D39: lead with the host's verdict (the PRD's option A).
- A dialog that computed its own verdict from Settings could disagree with the stage engine over the same stored result.

## Considered options

1. One host function judges a report, and `CoverageResult` carries the judgement
2. The dialog computes its own verdict from Settings
3. Keep the status quo: ADR 0130's dialog of counts only, with the thresholds left to the stage signal

## Decision outcome

**Chosen option: one host function judges a report, and `CoverageResult` carries the judgement**, because a dialog that computed its own verdict from Settings could disagree with the stage engine over the same stored result.

- **One function judges a report.** `coverage.Judge(report, thresholds)` returns `met` when `Report.TextComplete` holds, otherwise `not_met` with `largestGap`'s reason. `measuredSignal` now gets its state and reason from `Judge`.
- **`CoverageResult` carries the judgement.** `ResultView.Judgement` is `{state, reason, thresholds}`, judged by the thresholds the binding reads from Settings (`coverageSettings(...).Thresholds`). It is set for any complete result with a report, a stale one included, which the dialog labels as of the last check. It is absent for never, for a partial or failed record, and for thresholds that do not validate.
- **The field is additive.** There is no `hostAPIVersion` bump. The Zod schema, the `coverage-result-current` and `-stale` goldens (written by `coverage/contract_test.go`), a `wireContracts.test.ts` row and the mock (`judgeMock`, a port of `Judge`, checked against the goldens) come with it.
- **Agreement is tested.** `judgement_test.go` checks the view and the signal on the signal-table fixtures. `corpus_test.go` checks every recording-coverage corpus case's real sidecar output.

### Consequences

- **Good:** The dialog's headline can say "Passes the check" or name the first gap without any threshold arithmetic in the UI (ADR 0131, "the host judges"). Switching the headline to it is UI work in `recordingCheckText.ts`, owned by the UI lane.
- **Neutral:** A stale result's judgement describes the old audio. The UI must keep the "from the last check" label beside it.
- **Neutral:** Changing the pass rule changes `Judge`, and the dialog and the stage engine move together. Letting either one judge on its own again would need an ADR that supersedes this one.

### Confirmation

`judgement_test.go` checks the view and the signal on the signal-table fixtures, `corpus_test.go` checks every recording-coverage corpus case's real sidecar output, and the mock's `judgeMock` is checked against the goldens.

## Pros and cons of the options

### The dialog computes its own verdict from Settings

- Bad, because it could disagree with the stage engine over the same stored result.
