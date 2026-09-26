# Chapter stage recommendations: the signal contract

**Status: contract, engine, decision store and host bindings delivered, one signal.** The Go types, the `Provider` interface and the pure engine
are in [`apps/desktop/internal/stages`](../../apps/desktop/internal/stages) (Phase 1 of
[the chapter stage recommendations PRD](../prds/chapter-stage-recommendations.prd.md)). The recording signal,
`recording.text_present`, and its provider are in
[`apps/desktop/internal/coverage`](../../apps/desktop/internal/coverage) (`signal.go`, `provider.go`;
[ADR 0131](../adr/0131-the-recording-signal-is-read-from-stored-checks-with-thresholds-applied-on-read-and-alignment-from-settings.md)).
The decision store and the service that composes the providers, the engine and the manuscript's status path are in
`internal/stages` too (`store.go`, `service.go`, `assess.go`; Phase 2,
[ADR 0161](../adr/0161-stage-decisions-live-in-their-own-sidecar-and-confirm-writes-the-record-before-the-status.md)).
`coverage.Service.EvidenceView` builds the view every provider shares (`stages.Config.View`), and a test runs the
service over the recording-coverage corpus (Phase 3). The host builds the service for each project and four bindings reach
it (Phase 4, `apps/desktop/bindings_stages.go`, see [The bindings](#the-bindings)); the Home surface is Phase 5 (see [On Home](#on-home)). The
contract's decision is
[ADR 0160](../adr/0160-stage-recommendations-are-computed-from-tri-state-signals-by-a-pure-engine.md).

This page is for whoever implements a signal: recording coverage (`recording`), editing readiness (`editing`) and
proofing readiness (`proofing`).

## What the feature does

For each narration chapter the app suggests the next stage when the evidence says the current one is over, shows the
evidence, and changes nothing until the narrator clicks Confirm. A suggestion is computed when it is read and is never
stored as the truth. Only the chapter's current stage is judged, and a chapter moves one stage at a time:

| Chapter status | Signals judged | Suggested stage |
| --- | --- | --- |
| `not_started` | none | none (`stage_not_evaluated`) |
| `recording` | `recording.*` | `editing` |
| `editing` | `editing.*` | `proofing` |
| `proofing` | `proofing.*` | `finalized` |
| `finalized`, or a stored value the engine does not know | none | none (`stage_not_evaluated`) |

`stages.Stage` values are the stored `ChapterStatus` strings; there is no `proofed` stage.

## A signal

```go
type Signal struct {
	ID         string       // "<stage>.<name>", for example "recording.text_present"
	Stage      Stage        // the chapter's current stage, the one this signal judges finished
	State      SignalState  // met | not_met | unknown
	Reason     string       // one short sentence for the narrator
	Cause      UnknownCause // set only when State is unknown
	Evidence   []Evidence   // typed facts: kind, label, value, and file, range or paragraph ids where they apply
	Basis      Basis        // ledger record ids, fingerprint, project file modified time
	ComputedAt time.Time
}
```

- **`met`** only from a `complete` analysis at the chapter's current fingerprint whose result passes the rule. A clean
  result is not the same as "never ran" (D7).
- **`not_met`** from the same kind of current, complete analysis whose result breaks the rule. Say which part in
  `Reason` (for example "paragraph 12: 14 words not read").
- **`unknown`** for everything else, with a `Cause`:

| Cause | Use it when |
| --- | --- |
| `never_analyzed` | no ledger record exists for the chapter |
| `stale` | a record exists but the fingerprint, analyzer version, parameters or manuscript changed since |
| `incomplete_run` | the latest record is `partial` or `failed` |
| `analysis_running` | an analysis of this chapter is running now |
| `unmapped_track` | the chapter has no confirmed track |
| `unconfirmed_mapping` | a track matches the chapter by name but the narrator has not confirmed it |
| `multiple_tracks` | more than one track is confirmed for the chapter (v1 supports exactly one) |
| `measurement_unavailable` | the check cannot be made here (a model is missing, a source is undecodable) |
| `project_unreadable` | the saved project could not be read (`EvidenceView.ProjectErr`) |
| `provider_error` | the provider failed; the engine also uses it for a missing, invalid or duplicated signal |

`Signal.Validate` checks the id prefix, the state, and that a cause is set exactly when the state is `unknown`.
`UnknownSignal(id, stage, cause, reason)` builds a valid unknown signal.

The basis is opaque to the engine. Put the ledger record ids you read and the chapter fingerprint you compared at in
it (from `evidence.EvaluateChapter`), and the saved project's modified time, which the narrator sees as "saved project,
file modified <time>".

## A provider

```go
type Provider interface {
	Stage() Stage
	SignalIDs() []string
	Signals(ctx context.Context, chapter ChapterContext, view EvidenceView) ([]Signal, error)
}
```

- `SignalIDs` declares every id the provider can report. The narrator's `StageRecommendations` settings (Phase 6,
  `apps/desktop/app.go`'s `fieldSchemas`) choose the required set out of these ids: each is `required` or `ignored`
  (default `required`), and a master switch (`suggestions_enabled`) empties every stage's required set at once when
  off. `Config.RequiredSignals` narrows `DeclaredSignalIDs` accordingly; a nil `RequiredSignals` (a caller not wired to
  settings) keeps every declared id required, the original Q8 default.
- A provider may also drop its own ids that its evidence says are not required right now, by having a
  `FilterRequired(required []string) []string` method: the host's `RequiredSignals` (`apps/desktop/bindings_stages.go`,
  `filterRequired`) applies it after the settings, for the provider's own stage only, and never adds an id. The proofing
  provider ([`apps/desktop/internal/proofing`](../../apps/desktop/internal/proofing),
  [the proofing readiness signals PRD](../prds/proofing-readiness-signals.prd.md)) uses it so a delivery check
  (`proofing.delivery.<metric>`) is required only while the project's delivery profile has a required rule for its
  metric turned on, and `proofing.delivery.render_length` only while a tolerance is set; `proofing.pickups` is always
  required unless the narrator ignores it.
- `Signals` reads existing evidence only. It must not decode audio, transcribe, reach the network or start an
  analysis; the narrator starts analyses. `EvidenceView` is built once per evaluation and shared: the parsed saved
  project, its modified time, the ledger and the confirmed mapping, the inputs `evidence.EvaluateChapter` takes.
- `coverage.Service.EvidenceView` fills the view: the saved project is resolved and parsed by the recording check's
  rules. When it cannot be used, `ProjectErr` is the check's refusal (no file chosen, not in the project folder,
  unreadable), so a provider can name the action.
- Return an error only when you cannot answer at all. `Collect` then reports every declared id as `unknown` with cause
  `provider_error` and ignores any signals you returned with the error.

## The engine

`Evaluate(Input) Assessment` is pure: no file, no clock, no change to its input, and the same input always gives the
same result. Over the required signals of the chapter's current stage:

1. A required signal that is missing, reported twice, of another stage, or fails `Validate` becomes `unknown` with
   cause `provider_error`. Signals that are not required are ignored.
2. Any `not_met` gives `not_ready`. It outranks `unknown` because neither may recommend and the concrete reason is
   more useful.
3. Otherwise any `unknown` gives `unknown`. An `unknown` signal is never treated as `met`.
4. Otherwise every signal is `met`: `recommended`, or `dismissed` when the narrator dismissed this exact basis.
5. An empty required set gives `none` (`no_required_signals`) and never `recommended`.

The assessment lists the required signals sorted by id, the distinct causes of the unknown ones, and a **basis key**:
the hex SHA-256 of the chapter id, the target stage and each signal's id, state, ledger record ids and fingerprint, all
sorted. It leaves out `ComputedAt`, the project file's modified time, the reason and the evidence, so a re-save with the
same fingerprints keeps a dismissal. The UI sends back the key it showed, so Confirm and Dismiss can refuse when the
evidence changed while the narrator was looking.

## The narrator's decisions

`stages.Service` reads the manuscript through functions the host passes (`manuscript.Service`'s `Load`,
`ChaptersUnmeasured` and `SetChapterStatus`), so the stages package does not import the manuscript package. `Recommendations` assesses every
narration chapter (a chapter with no content kind is narration, as on Home), with one `EvidenceView` shared by every
provider. Nothing is cached: each call is a fresh read.

| Action | Checks first | Writes |
| --- | --- | --- |
| `Confirm(chapter, target, basisKey)` | Re-evaluates the chapter; refuses with `ErrBasisChanged` when the target or the key is not what the evidence gives now, and with `ErrNotRecommended` unless the verdict is `recommended` or `dismissed` | A `confirmed` record, then the status; the record is removed again if the status write fails |
| `Dismiss(chapter, target, basisKey)` | The same checks; a suggestion already dismissed on this basis is left as it is | A `dismissed` record only |
| `Revert(chapter)` | A live confirmation, else `ErrNothingToRevert` | A `reverted` record, then the status back to the confirmation's `from`, with the same rollback |

Decisions are an append-only list in `<project>/narration-utils/stage-decisions.json`:

```json
{
  "schemaVersion": 1,
  "documentId": "…",
  "decisions": [
    {
      "chapterId": "c-0002",
      "kind": "confirmed",
      "from": "recording",
      "target": "editing",
      "basisKey": "…",
      "basis": [{ "id": "recording.text_present", "state": "met", "ledgerRecordIds": ["…"], "fingerprint": "…", "summary": "…" }],
      "at": "2026-09-23T12:00:00Z"
    }
  ]
}
```

- **Scoped to the manuscript.** Chapter ids are positional and a re-import writes a new `documentId`, so a file kept
  for another `documentId` reads as empty and the next write replaces it. `resetDerived` deletes the file.
- **The narrator's own work.** A file that cannot be decoded is kept aside as `stage-decisions.json.corrupt-<time>` and
  the narrator is told; the read that met it is an error ("Couldn't check"), never an empty list. A file from a newer
  app is refused and never overwritten; one that cannot be read at all is not overwritten either.
- **Live confirmation.** A confirmation is live while it is the chapter's latest `confirmed` or `reverted` record and
  the status equals its target. A manual status change, a revert, or a crash between Confirm's two writes leaves it not
  live, without a write.
- **Contradiction.** While a confirmation is live, the signals of the stage it confirmed as finished are evaluated
  again. A `not_met` among them is the "evidence changed since you confirmed" notice (`contradiction`, with the stage to
  revert to). A changed basis without a `not_met`, such as a recording check gone stale because the chapter is being
  edited, sets `confirmation.evidenceChanged` and raises no notice (Q10). Nothing changes a status by itself.

## The bindings

The host builds one `stages.Service` per project in `configureLocked`, beside the coverage service, and rebuilds it on
every project switch; the bindings read it through `h.services()`. Its only provider so far is the recording signal
(`coverage.NewSignalProvider`, with the narrator's recording check settings and why a check could not run here now: no
Transcript Compare sidecar, or the Whisper model not installed), and its view is `coverage.Service.EvidenceView`. The
chapters are read with `ChaptersUnmeasured`, the chapter payload without `recordedFraction`, so an evaluation parses the
saved project once.

| Binding | Answers |
| --- | --- |
| `StageRecommendations()` | `{chapters: [...]}`: every narration chapter's assessment in manuscript order, with its title and, while one is live, `confirmation` and `contradiction` |
| `StageConfirm(chapterId, target, basisKey)` | `{status: "ok", chapter}` or `{status: "refused", reason, message}` |
| `StageDismiss(chapterId, target, basisKey)` | the same |
| `StageRevert(chapterId)` | the same |

A refusal changed nothing: `basis_changed` (check again), `not_recommended` or `nothing_to_revert`. Anything else (no
project, no manuscript, a file that could not be read or written) is a rejected promise, which Home shows as "Couldn't
check". The TypeScript contract is `apps/ui/src/api/contracts/stages.ts`, its schemas `schemas/stages.ts`, and the
payloads are pinned in `tests/fixtures/contracts/stages-*.json` (the cause and refusal word lists too). The browser mock
(`apps/ui/src/api/stagesMock.ts`) answers as the host does with the recording signal only, and a seed puts a chapter in
any verdict, cause or notice.

With only the recording signal wired, a chapter in editing or proofing reads `none` (`no_required_signals`) until the
editing and proofing signals exist (Phases 7 and 8).

**Cost, measured (Phase 4, Q5).** On a copy of a real project (a 4.2 MB `.rpp`, 35 narration chapters all set to
recording, 15 tracks, 3,894 items, 252 source files; Windows, the audio on a local disk) one `StageRecommendations` took
about 0.35 s with the project's own links (1 chapter linked) and 1.1 to 1.5 s with all 15 tracks linked to chapters. The
time is the saved project's parse, once per read, and each linked chapter's fingerprint, which hashes part of every
source file it plays (`evidence.Identify`); no audio is decoded. `stages_timing_test.go` repeats the measurement on any
project copy (`STAGES_TIMING_PROJECT`).

## On Home

Phase 5 shows the recommendations in the Home estimate card (`apps/ui/src/components/stages/`, wired into
`components/home/AudiobookEstimatePanel.tsx`). `useStageRecommendations` reads `StageRecommendations()` when Home opens,
after a manuscript import, after a recording check ends or its dialog closes, after a status is changed by hand, when the
window regains focus or the page becomes visible again (`useRefreshOnFocus`, throttled to once per 30 s and skipped while
a decision is pending, `home-stage-check-line.prd.md` Phase 2, Q2 A) and, on a
failed read, when Try again is pressed; nothing is cached across reads (D1, Q5). `StageSuggestion` sits under each
chapter's status select, which stays the narrator's override: the verdict in a few words, Confirm and Dismiss for
`recommended`, Revert for a live confirmation, and the "evidence changed since you confirmed" notice with Revert for a
`contradiction`. `StageEvidence` is the evidence view in the existing `SlideOver` (Q11): each signal's state, reason and
evidence (a paragraph it names links to the manuscript), the saved project's modified time and its age, and for an
unknown cause what resolves it (`stageText.ts`, `CAUSE_TEXT`: the recording check dialog, the Tracks page, or Check now).
`StageSummary` holds the chips on the collapsed card; `StageCheckLine` above the table renders nothing while the read
succeeds and only the reason and a Try again retry when it fails (`home-stage-check-line.prd.md` Phase 1). Confirm is one
click, reversible by Revert (Q13). A refusal is shown as an error toast and the recommendations are read again; a failed
read shows "Couldn't check" in every row. The mock's `?mockStages=mixed|error` seeds (`apps/ui/src/main.tsx`) drive the
visual states `home/stage-*`.