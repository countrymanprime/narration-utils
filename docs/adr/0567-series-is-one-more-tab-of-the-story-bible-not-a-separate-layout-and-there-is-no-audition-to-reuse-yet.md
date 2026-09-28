# 0567. Series is one more tab of the Story Bible, not a separate layout, and there is no audition to reuse yet

**Status:** Accepted
**Date:** 2026-09-28

## Context

D79 on #509 settled that the Series view has no nav entry of its own; it is "a tab in the Story Bible". `docs/prds/mockups/character-continuity-review/06-series-voice-bible-concept.webp` is a concept mock (owner-approved as the build spec, D69) with its own dedicated two-pane layout (a "Series voices" list, a character detail with audition controls) that does not resemble the Story Bible's existing category-tab-plus-entity-detail layout at all. The PRD's own phase scope says Phase 11 "reuses Phase 6's reference-versus-candidate audition component (`VoiceReferencesSection.tsx`)" - but Phase 6's delivered note (D87) records that no audition component was built: `VoiceReferencesSection` is the approve/revoke reference-clip list, and no binding plays audio in-app at all yet.

## Decision

- **"Series" is one more entry in the Story Bible's existing category `TabList`** (`Guide.tsx`, alongside All/Character/Location/...), not a new page or a second layout. Selecting it swaps the whole content area (the category table and entity detail) for the `SeriesTab` component, rather than adding a third column or a nested tab structure. This is a deliberate, documented departure from the concept mock's own two-pane arrangement (D68: a concept mock never blocks; build against the recommended concept and pivot later), traded for reusing the Story Bible's own established navigation instead of inventing a second one, matching D79's "it's a tab" wording literally.
- **The "reuse" from Phase 6 is `VoiceReferencesSection`'s clip-formatting, not a component instance.** `formatRegionTime` (mm:ss) is exported from `VoiceReferencesSection.tsx` and imported by `SeriesTab.tsx`, so a clip's time range reads identically in both places. `SeriesTab` does not render `VoiceReferencesSection` itself: that component is single-character, editable (approve/revoke) and fetches its own single-project data, none of which fits a read-mostly, cross-book, multi-character list. There is no audition to reuse because Phase 6 never built one (D87) and this phase adds no audio playback either - a clip's "Play" affordance is out of scope here for the same reason `VoiceReferencesSection`'s already is.
- **Per-book drift evidence is left out of the UI entirely**, not stubbed or greyed out: Phase 10 is benched and has no data (ADR 0565), so there is nothing to show a placeholder for.

## Consequences

- A narrator who has seen the concept mock will find the shipped tab visually plainer (card rows instead of the mock's audition rail and voice-note panel); the PR's Mockup check records this difference explicitly rather than claiming a pixel match.
- If Phase 6's audition component is ever built (unbenching the acoustic engine, or narrator audio playback landing independently), the Series tab is the natural second consumer - `SeriesTab`'s clip rows are already the right shape (`id`, `regionGuid`, `projectPath`) to hand to it.
