# 0161. Stage decisions live in their own sidecar, and Confirm writes the record before the status

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

[ADR 0160](0160-stage-recommendations-are-computed-from-tri-state-signals-by-a-pure-engine.md) settled how a chapter's
stage suggestion is computed and left open where the narrator's answers to it are kept and how Confirm changes the
status. The narrator can confirm a suggestion, dismiss it, or revert a confirmation, and the app must remember each of
those without ever changing a status by itself
([chapter stage recommendations PRD](../prds/chapter-stage-recommendations.prd.md), D1, D4).

Three facts in the code limit the choice. The chapter status sidecar, `manuscript-notes.json`, keeps only `notes`,
`chapterStatus` and `readerState` (`normalizeNotes`), so a new key there is dropped on the next save, and it reads a
status with a string assertion, so an object-valued status would read as `not_started`. Chapter ids are positional and
a re-import writes a new `documentId`, so anything keyed by chapter id is wrong after a re-import. And a Confirm touches
two files, the decision and the status, so a crash can land between the writes.

The PRD's questions Q1 (where decisions are stored), Q2 (does Confirm set the status) and Q10 (does stale evidence alone
raise the contradiction notice) had no owner answer. By rule D22 (`docs/prds/implementation-plan.md`) Phase 2 adopts
each recommendation: Q1 A, Q2 A, Q10 B.

Alternatives considered: extending `manuscript-notes.json` (breaks on the code as written, and an older build would
drop the record on its next save); storing decisions as findings in the findings store (findings are analyzer output
with review states, not narrator state about a chapter); Confirm recording only and the narrator then changing the
status (two steps for one intent invite drift); deriving the status from the records (every existing reader of
`chapterStatus` would change); raising the notice on any stale evidence (editing changes fingerprints by design, so
every edited chapter would warn).

## Decision drivers

- The app must remember a confirm, a dismiss or a revert without ever changing a status by itself (D1, D4).
- `manuscript-notes.json` drops a new key on the next save, and reads a status with a string assertion.
- Chapter ids are positional, and a re-import writes a new `documentId`.
- A Confirm touches two files, so a crash can land between the writes.
- Rule D22: Phase 2 adopts the recommendations Q1 A, Q2 A and Q10 B.

## Considered options

1. A separate `stage-decisions.json` sidecar, with Confirm writing the record before the status
2. Extending `manuscript-notes.json`
3. Storing decisions as findings in the findings store
4. Confirm recording only, and the narrator then changing the status
5. Deriving the status from the records
6. Raising the notice on any stale evidence

## Decision outcome

**Chosen option: a separate `stage-decisions.json` sidecar, with Confirm writing the record before the status**, because extending `manuscript-notes.json` breaks on the code as written, and a Confirm that set no status would take two steps for one intent.

- Decisions are kept in `<project>/narration-utils/stage-decisions.json`: `schemaVersion`, the manuscript's
  `documentId`, and an append-only `decisions` list of `{chapterId, kind, from, target, basisKey, basis, at}` where
  `kind` is `confirmed`, `dismissed` or `reverted` and `basis` is each signal's id, state, ledger record ids,
  fingerprint and reason. A file kept for another `documentId` reads as empty and is replaced by the next write;
  `resetDerived` deletes the file. Writes go through a temporary file and a rename.
- The file is the narrator's own work (ADR 0069): a file that cannot be decoded is kept aside and the narrator is told,
  and the read that met it is an error ("Couldn't check"), never an empty list; a file from a newer app is refused and
  never overwritten.
- Confirm takes the basis key the narrator saw, re-evaluates the chapter, and refuses when the key or the target is not
  what the evidence gives now, or the verdict is not `recommended` or `dismissed`. It then writes the `confirmed` record
  and sets the status through the existing `SetChapterStatus` path; if the status write fails it removes the record. A
  crash between the writes leaves a record whose target is not the chapter's status, which is ignored.
- A confirmation is live while it is the chapter's latest confirmed or reverted decision and the status equals its
  target. A manual change with the status `<select>` or a revert therefore retires it without a write.
- Dismiss writes a `dismissed` record only; the engine hides the suggestion while its basis key is unchanged. Revert
  writes a `reverted` record, then sets the status back to the confirmation's `from`, with the same rollback.
- While a confirmation is live, the signals of the stage it confirmed as finished are evaluated again. A `not_met`
  among them raises the "evidence changed since you confirmed" notice with a revert to that stage. A changed basis
  without a `not_met` (stale or unknown evidence) is reported quietly as `evidenceChanged` and raises no notice.
  Nothing changes a status without the narrator's click.

### Consequences

- **Good:** Only the decisions file and `manuscript-notes.json` change on a Confirm or a Revert, and only the decisions file on a
  Dismiss; the status stays the single source of truth for Home's meter, the chapter dot and the estimate.
- **Bad:** A re-import or a Clear drops every decision with the chapter ids they named; the narrator decides again on the new
  import.
- **Neutral:** A crash between the writes can leave an orphaned confirmation. If the narrator later sets that same status by hand,
  it becomes live again; that only shows the confirmation they had made, so it is accepted.
- **Neutral:** Confirm always re-evaluates, so its cost is one evaluation of one chapter. Phase 4 measures an evaluation on a real
  project.
- **Neutral:** Changing where decisions live, the Confirm write order, or what raises the notice needs an ADR that supersedes this
  one.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Extending `manuscript-notes.json`

- Bad, because it breaks on the code as written, and an older build would drop the record on its next save.

### Storing decisions as findings in the findings store

- Bad, because findings are analyzer output with review states, not narrator state about a chapter.

### Confirm recording only, and the narrator then changing the status

- Bad, because two steps for one intent invite drift.

### Deriving the status from the records

- Bad, because every existing reader of `chapterStatus` would change.

### Raising the notice on any stale evidence

- Bad, because editing changes fingerprints by design, so every edited chapter would warn.
