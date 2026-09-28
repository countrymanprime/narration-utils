# 0510. Click and breath signals open only on a recorded, permissioned held-out run at target in every condition

**Status:** Proposed (editing-readiness-analysis PRD Phase 4, stream N-K11; the owner confirms the bar, and runs the permissioned corpus, on #510)
**Date:** 2026-09-28
**Supersedes:** none. It fills in the gate [ADR 0266](0266-the-editing-check-panel-reads-its-per-class-state-from-srs-stage-signals-and-keeps-progress-inline-so-candidates-stay-visible-while-it-runs.md) read as `validatedAnalyzerVersions`, now `recordedValidations` and `IsValidated` in `apps/desktop/internal/editing/validation.go`.

## Context

The PRD's Q5 recommendation lets the `editing.clicks` and `editing.breaths` signals say `met` only for an analyzer
version "recorded as validated on the corpus", and Phase 4 is to record which versions are. Phase 5 wrote every class's
ledger record under one version (`editing-v1`) and left the validated set empty, with no rule for what fills it. Phase 4
ran DX Phase 9's detectors on the only corpus available, a synthetic one
([research note](../research/editing-click-breath-validation.md)). Held-out recall was 38% for clicks and 84% for
breaths, against the proposed 90%. Q10 already says synthetic breaths and clicks are not a validation.

## Decision

1. **Each class has its own analyzer version**, `editing-click-v1` and `editing-breath-v1`, stamped on its own ledger
   record with only its own count, and part of the scan's cache key. A change to the detector or to its default is a new
   version.
2. **A version is validated only by a recorded run** (`DetectorValidation` in `validation.go`) that has all of:
   - exactly that analyzer and version;
   - a `permissioned` corpus (never `synthetic`);
   - held-out recall of at least `RecallTarget` (0.9, the PRD's proposed target) overall **and in every recorded
     condition**.

   Precision does not gate, because every open candidate already blocks (Q4).
3. **The gate comes first** in `ClassSignal`. An unvalidated version is `unknown` (`measurement_unavailable`) whatever
   the scan found, and still lists its open candidates and the recorded run as evidence. A validated version follows the
   empty-space rule without its policy.
4. **The recorded runs are pinned to the detector** by `TestRecordedValidationsAreTheHeldOutRun`: a recorded number that
   stops matching what the detector does now fails the build, so no number stands without the run behind it.
5. **Both classes ship gated off.** Their synthetic runs are recorded, and neither validates.

## Consequences

- No path reaches `met` for clicks or breaths until someone records a permissioned run at target. A narrator who wants an
  editing suggestion today deselects those two checks in SR, as the PRD's MVP scope foresaw.
- "Every condition" is stricter than a pooled recall. A detector that is fine in a studio but blind in a noisy room stays
  gated, which is the false-"done" asymmetry the PRD asks for. It also means a real corpus has to record each file's
  condition.
- Opening a class is a hand edit to `recordedValidations` beside the run's numbers in the research note, reviewed like
  any change. `TestShippedDetectorsAreGatedOff` fails until that is done on purpose.
- For the owner: whether 90% in every condition is the right bar, and the permissioned run itself (#510).
