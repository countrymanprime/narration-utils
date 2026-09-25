# 0129. The coverage bindings answer refusals as results, end with one job event, and fill recordedFraction only from a current check

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

Phase 5 of `docs/prds/recording-coverage-analysis.prd.md` connects the coverage service of [ADR 0128](0128-the-coverage-service-reads-the-saved-project-keeps-words-per-source-range-and-leaves-model-and-language-out-of-the-parameter-hash.md) to the UI and gives the Home estimate a measurement. The PRD settles what the number is (D11: the share of the chapter's words present), when a check runs (Q14: only when the narrator asks) and what an unmeasured chapter shows (Q12 A: no number, and the UI keeps its status estimate, labeled in Phase 6). Four things were left to this phase:

- How a refused check reaches the UI. The service refuses a chapter it cannot measure with a typed `Reason` (unmapped, a missing source, ...). Phase 6 has to say why, and Phase 7's signal maps every reason to `unknown`.
- How a running check reports. [ADR 0076](0076-a-host-job-ends-with-one-job-ended-event-the-app-announces-it-and-the-story-bible-rebuild-may-continue-in-the-background.md) says every host job ends with one `job:ended` event.
- What `CoverageResult` sends. `coverage.ChapterResult` holds the ledger record, with its item fingerprints and analysis keys, and the stored report with its hashes.
- How `recordedFraction` gets into the chapter payload. The manuscript package builds it, and the PRD says it must not import the coverage package.

## Decision drivers

- The number is the share of the chapter's words present (D11).
- A check runs only when the narrator asks (Q14).
- An unmeasured chapter shows no number, and the UI keeps its status estimate (Q12 A).
- Phase 6 has to say why a check was refused, and Phase 7's signal maps every reason to `unknown`.
- Every host job ends with one `job:ended` event (ADR 0076).
- The manuscript package must not import the coverage package (the PRD).

## Considered options

1. Refusals answered as results, one job end per run, and `recordedFraction` only from a current check

No alternatives were recorded when this decision was made.

## Decision outcome

**Chosen option: refusals answered as results, one job end per run, and `recordedFraction` only from a current check**, because Phase 6 has to name why a check was refused, ADR 0076 says every host job ends with one `job:ended` event, and the manuscript package must not import the coverage package.

- **Four bindings.** `CoverageStart(chapterId)`, `CoverageState()`, `CoverageCancel()` and `CoverageResult(chapterId)` in `apps/desktop/bindings_coverage.go`, all through `h.services()`. The UI's only input is a chapter id. The model is the narrator's Transcript Compare `model_size` (Q7 A), checked against the approved Whisper catalog, and the language is automatic until a setting exists. `hostAPIVersion` is 30.
- **A refusal is an answer, not an error.** `CoverageStart` answers `{status: "started", state}`, `{status: "refused", reason, message}`, or the same `asset_required` answer as `TranscriptStart` when the model is not installed. Only a failure to write the run's files or launch the sidecar rejects the promise. `CoverageResult` reads a chapter that cannot be evaluated as `never` with that reason, as `Service.Result` already does. The reason words are a closed list in the UI schema. `coverage.RefusalReasons` lists them in Go, a test parses `reason.go` so a new constant cannot be left out, and a golden file (`coverage-reasons.json`) holds the UI list to the Go one.
- **One live event and one job end.** Every state change is sent as `coverage:state`. The first `complete`, `failed` or `cancelled` state of a run id also publishes one `job:ended` of kind `recording_coverage` (outcome `success`, `error` or `cancelled`). A check can take minutes of transcription, so the kind is one the app may raise an operating system notification for (`jobEnded.ts`).
- **The result is a view.** `CoverageResult` sends `coverage.ResultView`: state and reasons, the basis (label, the saved file's time, the Q8 warning), the record's id, outcome and times, and the report's counts, items, paragraphs and regions with the model, language and alignment that made it. Fingerprints, analysis keys and the stored hashes stay in the host. A stale result keeps its report, so Phase 6 can show what was measured before. `recordedFraction` is on the view only when the result is current.
- **`recordedFraction` through a provider.** `manuscript.Service.SetRecordedFractions` takes a function from the host, bound to the project's coverage service when the project is attached. `Chapters`, `Reader` and `SetChapterStatus` call it once per payload and set `recordedFraction` only for the chapter ids it returns. `coverage.Service.RecordedFractions` returns only chapters whose newest complete run is current. A stale, partial, failed, unmapped or never-run chapter is absent. It reads nothing but the ledger when no complete coverage record exists, and it reads the saved project once when one does. It never starts a check.
- **One alignment for start and read.** Start and read both use `coverage.DefaultAlignmentParams` until Phase 7 moves the thresholds into settings. A result is never stale only because the two disagreed.

### Consequences

- **Good:** Phase 6 can name every refusal and stale reason without parsing messages, and the mock can show each one (`createMockApi({}, { coverage: { refusal } })`).
- **Good:** The app announces a finished check and may notify for it wherever the narrator is. The Home page learns of the new number the next time it reads the chapters.
- **Neutral:** A new refusal reason is a contract change. The Go test, the golden file and the UI schema move together, and `hostAPIVersion` is bumped.
- **Bad:** Loading the chapter list reads the analysis ledger every time, and parses the saved `.rpp` and stats the chapter sources whenever a coverage record exists. That cost is paid only by projects that have run a check.

### Confirmation

`coverage.RefusalReasons` lists the reason words in Go, a test parses `reason.go` so a new constant cannot be left out, and a golden file (`coverage-reasons.json`) holds the UI list to the Go one.
