# 0120. Findings are read and decided through four generic bindings, and a decision carries the evidence version it was made against

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

`docs/prds/review-dashboard-and-findings-adoption.prd.md` Phase 4 gives the UI a way to read and decide the findings
that Transcript Compare, the Story Bible and take review already write into the project's findings store
(`apps/desktop/internal/findings`, Phases 1-3). The PRD had already settled that filtering and sorting run in Go over
`findings.Query` (Q9) and that the decision history is append-only with an `evidence_version` beside each id (Q2, Q5).
Three questions were still open when the bindings were written:

- **One surface or one per analyzer.** Take review already has its own `TakeReviewFindings` binding, which returns
  only its analyzer's findings. The teleprompter PRD will soon write `transcript_discrepancy` findings from live
  sessions, and the character and diagnostics PRDs add analyzers of their own. A binding per analyzer would mean a
  host API bump, a schema and a mock for each one.
- **What a decision is made against.** `findings.Store.RecordDecision` takes an `evidenceVersion`, and the store's
  merge keeps a decision only while the evidence version matches. If the host filled in the version itself (the
  PRD's sketch was `FindingsReview(id, status, note)`), a re-run that changed the evidence between the page showing a
  finding and the narrator clicking would record the decision against evidence the narrator never saw.
- **How the query crosses the boundary.** Every other string binding takes positional arguments; a filter with
  eleven optional fields does not fit that shape, and the teleprompter phase will want to add filters.

## Decision drivers

- Filtering and sorting run in Go over `findings.Query` (Q9), and the decision history is append-only with an `evidence_version` beside each id (Q2, Q5).
- More analyzers are coming (live teleprompter sessions, the character and diagnostics PRDs).
- A decision must never be recorded against evidence the narrator never saw.
- A filter with eleven optional fields does not fit positional arguments, and more filters are coming.

## Considered options

1. Four generic bindings, with a decision carrying the evidence version it was made against
2. A binding per analyzer
3. The host filling in the evidence version itself (`FindingsReview(id, status, note)`)
4. Positional query arguments

## Decision outcome

**Chosen option: four generic bindings, with a decision carrying the evidence version it was made against**, because a new analyzer that saves into the store then appears on the Review page with no binding, schema or host API change, and a decision is never applied to evidence the narrator did not see.

1. **Four generic bindings serve every analyzer** (`apps/desktop/bindings_findings.go`): `FindingsList(query)`,
   `FindingsGet(id)`, `FindingsReview(id, evidenceVersion, status, note)` and `FindingsSummary()`. They read the
   store through `h.services()` (ADR 0041) and never mention an analyzer by name, so a new analyzer that saves into
   the store appears on the Review page with no binding, schema or host API change. `TakeReviewFindings` stays as it
   is for the Tracks page; it reads the same store.
2. **The query is a struct with optional camelCase fields** (`FindingsQuery`, generated into
   `apps/ui/wailsjs/go/models.ts`), converted to `findings.Query` and validated there (`Query.Validate`): an unknown
   category, severity, status or sort key, a minimum confidence outside 0 to 1, or a negative limit or offset fails
   the call instead of silently matching nothing. New filters are added as optional fields, which is additive.
3. **Sorting and paging live in `findings.Query`** (`apps/desktop/internal/findings/query.go`): sort keys `chapter`
   (the default), `time`, `confidence` and `severity`, each with one natural order that `descending` reverses; a
   finding with no value for the key (no time range, no numeric confidence) sorts last in either direction, so
   "unknown" never reads as best or worst; ties break by chapter id then finding id so paging is stable. `Page`
   answers one page and the number of matches before paging (`{findings, total}`).
4. **A decision carries the evidence version the page showed.** `FindingsReview` refuses the call when that version
   no longer matches the stored finding ("this finding changed since it was shown"), and when the finding is gone,
   and records nothing in either case. If a re-run lands between that check and the append, the store's own merge
   returns the finding to unreviewed with the note kept, so a decision is never applied to evidence the narrator did
   not see. `unreviewed` is an accepted status, so reopening a decision is itself a recorded decision. The host
   stamps the time; a note is capped at 2,000 characters because the history is append-only and read in full on
   every save.
5. **`FindingsSummary` counts the latest run by status and lists the facets present** (analyzers, categories,
   chapters with a title, including findings not in the latest run), so the Review page's badge is `unreviewed` and
   its filters offer only values that match something.
6. **Wire shape.** A finding keeps the findings contract's snake_case (`docs/architecture/findings-contract.md`); the
   envelopes around it (query, page, summary) are camelCase like every other binding. The UI schema
   (`apps/ui/src/api/schemas/findings.ts`) keeps `category` and `analyzer` open strings, so a newer host's category
   still loads, and types `evidence` as an opaque record, since each analyzer documents its own keys.

### Consequences

- **Good:** The teleprompter's live flags, character continuity and diagnostics findings need only save into the store to be
  listed, filtered, decided and counted.
- **Neutral:** The browser mock (`apps/ui/src/api/findingsMock.ts`) repeats the host's filter and sort rules so the Review page can
  be built without a host; the host's tests (`internal/findings/query_test.go`) are the ones that define them, and a
  drift shows up as a mock that orders differently from the golden payloads.
- **Bad:** A narrator who decides a finding after its analyzer re-ran gets an error and must look again; the Review page
  (Phase 5) has to reload the finding when that happens.
- **Neutral:** Every call still reads every scope file; paging bounds what crosses the boundary, not what is read. If real books
  make that slow, an index belongs behind `Store.Page` without changing the bindings.
- **Neutral:** `hostAPIVersion` went from 36 to 37 for the four new bindings.

### Confirmation

The host's tests (`internal/findings/query_test.go`) define the filter and sort rules; the browser mock repeats them, and a drift shows up as a mock that orders differently from the golden payloads.

## Pros and cons of the options

### A binding per analyzer

- Bad, because each one would mean a host API bump, a schema and a mock.

### The host filling in the evidence version

- Bad, because a re-run between the page showing a finding and the narrator clicking would record the decision against evidence the narrator never saw.

### Positional query arguments

- Bad, because a filter with eleven optional fields does not fit that shape.
