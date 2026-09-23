# 0116. Read-aloud marks cover whole words, the innermost is the control, and a mark never seeks

**Status:** Proposed
**Date:** 2026-09-23

## Context

`docs/prds/teleprompter-manuscript-integration.prd.md` Phase 5 puts the Story Bible and note marks of the Manuscript reader
into the read-aloud dialog, opening in a side rail (Key, Notes, Story bible), and requires that clicking a mark never moves
the cursor or the scroll. The Manuscript reader (`ParagraphView`) annotates by character offsets and splits text wherever
an annotation starts or ends; the read-aloud reader (`ReaderText`) renders whitespace tokens, because the tracker's
position and Phase 4's click-to-seek are per word ([ADR 0024](0024-teleprompter-highlight-follows-the-sidecars-spans.md),
[ADR 0104](0104-seek-reaches-a-running-teleprompter-session-through-a-tailed-control-file.md)). So the phase has to decide
how a character range becomes words, what a click on a marked word does when every word is already a seek button, and
what to do when marks overlap: `ParagraphView` nests one `role="button"` mark inside another, which axe reports as
`nested-interactive` (the open #155, carried as debt in `apps/ui/tests/visual/axe-debt.ts`, which may not grow).

## Decision

1. A mark covers every word its character range touches (`readerModel.marksOnWords`, over `wordOffsets`, the same words
   `splitWords` finds): a name across a word boundary ("Mr. Hale") marks both words, a mention inside a word ("Hale" in
   "Hale's") marks the whole word, and a range of only whitespace marks nothing. The mentions and note anchors come from
   the helpers `ParagraphView` uses, moved to `apps/ui/src/components/manuscript/annotations.ts`, so both readers find
   the same names and re-locate a drifted note the same way. Formatting spans stay out of the read-aloud reader.
2. A row's word marks are split into segments at every mark boundary (`segmentWords`), longer marks outside. In each
   segment only the innermost mark is a control (`Highlight` with `onActivate`); the marks around it are drawn through
   `Highlight` without being buttons. An outer mark is still a control on its own words outside the overlap, and every
   entry is listed in the rail, so none becomes unreachable. The gap after a segment stays inside the marks that carry on
   into the next one, so a tint is unbroken.
3. A marked word is not a seek button: the mark is the one control over its words, and opening it only changes the rail
   (tab and selection). It never calls the seek, never changes `cursor` or `follow` (the only inputs to `ReaderText`'s
   scroll), and never moves focus. Words outside marks keep Phase 4's "Start here" / "Go back to here".
4. Marks use existing `Highlight` kinds only (an entity's category colour, `Note`), and no CSS of their own shadowing it
   ([ADR 0016](0016-highlight-primitive.md), [ADR 0017](0017-no-legacy-css-shadowing-tailwind.md)). Mark
   targets are a union (`ReaderMarkTarget`) carried generically (`TextMark<T>`, `WordMark<T>`), so Phase 7's flag marks
   join the same path.
5. The rail's open state and tab are per-viewer layout, kept in browser storage under `narration.readAloud.rail` with every
   access guarded and a default when it fails (the PRD's Decisions Log, owner decision 2026-09-23). The selection is not
   kept.

## Consequences

- The read-aloud reader has no nested controls and adds no axe debt; the Manuscript reader still nests (#155) and could
  adopt the same rule, which is that issue's design decision to make, not this one's.
- A word inside a mark cannot be clicked to seek; the narrator seeks from a neighbouring word. A mention inside a longer
  word tints the whole word, a coarser picture than the Manuscript reader's.
- A mark opened while the rail is hidden shows the rail again, which narrows the text column (the one reflow a mark can
  cause); with the rail open, nothing about the text changes.
- Changing what a mark click does, letting marks nest as controls, or moving the rail preferences to settings needs a new
  ADR that supersedes this one.
