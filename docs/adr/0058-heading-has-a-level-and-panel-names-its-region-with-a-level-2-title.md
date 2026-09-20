# 0058. Heading has a level, and Panel names its region with a level-2 title

**Status:** Accepted
**Date:** 2026-09-20
**Supersedes:**

## Context

Two primitives every page uses could not express structure. `Heading` always rendered an `<h1>`, so a section title could not be a heading of its own level without a hand-written tag. `Panel` was a bare `<section>`: callers wrote a title line next to it (an `<h2>` in Proofing, a `div` with `font-semibold` in Tracks and the Teleprompter), so the section had no accessible name, was not a landmark a screen reader could list, and the title was a `div` that is not a heading at all. It was the last open part of defect 7 of the retired UI defects register; `Field` was done with the Base UI stack ([ADR 0050](0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md)). The component accessibility PRD's recommendations (its questions 5 and 6) were adopted (implementation plan D22).

A story with a long unbroken subtitle, added to prove or disprove the register's claim that a long subtitle overflows, showed it did: a file name (`TracksPage` puts the selected .rpp file's name there) with no break opportunity scrolled the story 449 px sideways at the 390 px viewport.

## Decision

- **`Heading`** (`apps/ui/src/components/primitives/Heading.tsx`) takes `level` of 1, 2 or 3 (default 1). It changes the tag only: the type is the same at every level, so no page changes and a caller that needs a different size adds a `size` prop when it has a case. The subtitle wraps anywhere (`[overflow-wrap:anywhere]`), which fixes the overflow above.
- **`Panel`** (`Panel.tsx`) takes `title`. The title is a level-2 heading (a panel sits beneath the page's `<h1>`; there is no `level` prop until a panel sits under another panel), and the `<section>` is labelled by it (`aria-labelledby` from `useId`), so it is a `region` a screen reader can list and jump to. `actions` sit beside the title in the same row and the types allow them only with a title. A `Panel` with no title is the bare surface it was, with no name, and nothing about a call site without a title changed. The title wraps anywhere too.
- **Adopted at the four call sites that hand-built a title:** the chapter choice in Proofing (`Transcript.tsx`), the empty state in the Teleprompter (`TeleprompterPage.tsx`) and the two prompts in Tracks (`TracksPage.tsx`: choose a project file, no project file found). They are pixel-identical to before at every captured viewport (the Tracks states were compared byte for byte; the other two have no visual state); the one visible change is that the Proofing chapter title, which was `font-medium`, is now `font-semibold` like the others. `AudiobookEstimatePanel`'s empty state is plain text with no title, the Teleprompter's controls and reader panels have no visible title, and the Tracks player's title line is the current track's name, a value and not a section title, so those stay bare.
- **Tests.** `Heading.test.tsx` and `Panel.test.tsx` (levels, region and heading, distinct ids for two panels, actions clickable, the same surface with or without a title, no dangling id) and stories that run in the atlas (`Levels`, `LongUnbrokenSubtitle`, `TitleAndDescription`, `LongTitleWraps`); each adopted call site has a test that the region is named.

## Consequences

- The four screens above now offer a named region and a real heading to a screen reader, and a page can put a section title at the right level.
- Every titled `Panel` is a landmark. That is the point for a few named prompts, but a page that titles many panels would list many regions; a panel that should not be a landmark should stay untitled.
- The Tracks player, and any other panel whose title is data, has no name yet; naming it is a call-site decision, not a primitive change.
- `Panel` has one heading level. A panel inside a section that has its own `<h2>` would need a `level` prop, which is a new decision.
- To change any of this, write a new ADR that supersedes this one.
