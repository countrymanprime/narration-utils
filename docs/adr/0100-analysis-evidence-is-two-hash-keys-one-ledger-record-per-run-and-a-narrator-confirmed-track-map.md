# 0100. Analysis evidence is two hash keys, one ledger record per run, and a narrator-confirmed track map

- **Status:** Accepted
- **Date:** 2026-09-22
- **Related:** Its "a suggestion is never treated as a link until the narrator confirms it through `MappingStore.Confirm`" clause is superseded by [ADR-0202](0202-a-confident-two-way-match-is-a-real-link-labelled-auto-undoable-and-never-over-a-manual-one.md)

## Context and problem

Every signal behind a "suggest this stage is done" recommendation (`chapter-stage-recommendations.prd.md` and its
siblings) needs to answer two questions the static project reader could not: which audio does a result describe, and
is that still the audio the narrator has now, without ever attributing a result to the wrong track. The analysis
evidence ledger PRD (`docs/prds/analysis-evidence-ledger.prd.md`) built this as `apps/desktop/internal/evidence`
across Phases 1-6; its own Decisions Log recorded the choices below as "(proposed)" while the code shipped, and this
ADR is the formal record those rows pointed at (Q1-Q7 above the log are the PRD's own tracking of the same
questions).

## Decision drivers

- A result must say which audio it describes, and whether that is still the audio the narrator has now.
- A result must never be attributed to the wrong track.
- ER's cache-reuse requirement rules out a re-decode on a position-only move.
- A cosmetic change (color, name, notes, fades, volume) must never read as an edit.
- Chapter ids reset on manuscript re-import.
- The standalone launch has no REAPER session to read.

## Considered options

1. Two hash keys, one ledger record per run, and a narrator-confirmed track map
2. One fingerprint that mixes what the audio is with where the item is
3. A hash of the whole REAPER `<ITEM>` chunk
4. A union of item-level cache hits
5. Live REAPER state as the basis

## Decision outcome

**Chosen option: two hash keys, one ledger record per run, and a narrator-confirmed track map**, because a single mixed fingerprint would force a re-decode on a position-only move, and a union of item-level cache hits would let a signal go `met` from runs that were never done together.

We use two separate hash keys, not one. The **analysis key** (`evidence.ComputeAnalysisKey`) hashes what the audio
content is: source identity, played range and playrate. The **item fingerprint**
(`evidence.ComputeItemFingerprint`) hashes what the item is on the timeline: the analysis key plus GUID, position,
length, mute and active-take index. A fingerprint that mixed both would force a re-decode on a position-only move,
which ER's cache-reuse requirement rules out. Both hash a fixed, canonical field set - never a hash of the whole
REAPER `<ITEM>` chunk - so a cosmetic change (color, name, notes, fades, volume) never reads as an edit.

We record one **ledger record** per analysis run, one file under `<project>/narration-utils/analysis/ledger/`
(`evidence.LedgerStore`), written atomically (temp file then rename, the `saveNotes` pattern) and kept past pruning
by `Retain(ids)` whenever something (a confirmation, a dismissal) still points at it. A signal reads as **current**
only when the latest record for (analyzer, chapter) is `complete` and its stored fingerprint, analyzer version,
parameter hash and confirmed track all still equal the current ones (`evidence.EvaluateChapter`). We rejected a
union of item-level cache hits: that would let a signal go `met` from runs that were never done together, against
different parameters or scopes.

We store the narrator's confirmed `trackGuid -> chapterId` link in `<project>/narration-utils/chapter-track-map.json`
(`evidence.MappingStore`), keyed by the manuscript's `documentId` and holding the chapter's title and confirmation
time beside the id, since chapter ids reset on manuscript re-import. A suggestion (`evidence.Suggester`) is never
persisted by suggesting it, and is never treated as a link until the narrator confirms it through
`MappingStore.Confirm` - surfaced in the UI by `apps/ui/src/components/mapping/MappingConfirm.tsx` and the Tracks
page's `Chapter links` list.

Every evaluator result is built against the saved `.rpp` on disk (`evidence.BuildBasis`), never live REAPER state:
the standalone launch has no REAPER session to read, so "saved project, file modified `<time>`" is the only basis
that is always available.

### Consequences

A position-only move stays a cache hit, and cosmetic REAPER edits never teach a narrator to ignore staleness - but
the fixed field set is a judgment call: a change outside it (a take's FX chain, an item's fade shape) that does
affect an analyzer's output will not invalidate a cached result, and each such analyzer must say so itself if a
future edit type turns out to matter. One `complete` record per (analyzer, chapter) as the currentness rule is
simple to test and explain, at the cost of a slower re-run after a one-item edit than a hypothetical item-union
scheme would give; the per-item cache (`evidence.CacheStore`) exists specifically to keep that re-run cheap.
Confirmed links are per-track-GUID, so nothing stops two tracks from being confirmed to one chapter; consumers
(SR) are expected to detect and report that case themselves rather than the store refusing it. Every result is
built from the saved file, so an edit made in REAPER and not yet saved will not be reflected until the narrator
saves; Q8's staleness warning (comparing the `.rpp`'s modified time to the newest ledger record) is the mitigation,
not a live read.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### One fingerprint that mixes both

- Bad, because it would force a re-decode on a position-only move, which ER's cache-reuse requirement rules out.

### A hash of the whole REAPER `<ITEM>` chunk

- Bad, because a cosmetic change (color, name, notes, fades, volume) would read as an edit.

### A union of item-level cache hits

- Good, because it would give a faster re-run after a one-item edit.
- Bad, because it would let a signal go `met` from runs that were never done together, against different parameters or scopes.

### Live REAPER state as the basis

- Bad, because the standalone launch has no REAPER session to read.
