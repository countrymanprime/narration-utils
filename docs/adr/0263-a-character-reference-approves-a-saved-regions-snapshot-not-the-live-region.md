# 0263. A character reference approves a saved region's snapshot, not the live region

**Status:** Accepted
**Date:** 2026-09-26

## Context

`docs/prds/character-continuity-review.prd.md` Phase 3 ("Region listing and reference approvals") needed answers to three of the PRD's open questions before any code: Q2 (how a reference is identified), Q3 (how the app lists regions for approval) and Q7 (what voice data is stored, and what a manuscript replace does to it). The PRD's own recommendations already picked a direction for each; this ADR records that they were followed as designed and adopted, with no material change, in `apps/desktop/internal/character` (stream A8, `Refs #509`).

Region GUID availability and how a saved `.rpp` serializes it were flagged in the PRD as unverified without a real, REAPER-saved project (Q2's TBD). `apps/desktop/internal/tracks/parse.go` already parses region MARKER lines with their GUIDs (`Region.GUID`, added for an unrelated chapter-region feature), and lane A's own fixtures (`internal/tracks/testdata/reaper/*.rpp`) confirm the serialized shape, so that unverified assumption is resolved: a saved project's regions do carry a stable GUID this package can rely on.

## Decision

A character voice reference (`character.Reference`) names a region by its REAPER GUID, plus a `RegionSnapshot` (the region's name and time range) taken at the moment of approval (Q2, option A). The snapshot, not the live region, is what a later baseline (Phase 5, not built yet) would read from; on every listing (`Service.References`), the currently saved region (re-parsed) is compared against the snapshot, and a mismatch - a different name, a different time range, or the region no longer existing at all - is reported as `ChangedSinceApproval`, never silently accepted as if nothing changed. A project that cannot be parsed at all is treated the same way: every reference reads as changed, because an unverifiable reference is never reported as still valid.

Regions are listed by parsing the narrator's saved `.rpp` directly (`tracks.Parse`, already built), never through a live Lua bridge command (Q3, option A). This works standalone and is fully testable with fixtures, at the cost of being blind to a region added since the last save; Phase 3 accepts that cost as the PRD recommends, and revisits it (Q3, option B) only if this proves inadequate once phase 6 puts it in front of a narrator.

Approvals are the Go host's own data, `<project>/narration-utils/characters/references.json` (`character.Dir`), written directly by `apps/desktop/internal/character` with no sidecar process involved, atomically (temp file then rename, the same pattern `internal/stages`'s `DecisionStore` already uses). It stores only the snapshot and approval metadata (character id, region GUID, approved timestamp, an optional note) - no embeddings, no audio (Q7). Revoking a reference (`Service.Revoke`) removes its record outright, matching Q7's "revoking removes it and its derived features" literally: there is no soft-delete or revoked-but-kept state to reason about once later phases start deriving features from a reference. Character ids are opaque strings this package never validates against the Story Bible; a character deleted or merged away there leaves any reference approved under its old id exactly as it was; only an explicit Revoke removes it (phase 3's own scope: "opaque character ids"; the orphaned-character-id case the phase's scope calls out).

Because a reference names a region of the REAPER project accompanying one specific manuscript, `apps/desktop/internal/manuscript`'s `resetDerived` now also clears `character.Dir(project)`, alongside every other manuscript-derived directory it already clears (the Story Bible, Transcript Compare, findings, the analysis ledger and cache, recording coverage, stage decisions): a replaced manuscript's characters are not the ones a stale reference was approved against.

Plain narration is approved the same way as any character, under the reserved id `character.NarrationCharacterID = "narration"` (Q9), a plain string like any other character id and never a Story Bible entity id (those are content hashes).

## Consequences

- Phase 4/5 work (feature extraction, baselines, findings) has a stable, tested `References()` call to read approved and up-to-date reference clips from, with "changed since approval" already computed rather than something each later phase would have to reinvent.
- No bindings exist yet (Phase 3's own scope: "No bindings if it can be exercised through tests until phase 6"), so this ADR covers no wire contract and bumps no host API version; Phase 6 will add both when the character review UI needs them.
- A region renamed, moved or deleted in REAPER after approval never silently changes what a future baseline reads from: the narrator must re-approve, which is a deliberate, visible action (`Approve` on the same character and region id refreshes the snapshot and clears `ChangedSinceApproval` in place, rather than creating a duplicate reference).
- Extending region identity to a live Lua bridge command (Q3, option B) or resolving a region's underlying audio source (needed once Phase 4 locates candidate audio) are open follow-ups, not covered here; a future ADR should record whichever is adopted if it changes this one's assumptions.
- This ADR does not cover Phase 2 (stable character ids, dialogue cues, appearance maps): that phase's core work is rules-based extraction inside `sidecars/manuscript-guide/core/manuscript_guide.py`, which is outside this stream's lane (`docs/prds/implementation-plan.md` §8's lane table assigns `sidecars/**` to lane B); it was intentionally left undelivered here rather than guessed at, and is noted separately on `#509`.
