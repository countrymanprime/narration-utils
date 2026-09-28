# 0600. Every pill, tag and status dot is one badge primitive, with a pill, a tag and a booth shape

**Status:** Proposed (Phase 2 of the [mock fidelity PRD](../prds/mock-fidelity-primitives-and-components.prd.md), stream F-P2 on [#509](https://github.com/countrymanprime/narration-utils/issues/509); its sentence-case pill label departs from the PRD's spec table on measurement, for the owner to confirm on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-28
**Amends:** [ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md)'s StatusBadge tone set (Q6), which gains `accent` and `org`

## Context

The owner found the Production page's pills aren't uniform (D91 on #509). The app drew a pill in at least a dozen places: `StatusBadge`, a copy of its class string in `EntitySummary` (reused by the Story Bible's category menu), the Keyboard panel's "Changed", the stage suggestion and summary chips (Buttons recoloured through `style`), the Script card's "Retail sample", Proof's extra-word chip, the Script key's speaker tag, and nine hand-drawn status dots. Each chose its own height (18 to 28 px), padding, radius, size and case.

The benchmark mocks (`docs/research/mockups/audiobook-studio-benchmark/`, D92) were measured again for this phase, sampling the 1440 px WebP frames (good to about ±1 px at an edge):

| Shape | Where (mock) | Height | Radius | Side padding | Label |
| --- | --- | --- | --- | --- | --- |
| Pill | Proof resolution "Pickup" (04), notes summary "6 need pickup" (04), "On track" (01), Script status "Researched" (02) | 22 | full | 10 | Barlow Condensed 600, ≈11.5 px, **in the label's own case**, tracking ≈0.06 em |
| Tag | Proof type MISREAD/PACING (04), Script speaker NARR/QUEEN (02) | 15–16 | ≈3 | 6–7 | Barlow Condensed 600, 11 px, capitals, tracking ≈0.06 em |
| Booth tag | Booth speaker NARRATOR (03) | 26 | ≈4 | 8 | Barlow Condensed 600, ≈12 px, capitals |
| Dot | "On track" (01), legends (04) | 7–8 | full | – | – |

The PRD's spec table says the pill label is uppercase. It isn't in any benchmark mock: every pill reads "Pickup", "Edit · de-click", "6 need pickup", "Query sent", "My reference", "On track · at current pace done Oct 9". Only tags are capitals.

## Decision

1. **One badge.** `primitives/StatusBadge.tsx` holds the shape once and exports it three ways: `StatusBadge` (a closed tone), `Badge` (a caller's own colours: an entity kind, a speaker) and `Dot` (a status dot, decorative without a `label`, a named `role="img"` mark with one). `SpeakerTag` draws with its `badgeClass`, and a caller that must put the look on another element (the Story Bible's category `Menu` trigger) uses `badgeClass`/`badgeStyle`. No page pastes the classes.
2. **Shapes.** `shape: 'pill' | 'tag' | 'booth'`, at the measured sizes above. Pills keep the label's case; tags are capitals. `SpeakerTag` takes `size="booth"` for the Booth's script gutter.
3. **Looks.** `look: 'soft' | 'outline'`. Soft fills with the tone's opaque `--<tone>-soft` token ([ADR 0590](0590-the-mock-fidelity-token-batch-fills-badges-with-opaque-soft-tokens-and-names-the-mocks-sizes-and-type.md)). Outline is hollow in the tone's line colour, the dark sets' "TO VERIFY" and "CHANGED". Both carry a 1 px border (transparent when soft), so the two looks are one size.
4. **Tones.** `accent` (the proofer, a query, "Author ✓") and `org` (PACING) join the set. `progress` stays as the meaning a chapter status maps to; it draws like `accent`.
5. **A chip that opens something is a badge.** `onClick` makes it a `<button>` in the same shape (the Production board's stage suggestion chips), not a restyled `Button`.
6. **Height is a minimum.** `min-h`, not `h`: a long label wraps rather than pushing a row sideways at a narrow width.
7. **A guard.** `src/badgeShapes.test.ts` counts, per file outside the primitives, the class strings a pasted chip, tag or dot leaves behind. The allowances left are the page-component copies the PRD gives to Phases 8, 12, 13 and 14, and the script mark's tag, which is CSS generated content by design (ADR 0382). An allowance only shrinks.
8. **Retired tokens.** StatusBadge was the last user of `--badge-ok-fill`, `--badge-warn-fill` and `--badge-info-fill`, so they are deleted, as ADR 0590 asks. `--badge-danger-fill` stays for ReadingControlBar (Phase 13) and `--badge-experimental-fill` for the experimental tone, which has no soft token.

## Consequences

- Every status pill in the app is 22 px, fully rounded and sentence-cased, so labels such as "Coming soon", "Key saved" and "Changed" are no longer drawn in capitals. A caller that wants capitals asks for a tag.
- `Pill`, the toggle chip inside `ToggleGroup`, is not a badge and keeps its shape here: the one toggle group the benchmark mocks draw is mock 05's segmented platform switch (ADR 0440), rectangular and in capitals, which is Phase 5's segmented look. Drawing it as a status pill would move it away from the mock.
- The Booth's speaker tag is larger (26 px), as mock 03 draws it.
- A new pill, tag or dot outside the primitives fails `badgeShapes.test.ts`.
