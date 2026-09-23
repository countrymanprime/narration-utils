# 0160. Stage recommendations are computed from tri-state signals by a pure engine

**Status:** Accepted
**Date:** 2026-09-23

## Context

The narrator asked for the app to suggest when a chapter is done recording, editing or proofing, always as a suggestion
they confirm ([chapter stage recommendations PRD](../prds/chapter-stage-recommendations.prd.md)). The evidence comes
from three other PRDs (recording coverage, editing readiness, proofing readiness) written in parallel, so they need one
contract to code against before any of them builds a signal. Two constraints were already recorded: a recommendation
is computed on read and never stored as truth (D1), and a signal is tri-state, with `unknown` for anything never run,
stale, unmapped, partial or unavailable (D2). A signal that reads "no findings" as success would report "done" for a
chapter nobody analyzed (`measure.Evaluate` returns an empty slice for a compliant report), and a false "done" hides
real work until delivery, so the cost of the two errors is not symmetric.

The PRD's open questions had no owner answers; by rule D22 (`docs/prds/implementation-plan.md`) Phase 1 adopted each
question's recommendation where it needed one: no new `proofed` status (Q3), `not_started` is not evaluated (Q4),
evaluation on read only (Q5), a dismissal returns only when its basis changes (Q7), an empty required set never
recommends (Q8), one confirmed track per chapter (Q9), and evaluation never starts an analysis (Q12).

Alternatives considered: boolean signals (cannot tell clean from never ran), a single readiness score (over-trusts one
number, hides which check failed), letting `unknown` outrank `not_met` (hides the concrete reason when both are
present), and a free-text reason only for `unknown` (the UI cannot route the action that resolves it).

## Decision

`apps/desktop/internal/stages` defines the contract and the engine:

- A `Signal` has an id `<stage>.<name>`, the stage it judges finished (the chapter's current status), a state `met`,
  `not_met` or `unknown`, a short reason, typed evidence, an opaque basis (ledger record ids, fingerprint, project file
  modified time) and a computed time. An `unknown` signal carries exactly one `UnknownCause` from a closed list
  (`never_analyzed`, `stale`, `incomplete_run`, `analysis_running`, `unmapped_track`, `unconfirmed_mapping`,
  `multiple_tracks`, `measurement_unavailable`, `project_unreadable`, `provider_error`); a `met` or `not_met` signal
  carries none.
- A `Provider` declares its stage and every signal id it can report, and answers for one chapter from an
  `EvidenceView` built once per evaluation. It reads evidence only and never starts an analysis. A provider error
  makes every id it declared `unknown` with cause `provider_error`.
- `Evaluate` is a pure function. It judges only the chapter's current stage (`recording` to `editing`, `editing` to
  `proofing`, `proofing` to `finalized`); any other status, or an empty required set, is `none`. A required signal
  that is missing, duplicated, of another stage or invalid becomes `unknown` (`provider_error`). Any `not_met` gives
  `not_ready`; otherwise any `unknown` gives `unknown`; otherwise `recommended`, or `dismissed` when the narrator
  dismissed that exact basis.
- The basis key is a SHA-256 over the chapter id, the target stage and each required signal's id, state, ledger record
  ids and fingerprint, sorted, and excludes the computed time and the project file's modified time.

The contract is described for implementers in
[stage recommendations](../architecture/stage-recommendations.md).

## Consequences

- A chapter is suggested only when every required check was actually made on the current audio and passed; missing,
  malformed or failed evidence can hold a chapter back but never move it forward.
- The recording, editing and proofing signals plug in as providers without changing the engine, and the UI can route
  an action from each `unknown` cause.
- Most chapters will read `unknown` until the signals and the confirmed track mapping exist; the Home copy has to name
  the cause and the fix to keep that from being noise.
- A new cause, a new stage or a change to the verdict precedence changes this contract and needs an ADR that
  supersedes this one. Where the narrator's decisions are stored and how Confirm writes the status is a separate
  decision for the PRD's Phase 2.
