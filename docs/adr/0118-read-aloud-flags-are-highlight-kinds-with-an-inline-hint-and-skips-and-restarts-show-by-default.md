# 0118. Read-aloud flags are Highlight kinds with an inline hint, and skips and restarts show by default

**Status:** Proposed
**Date:** 2026-09-23
**Amends:** [ADR 0016](0016-highlight-primitive.md) (`Highlight` also draws the read-aloud flags, a second vocabulary beside the entry categories)

## Context

`docs/prds/teleprompter-manuscript-integration.prd.md` Phase 7 draws the sidecar's suspected flags
([ADR 0115](0115-live-flags-are-suspected-judged-per-closed-segment-and-forgive-what-transcript-compare-forgives.md)) in the
read-aloud dialog: a misread as a wavy underline, extra words heard as a caret between words, skipped words as the dotted
underline the reader already draws, "through `Highlight` or a documented equivalent" (ADR 0016/0017), in Transcript Compare's
colours for the same kinds, each a control that shows what was heard as a hint (ADR 0049) and opens a review panel, on top of
Phase 5's mark model ([ADR 0116](0116-read-aloud-marks-cover-whole-words-the-innermost-is-the-control-and-a-mark-never-seeks.md)).
It also leaves two design points to this phase: whether the paragraph being read gets a background tint (against
[ADR 0024](0024-teleprompter-highlight-follows-the-sidecars-spans.md)'s `Cursor`-only choice), and which kinds show by default
now that Phase 6 measured them. The owner decided the defaults on 2026-09-23, after Phase 6 measured `misread` at 2.07 false
flags per 100 heard words on synthetic speech against a target of at most 1: skipped and restart on, misread and extra behind
toggles. That revises the earlier "skipped and misread on" row of the PRD's Decisions Log.

[ADR 0063](0063-the-proofing-diff-marks-its-own-words-and-adr-0016-covers-entry-highlights.md) read ADR 0016 as covering entry
highlights and kept the proofing diff's own `<mark>` outside it; its first alternative was to give `Highlight` a second
vocabulary. A flag is not an entry, but unlike the diff words it is interactive, it layers over entity and note marks, and it
travels the reader's mark path, which is built on `Highlight`.

## Decision

1. **`Highlight` gains four kinds: `Misread`, `Extra`, `Skipped`, `Restart`.** They are decorations only, never a tint or a
   text colour, so the words keep the text colour's contrast and a flag over a Story Bible name still shows the name's tint:
   `Misread` a wavy underline in `--danger` and `Skipped` a dotted underline in `--warn` (Transcript Compare's `KIND_STYLES`
   for the same kinds, the pure status colour as the 3:1 non-text mark; `Skipped` is exactly the reader's skip-ahead
   underline, so the two coincide), `Extra` an insertion bar in `--info` before the word the extra words came before, and
   `Restart` (no Transcript Compare kind) a dashed underline in `--accent`, the colour of the reading position it sent back.
   `highlightKind` never returns them. `Highlight` also takes an optional `label` and `description` (the accessible name and
   description of an activatable mark), which a flag uses to say what was heard to a screen reader. The proofing diff stays
   outside `Highlight` as ADR 0063 decided; this amends ADR 0016 only to say `Highlight` also draws the read-aloud flags.
2. **`TooltipTarget` gains an inline mode** (`inline`), the one the component accessibility work deferred to this phase: the
   trigger is an inline box instead of an inline-flex one, so a mark that wraps keeps flowing with its line. A flag that is
   the control (the innermost mark, ADR 0116) is wrapped in it with the same text as its description; the hint is hoverable,
   persistent and closes on Escape as every hint does (ADR 0049).
3. **Flags are reader marks.** A flag becomes a `ReaderMark` (`readerFlags.ts`, beside `readerModel.ts`, not a fork of it) on
   the rows it falls in, merged with the story bible and note marks per row so an untouched row keeps its memoized array. An
   extra, zero-width in the sidecar's numbering, is marked on the word it came before (the last word when it came after the
   end). A restart is marked on the word the narrator went back to only: a re-read runs a sentence or two, a mark never seeks
   (ADR 0116), and marking all of it would take "Go back to here" away from every word it covers. The same problem raised
   twice (a misread repeated the same way after going back) is one flag.
4. **Defaults: skipped and restart on, misread and extra off,** as the owner decided; the narrator turns each kind on or off
   in the rail's Flags tab, a per-viewer preference kept in browser storage like the rail itself. A dismissed flag leaves the
   text and stays in the tab's list, marked dismissed. "Punch from here" is shown disabled with its reason until Phase 12.
5. **No paragraph tint.** The row being read gets no background: ADR 0024's `Cursor` fill stays the only position marker. A
   tint would sit under the entity, note and flag marks and lower their contrast, and the dimmed read words already show
   where in the paragraph the narrator is.

## Consequences

- A new flag colour or decoration is one edit in `Highlight.tsx`, and the atlas's `Highlight` stories show all four kinds and
  a flag inside a name; the palette guard is unaffected because no new token or text colour is introduced.
- `Highlight` now knows two vocabularies. If the owner later takes ADR 0063's first alternative for the proofing diff, the
  flag kinds are the precedent.
- Misreads and extras are off until a measurement meets the target (human microphone readings are still owed, PRD Phase 6);
  turning one on by default is a change to decision 4 only.
- Restarts show as a single marked word; the whole re-read is in the Flags tab and in the kept finding (ADR 0117).
