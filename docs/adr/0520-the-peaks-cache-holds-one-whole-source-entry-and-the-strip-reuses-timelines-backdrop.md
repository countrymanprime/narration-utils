# 0520. The peaks cache holds one whole-source entry per file, and the waveform strip reuses `Timeline`'s own `backdrop`

**Status:** Accepted
**Date:** 2026-09-28
**Supersedes:** none.

## Context

The edit-and-proof-workspace PRD's Phase 5 (Waveform strip) was answered at the design level by EP12 A (2026-09-25): host-computed min/max peaks from WAV sources, cached per source identity in the evidence cache. `measure.ComputePeaks`/`PeaksFile` (Phase 0 desk work) already compute peaks over an arbitrary range of a source; what Phase 5 adds is the cache, the host binding and contract, and the canvas.

Two questions EP12 A left open:

1. **What does the cache key on?** A chapter's items are analyzed one at a time, each with its own played range (`AlignmentItem.SourceStart`/`Length`/`PlayRate`), but several items - retakes of the same passage, or several chapters recorded into one long session file - can share one underlying source file. The evidence cache's own established pattern (`internal/evidence/cache.go`, Q5 option A, already used by `coverage/words.go` for transcript words) caches a **whole-source** feature set, sliced to a played range on read, precisely because that shape survives a trim (which only narrows or moves the played range) instead of missing on every one.
2. **Where does the canvas live?** `apps/ui/src/components/primitives/Timeline.tsx` (studio-ui-primitives PRD) already exists, with a `backdrop` prop whose own doc comment says: "a decorative visual the feature draws under the lanes (**a waveform**); the primitive itself draws no audio". `NotesStrip.tsx` (ADR 0470, mock 04's book-level notes strip) already uses `Timeline` and `TimelineLane` for its pins, and its own comment says explicitly: "the host sends no peaks for a chapter, so there is no waveform to draw... rather than an invented one" - naming this exact binding as the thing it is waiting on.

## Decision

1. **The evidence cache holds one whole-source peaks entry per (source identity, buckets-per-second)**, computed once from the source's absolute position 0 (`measure.CachedPeaksFile`, `apps/desktop/internal/measure/cache.go`), never keyed by played range. A caller's request for a narrower range slices the cached whole-source buckets (`slicePeaks`) rather than triggering a second computation; the sliced answer's `StartSeconds` is its first returned bucket's own start, bucket-aligned to the source's absolute zero, which may differ slightly from the exact seconds asked for when that does not fall on a bucket boundary - the same rounding a canvas drawn from these buckets already has to tolerate. `WorkspacePeaks` (`apps/desktop/bindings_workspace_peaks.go`) answers one entry per analyzed item of a chapter's stored alignment, resolving each item's active take's source file and played range and reading it through this cache; an item that is not live, has no source, or is not a WAV answers a `Reason` (`measure.ErrNotWAV`, EP12 A: "no waveform") instead of failing the whole call.
2. **The chapter workspace's own waveform strip (`apps/ui/src/components/proof/WaveformStrip.tsx`) composes `Timeline` and `TimelineLane`**, rather than a bespoke canvas-plus-markers component: the peaks are drawn as `Timeline`'s `backdrop` (one bar per pixel column resampled from each item's buckets, coloured played/not-yet-played against the app's own elapsed playhead), `Timeline`'s own `playhead` line is reused as-is, and the check's flags become one `TimelineLane`'s markers (keyboard-navigable, activating the same flag selection `FlagsPanel` uses), instead of hand-rolled triangles. This strip is new (its own place above the transport, in the app's elapsed-time coordinate space `useChapterPlayback`/`playlist.ts` already use) rather than a change to `NotesStrip.tsx` (a different coordinate space - REAPER project position over a track's span, not the app's played-source elapsed time - and a component this PR leaves untouched to stay out of adjacent in-flight work on `ProofingStagePanel.tsx`).

## Consequences

- A chapter whose items share a source file (retakes on the same take, or one long session file cut into several items) pays for peaks computation once, not once per item; reopening a chapter re-reads its peaks from disk rather than re-decoding audio (EP12 A's 3.4 s/hour budget is paid once per file, not once per open).
- `WaveformStrip` gets `Timeline`'s accessibility (the ruler, the roving-focus marker group, the playhead) for free, and stays consistent with `NotesStrip`'s own use of the same primitive rather than diverging.
- `NotesStrip.tsx` still draws its pins over a plain rule (ADR 0470): feeding `WorkspacePeaks` into it, in its own REAPER-project-time coordinate space, is a natural follow-up this ADR does not do.
- Selection over the waveform (Phase 9's FX context menu on a passage) is not built here; Phase 9 already lists this phase as its own dependency for exactly that reason.
- To change any of this, write an ADR that supersedes this one.
