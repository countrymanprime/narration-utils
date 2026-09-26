# 0261. The read-aloud heading and every context-prefixed chapter name follow the same rule

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:** the "Read aloud — {title}" dialog title this repo shipped before this ADR, including the
"Read aloud — Opening credits"/"Read aloud — Closing credits" titles ADR 0260 recorded for the credits' read-aloud
mode; those still stand as ADR 0260 described them in every other respect (no resume card, no kept findings).

## Context

[Chapter Title Display Consistency](../prds/chapter-title-display-consistency.prd.md) Phase 1 and 2 (ADR 0191) fixed
the rule, the formatter and the primitive for a chapter's name where it stands alone: `Title — Subtitle`, source
casing, no CSS capitals. Phase 3 is "the owner's second complaint the rule didn't yet reach": the read-aloud dialog's
own title dropped the subtitle entirely ("Read aloud — {title}", never showing what came after), the reading heading
inside the dialog forced the chapter's name into CSS capitals even when the book's own heading was mixed case, and a
handful of context-prefixed titles elsewhere in the app ("Recording check: …", "Stage suggestion: …") already used
`chapterName`'s separator character for two different jobs — a name's own em dash and a context prefix's colon could
otherwise collide inside one string ("Read aloud — PROLOGUE — The Last Good Applause" reads as three parts, not two).

This also directly affects [Manuscript Credits Card Parity](../prds/manuscript-credits-card-parity.prd.md) Phase 2 (ADR 0260,
built in the same lane immediately before this phase): its read-aloud dialog titles ("Read aloud — Opening credits",
"Read aloud — Chapter 1") used the pre-Phase-3 format and dropped the chapter's subtitle the same way row 10 of this
PRD's own inventory found. Both PRDs are owned by the same stream here, so this ADR is where they agree, per the
note in chapter-title-display-consistency.prd.md's own compatibility table ("this changes the dialog name Manuscript
Credits Card Parity expects... so the two PRDs must agree").

## Decision

- **A context prefix is `Prefix: ` (colon, one space), never an em dash.** `chapterName(chapter, context(prefix))`
  gives `"Prefix: Title — Subtitle"` — the colon always means "what follows names something," the em dash always
  means "a subtitle follows." `ReadAloudDialog.tsx`'s title becomes `chapterName(source.kind === 'chapter' ?
  source.chapter : { title: CREDITS_LABEL[source.credits] }, context('Read aloud'))`: "Read aloud: Chapter 1 — Down
  the Rabbit-Hole" for a chapter, "Read aloud: Opening credits" for the credits (no subtitle to show). This
  supersedes ADR 0260's title text; ADR 0260's other decisions (no resume card, flags shown but never kept) are
  unchanged. `RecordingCheck.tsx`'s "Recording check: {title}" and `StageEvidence.tsx`'s "Stage suggestion: {title}"
  move onto the same helper and, doing so, stop dropping the subtitle (Q6: a dialog or slide-over title "stands
  alone," so it takes the chapter's full name, not just its title).
- **The read-aloud reading heading keeps source casing and keeps the subtitle, stacked.** `ReaderText.tsx`'s title
  row drops `uppercase` entirely — what the narrator reads is what is shown, so "A Message from the Author" no
  longer renders "A MESSAGE FROM THE AUTHOR." The subtitle renders on its own line under the title (the same
  `stacked` convention `TitleSubtitle` uses, hand-drawn here since the title itself is per-word tracked markup, not a
  plain string `TitleSubtitle` could take as a prop), with a visually hidden em dash between them so the two lines
  still compute as one accessible name. The subtitle is never part of the sidecar's tracked title span:
  `readerModel.ts`'s `buildRows`/`previewRows` carry it on `ReaderRow.subtitle`, tokenized and tracked separately
  from `ReaderRow.words` (which is the title's own words only, matching what the sidecar's title span already
  counts - Q9's premise that the sidecar was never asked to change). `ReaderText.tsx` is added to the guard's
  allow-list for this reason, the same way `TitleSubtitle.tsx` itself is.
- **The standalone Teleprompter page's chapter select uses the same plain `full` form** (`chapterName(item)`) in
  place of its own `": "`-joined label, so its picker and the read-aloud dialog agree on one chapter's name.
- **A title-only site that never read a subtitle stays title-only where nothing requires the change** (a toast, a
  Tracks row, a Story Bible evidence row): `chapterName(chapter, 'short')` and a bare `chapter.title` produce
  identical output, so routing these through the formatter is a non-behavioral consistency cleanup, not a defect,
  and is left as follow-up rather than bundled into this phase's already-large diff.

## Consequences

- The em dash and the colon each have exactly one job across the whole app: a name's own subtitle, or a context
  naming what follows it. A future site that wants to announce a chapter (a dialog title, a toast, a slide-over)
  reaches for `context(prefix)` rather than inventing a third separator.
- The read-aloud heading, the dialog title and the Teleprompter select all show a chapter's full name, including its
  subtitle, for the first time — closing the specific gap `chapter-title-display-consistency.prd.md`'s Evidence table
  named as "the subtitle drops out" (rows 9, 10 and 11).
- `manuscript-credits-card-parity.prd.md`'s own tests, aria snapshot and visual states (ADR 0260, PR built one phase
  before this one in the same lane) are updated in the same change that lands this ADR, so the two PRDs never
  disagree about what the dialog is titled at any point in git history visible to a reviewer.
- Not every title-only site in the PRD's inventory (rows 12-24) was moved onto `chapterName` in this phase; the ones
  left (Tracks tables, Settings and Review chapter selects, Story Bible evidence rows, the credits settings preview
  scope) show identical text either way, so the guard's ratchet does not require it and this ADR does not claim it
  is done. A future pass that also wants the *routing* consistency (not a visible difference) can pick them up
  without a new ADR, since the rule itself is unchanged.
