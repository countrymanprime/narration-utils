# 0640. Panel draws the mocks' card header with a divider and a padded or flush body, and the eyebrow and the inset card are primitives

**Status:** Proposed (Phase 4 of the mock fidelity PRD, stream F-P4 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:**

## Context

The owner found that the merged pages don't match the approved mocks (D91 on #509). Cards are on every page, and the mock fidelity PRD's Phase 4 gives their spec: the card header, the page title, the eyebrow label and the inset card. [ADR 0590](0590-the-mock-fidelity-token-batch-fills-badges-with-opaque-soft-tokens-and-names-the-mocks-sizes-and-type.md) added the tokens it needs (`--radius-card`, `--font-size-page-title`, `--font-size-card-title`, `--font-size-label`, `--tracking-label`).

This phase measured benchmark mock 05 again, reading each edge as a change in a column or row of pixels:

- **Card header.** "Per-file checks": the frame is at y 119 and the divider at y 169, so the row is 49 px inside the frame and 50 px with its divider. "Mastering chain" is the same (634 to 684). "04 · Why it fails" holds two buttons and is 54 px (420 to 475), 11 px above and below a 32 px button.
- **Card title.** The title's capitals are 13 px tall (y 139 to 151). Barlow Condensed's capitals are 0.7 em, so the type is 19 px. The ink starts at x 257, 17 px from the frame's outer edge at x 240 (the border and 16 px). It is centred in the row.
- **Subtitle.** Its x-height is 7 px, IBM Plex Sans at about 13 px, in `--text-muted`. It sits on the title's line, 10 px after it (12 px from ink to ink).
- **Body.** The first line of "Why it fails" starts 16 px below the divider and 16 px in from the frame. The delivery package's "OUTPUTS" label is 16 px in from its frame too.
- **Page title.** "Master & QC"'s capitals are 19 px tall (y 80 to 98), so the type is 26 to 27 px Barlow Condensed.
- **Eyebrow.** "OUTPUTS"'s capitals are 8 px tall, 11 px Barlow Condensed, in `--text-muted`.

The app drew the card title in IBM Plex Sans 16 px, inside the card's 17.6 px padding with no divider, and the page title at 24 px with a 14 px subtitle. It had about 25 hand-drawn copies of a card or an inset card, and 15 copies of the eyebrow class string beside the global `.section-label` (11.52 px, tracking 0.08 em).

## Decision

**Panel** keeps [ADR 0058](0058-heading-has-a-level-and-panel-names-its-region-with-a-level-2-title.md)'s semantics (a titled panel is a region named by its level-2 heading) and takes the mock's look, kept in `apps/ui/src/components/primitives/panelStyles.ts`:

- **Frame:** 1 px `--border`, `--radius-card` (8 px), `--shadow`, on `--surface`.
- **Header row:** at least 50 px with its 1 px `--border` divider, 16 px side padding and 11 px above and below, so a 32 px button makes it 55 px. The title is Barlow Condensed at `--font-size-card-title` (19 px), weight 600, `--text`, in sentence case.
  - An optional `subtitle` sits on the title's baseline, 10 px after it, in 13 px `--text-muted`.
  - An optional `leading` sits before the title (the Story Bible's category dot).
  - `actions` sit at the right.
- **Body:** its own box, padded 16 px (`--panel-pad`).
  - `flush` drops the padding, so a table runs to the card's edges under the divider. `Table flush` spans `--panel-pad`, which is 0 in a flush panel, so it now reads the padding instead of hard-coding it ([ADR 0605](0605-table-and-stage-grid-share-the-mocks-row-and-header-sizes-and-cells-sit-in-the-middle-of-the-row.md) expected this).
  - `scroll` makes the body scroll under a fixed header, inside a height the page gives the panel.
- **Other props:**
  - `label` names a bare panel without a visible title.
  - `tone="review"` colours the frame for a panel that needs the narrator's attention.
  - `className` is for layout only.
- **`PanelHeader`** is the header row on its own, for a card that is not a `section` of its own (a `TabPanel` drawn as a card). With `PANEL_FRAME_CLASS`, that card takes the same look without copying it.

The dark Settings mocks (delivery-platform-profiles 05 and 09, input-commands-and-pedals 01) draw a category's title differently. Its capitals are 12 px tall, so it is Barlow Condensed at 17 px, uppercase and tracked. The benchmark set has no Settings screen, so nothing there contradicts that title, and `titleStyle="caps"` draws it. The body padding is the benchmark's 16 px, not the dark set's 18 px, because the benchmark wins where both draw a thing (D92).

A subtitle keeps to the title's line and wraps inside its own box while it has 10 rem, as the 390 px Settings mock draws it. Only below that does it drop under the title.

**Heading** takes `--font-size-page-title` (26 px) and a 13 px muted subtitle. A new `icon` prop leads the title (the start-up screen's spinner), so the last raw page `h1`s become Headings.

**SectionLabel** is a new primitive for the eyebrow: Barlow Condensed at `--font-size-label` (11 px), weight 600, uppercase, `--tracking-label` (0.1 em), `--text-muted`. `as` picks the element: a heading when it names a region, a `legend` over a fieldset, a `span` by default. The global `.section-label` class draws the same thing from the same tokens, for the files later phases own. Those files are the Script page, the Master page, the Booth and the shell's nav groups (Phase 8). This phase doesn't edit them, so the class stays until they migrate.

**InsetCard** is a new primitive for a card inside a card: a 1 px border, a 6 px radius and 12 px inside it, on `--surface`. That is the panel it sits in; where it sits on the page (the Booth's resume prompt) it stays an opaque card, so its text keeps the contrast it was checked at. It has these props:

- `tone` colours the frame: `accent`, `warn` or `danger`.
- `fill` sets it on `--surface-2`.
- `dashed` marks a placeholder.
- `as` picks `div`, `section`, `li` or `p`.

It replaces the hand-drawn `rounded-md border px-3 py-2` copies. Their padding was 8 px above and below; the mock's is 12 px all round. The Booth's resume prompt is one of them: [ADR 0187](0187-the-resume-prompt-is-a-compact-notice-that-settles-once-per-dialog-open.md) made it a compact bordered notice rather than a `Panel`, and an inset card is exactly that.

A source guard (`apps/ui/src/panelCopies.test.ts`, in the pattern of `rawNatives.test.ts`) counts these per file outside the primitives:

- a card copy (`rounded-lg border`);
- an inset copy (`rounded-md border`);
- an eyebrow copy (the class string or `.section-label`);
- a raw `<h1>`.

A file's count may only go down.

## Consequences

- Every card on every page gets the mock's header, divider and body from Panel.
  - Titles move from Plex 16 px to Barlow 19 px, which is narrower, so long titles wrap later.
  - Cards with buttons in their header are 61 px tall until the Button phase brings buttons to 32 px.
- A panel's content no longer needs a top margin to clear the title. The call sites dropped theirs, except in the files later phases own:
  - `production/{ProductionPage,ChapterBoard}`;
  - `proof/{ProofPage,FindingDetail}`;
  - `master/{MasterQcPage,MasteringChain,DeliveryPackagePanel,BookConsistency}`.
  These keep a few pixels of extra space until their phase.
- Inset cards grow 8 px taller, so lists of them (take reads, chapter track candidates) are longer.
- The files other phases own keep their eyebrow and card copies, and the guard's ceilings list them. Each page phase (11 to 15) and Phase 8 lowers its own entries.
- To change a size here, change the tokens (a follow-up token batch, per [ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md)). To change anything else, write a new ADR that supersedes this one.
