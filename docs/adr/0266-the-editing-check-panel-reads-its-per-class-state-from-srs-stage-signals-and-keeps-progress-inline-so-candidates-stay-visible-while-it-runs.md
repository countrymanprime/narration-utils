# 0266. The editing check panel reads its per-class state from SR's stage signals, and keeps progress inline so candidates stay visible while it runs

**Status:** Proposed
**Date:** 2026-09-26

## Context

[Editing Readiness Analysis](../prds/editing-readiness-analysis.prd.md) Phase 7 ("Editing check panel", stream C9)
builds the `SlideOver` that runs Phase 5's scan job and shows Phase 6's three signals
(`editing.empty_space`, `editing.clicks`, `editing.breaths`) with their candidates, opened from SR's evidence
popover (`StageEvidence.tsx`, chapter-stage-recommendations.prd.md Phase 5) and from the Tracks page's chapter
links list. Three questions had no answer yet in either PRD:

1. Where does the panel's "state, per class" (met, not met, unknown with its cause and reason) come from? Phase 5's
   job bindings (`EditingStart`, `EditingState`, `EditingCancel`, `EditingCandidates`,
   `apps/desktop/bindings_editing.go`) answer a scan's own progress and its stored candidates, but never a signal's
   `state`/`reason`/`cause` — that is Phase 6's `stages.Signal`, read today only through
   `StageRecommendations()` (`apps/desktop/bindings_stages.go`), and only for the chapter's *current* stage
   (`apps/desktop/internal/stages` engine, D3: "evaluated only while status is `editing`").
2. Recording Check Summary's own slide-over (ADR 0264, `RecordingCheck.tsx`) swaps its whole body for a `WorkDialog`
   while a check runs, replacing the last result with the live job. Should this panel do the same?
3. Reusing RD-4's review bindings and RD Phase 7's REAPER navigation is a given (Phase 7's Depends row: `5, RD-4,
   SR-5, EL-7`, no new binding expected) — but reusing the exact components (`ReaperControls.tsx`,
   `useRangePlayer.ts`) versus writing parallel ones for this panel was still a choice.

## Decision

1. **The panel reads `StageRecommendations()` for its own chapter and filters to the three editing-signal ids it
   knows**, rather than adding a new binding. This is pure consumption of an existing, already-evaluated read (Q9:
   "reads only, starts nothing"): the panel calls it once on open and again after a run ends or a mapping is
   confirmed, exactly as `StageEvidence.tsx` already does for its own "Check now". When the chapter's status is not
   `editing` (opened from the Tracks page for a chapter in any other stage) or the read fails, no signal is shown at
   all: the class card falls back to a plain candidate count from `EditingCandidates` and says so ("A met or
   not-met status shows only while this chapter is in Editing") rather than inventing a state this build did not
   compute. A signal is always a richer explanation of what the candidates already say, never the only source of
   truth for whether candidates exist.
2. **The panel stays open and shows real progress inline (a `ProgressBar` and Cancel in its own body), never
   swapping to a separate `WorkDialog`.** Unlike the recording check, editing's own job has no live push event yet
   (Phase 5's own note: "There is no live event... unlike CoverageState's `coverage:state`"), so the panel polls
   `EditingState()` itself every 500 ms while a run for its own chapter is going. Keeping the previous scan's
   candidates listed underneath the progress bar, rather than replacing them with a dialog, matches the job's own
   cache-first design: re-checking a mostly-cached chapter finishes in well under a second, and hiding the
   candidates a narrator was just reading behind a modal for that brief moment would cost more than it explains.
3. **REAPER navigation and the hear control are the exact same components the Review page already uses**
   (`ReaperControls.tsx`, `hasAudio()`, `useRangePlayer.ts`, RD Phase 7 and the take-review audition dialog), not
   reimplementations. A candidate's Go to / Loop / Add marker degrade exactly as they already do there: off with the
   reason underneath until `FindingsReaperStatus` reports a connection, an outcome `refused` shown as an inline
   alert, never a second code path to keep in sync with RD Phase 7's own future changes.
4. **Candidates are ordered earliest-first by project time within each class, and classes are always listed in a
   fixed order (empty space, click, breath)** - the order the three signal ids are declared in
   `apps/desktop/internal/editing/signals.go`. Neither ordering is specified by any PRD; both are arbitrary but
   fixed, so the same scan always presents the same list.

## Consequences

- No new host binding, wire schema or `hostAPIVersion` bump: Phase 7 only reads `StageRecommendations`,
  `EditingStart/State/Cancel/Candidates` and RD-4/RD Phase 7's existing bindings, matching the PRD's expectation
  that this phase is "pure consumption".
- A chapter's editing state is honest about the D3 gate: opened from the Tracks page for a chapter still in
  Recording, or already in Proofing, the panel never claims a met/not-met status it did not read, and says exactly
  why (a candidate count instead of a state) rather than showing a stale or invented signal.
- The browser mock (`stagesMock.ts`) had to learn the same gate to stay honest: it produces the three editing
  signals only for a chapter with an explicit `editing` seed, keeping every existing test and demo of a plain
  confirmed-from-Recording chapter (verdict `none`, no signals) unchanged; click and breath are never seeded at all
  and always answer "not yet validated on the corpus" (Phase 4 is not shipped), matching the real engine's
  `validatedAnalyzerVersions` gate exactly.
- A future change that wants the job's own live event (a `editing:state`-style push, closing the gap Phase 5's note
  names) can add it without touching this panel's shape: it already polls a plain `EditingState()` read, so
  swapping the poll for a subscription is a change inside the panel, not a new one.
- Reusing `ReaperControls` also brings its "Add marker in REAPER" affordance (RD Phase 8) into the panel for an
  accepted candidate, which the PRD's own scope list does not name explicitly; this is accepted as a side effect of
  reuse over duplication, not a new decision of its own; a future decision could split it out if that turns out to
  be wrong for this panel.
