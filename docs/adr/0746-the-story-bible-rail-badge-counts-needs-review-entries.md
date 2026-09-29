# 0746. The Story Bible rail badge counts Needs Review entries

**Status:** Accepted (owner ruling D99 on [#509](https://github.com/countrymanprime/narration-utils/issues/509), 2026-09-29; stream N-F1)
**Date:** 2026-09-29
**Supersedes:** the Story Bible bullet of [ADR 0725](0725-the-rail-draws-a-count-badge-only-from-a-count-the-host-reports-and-the-product-is-named-studio.md)

## Context

ADR 0725 drew the Story Bible's rail badge from the number of open pronunciation queries. The owner ruled (D99) that the badge counts the **Needs Review** items that were pulled in, not pronunciation queries, and that no series chip is drawn: series belongs to the Character Continuity page (mock 06), which needs its own PRD.

## Decision

`useNavCounts` reads `guideEntities()` (already schema-checked, with its golden) instead of `guidePronunciationQueries()`, and counts the entries whose category is `Needs Review`, the same set the Story Bible page's own "Needs Review" tab counts. The read still waits for a manuscript. A failed read, or a count of zero, draws no badge. The Proof and Pickups badges are unchanged.

## Consequences

- The badge and the Needs Review tab show one number, and it falls as the narrator sorts entries into a category.
- No new binding or wire shape: the rail's read moved to one that already had a schema and a golden.
- Open pronunciation queries no longer show on the rail; they stay on the Story Bible page's own queries list.
