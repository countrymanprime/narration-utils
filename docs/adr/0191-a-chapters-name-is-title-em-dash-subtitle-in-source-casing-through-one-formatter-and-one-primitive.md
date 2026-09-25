# 0191. A chapter's name is "Title — Subtitle" in source casing, through one formatter and one primitive

- **Status:** Accepted
- **Date:** 2026-09-24

## Context and problem

[Chapter Title Display Consistency](../prds/chapter-title-display-consistency.prd.md): the owner reported the same
chapter name drawn at least five different ways across the app — `Title: Subtitle`, `TITLE SUBTITLE` in CSS capitals
with no separator, `Title — Subtitle` in three different styles, a stacked title/subtitle with no separator at all,
and the title alone with the subtitle silently dropped. About 30 call sites built the name inline, each with its own
separator, casing and font choices; nothing recorded a rule.

## Decision drivers

- The owner reported the same chapter name drawn at least five different ways across the app.
- About 30 call sites built the name inline, each with its own separator, casing and font choices, and nothing recorded a rule.
- A visual rule is checked in the component atlas (`design-spec-guard`).

## Considered options

1. One rule, "Title — Subtitle" in source casing, through one formatter and one primitive
2. Keep the status quo: each call site builds the name inline with its own separator, casing and fonts

## Decision outcome

**Chosen option: one rule, "Title — Subtitle" in source casing, through one formatter and one primitive**, because the same chapter name was drawn at least five different ways across about 30 call sites, with no recorded rule.

- **One separator, one casing rule, one set of styles:** a chapter's name is `Title — Subtitle` (a plain space, the
  em dash U+2014, a plain space), in the source's own casing — never CSS `uppercase`, never italic, never monospace.
  The title is semibold; the subtitle is `--text-muted` and regular, in the same font family as its context (a
  Barlow card heading stays Barlow, a Plex Sans table row stays Plex Sans). With no subtitle, the title alone, no
  dangling separator. A title that already ends in a separator character (`:`, `—`, `–`, `-`) has it stripped before
  the dash is appended, so a name never reads "CHAPTER ONE: — Subtitle".
- **One formatter, `apps/ui/src/chapterName.ts`,** turns `{ title, subtitle }` into plain text: `full` ("Title —
  Subtitle" or the title alone), `short` (the title alone, for a control inside a row that already shows the full
  name), and `context(prefix)` ("Prefix: Title — Subtitle"). It also reads a legacy title that still holds its
  subtitle after a literal `"\n"` (three Go/Python helpers used to join these with `": "`), the same way the
  importers' `headingParts` splits a heading.
- **One component, `primitives/TitleSubtitle.tsx`,** draws it as markup: `inline` (one run, a non-breaking space
  before the dash so it cannot be orphaned at a line wrap) or `stacked` (the title over a muted subtitle line, with a
  visually hidden dash between them so both layouts compute the same accessible name). It is a primitive, not a
  Manuscript-only component, because the rule is visual and the component atlas (`design-spec-guard`) is where a
  visual rule is checked — a book title or an import-section name can use it too.
- **The separator is written as a bare text node between the title and subtitle elements, never nested inside either
  one and never wrapped in a span of its own.** The browser's accessible-name algorithm computes each *element*
  child's own name, trims its leading/trailing whitespace, and concatenates the results with no separator re-inserted
  at the join. A dash (or a dash-and-spaces) living inside the title or subtitle element — or inside its own
  `<span>`, even `sr-only` — loses its surrounding spaces there, so the *visible* text still reads "Title — Subtitle"
  (plain `textContent` shows it) while the *accessible name computed in context* (inside a button, as every real call
  site wraps it) silently reads "Chapter 2— The Pool of Tears". This was caught only once the primitive was used
  inside an interactive element (`ReaderCard`'s toggle button, ADR 0190) — every one of its own unit tests up to then
  checked raw `textContent`, not a name computed by `getByRole`. `TitleSubtitle.test.tsx` now pins the accessible name
  computed inside a `<button>`, for both layouts, so a future refactor cannot reintroduce this silently.
- **A source-scan guard, `apps/ui/src/chapterNameFormatting.test.ts`** (in the style of `rawNatives.test.ts`, ADR
  0053), ratchets down every other read of `.subtitle` inside JSX or a template literal under `src/components/**`. A
  prop handoff to `TitleSubtitle`/`chapterName()` (`subtitle={chapter.subtitle}`) still counts as one read and is
  expected to stay non-zero forever at that site; what the ratchet catches is a *second*, ad hoc formatting of the
  name bypassing the shared formatter and component.

### Consequences

- **Good:** Every migrated screen (so far: the Manuscript chapter and credits cards, the Chapters & Search rows, the import
  review's section rows) shows and speaks the same name for the same chapter, in the source's own casing.
- **Neutral:** A future site that draws a chapter's name must go through `chapterName()`/`TitleSubtitle`, or add itself to the
  guard's allow-list with a reason (deciding which subtitle survives an import choice, matching a tracked word span —
  not a display site).
- **Neutral:** The "separator as a bare text node" rule is now load-bearing for accessibility, not just a styling nicety: a
  reviewer touching `TitleSubtitle.tsx` who reaches for a wrapping `<span>` around the dash, even for `sr-only`
  visibility in the stacked layout, will reintroduce a swallowed separator — test the accessible name in context, not
  only `textContent`.
- **Neutral:** Spoken and matched text are unaffected: the credits chapter announcement is the narrator's own template (ADR 0151),
  and the chapter matchers still compare on `title` alone. Only what is shown and read changes.

### Confirmation

`TitleSubtitle.test.tsx` pins the accessible name computed inside a `<button>` for both layouts, and the source-scan guard `apps/ui/src/chapterNameFormatting.test.ts` ratchets down every other read of `.subtitle` under `src/components/**`.
