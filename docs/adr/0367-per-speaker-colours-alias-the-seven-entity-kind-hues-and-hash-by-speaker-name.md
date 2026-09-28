# 0367. Per-speaker colours alias the seven entity-kind hues, and a speaker's colour is a hash of its canonical name

**Status:** Proposed
**Date:** 2026-09-28
**Supersedes:**

## Context

D85 #6 on [#509](https://github.com/countrymanprime/narration-utils/issues/509) answered the visual audit's open
question SC7: the Script reader's speaker-attribution chip and the Booth's "Voices in scene" tags should give each
speaker its own colour, as the benchmark mocks show (mock 02, mock 03), rather than the one `--character` colour every
speaker drew before this batch (`manuscript/SpeakerTag.tsx`'s and `booth/BoothView.tsx`'s own prior comments both
recorded this as a deliberate scope cut, pending "a lane-U token batch"). This is that batch (lane U, D85's own
carrier: N-U26).

Three things this phase had to decide, the same way ADR 0362 decided the meter zones and badge fills:

1. **How many colours, and which hues.** The mocks' sample speakers and names are invented (PRD Visual Spec: "Names
   and numbers are invented"), so neither their exact count nor their exact hues are a byte-for-byte spec - only that
   distinct speakers read as distinct colours.
2. **How a speaker maps to a colour**, given neither caller has a stable per-speaker id readily at hand: the Script
   reader's `speakerLabelForParagraph` (`manuscript/dialogueCues.ts`) already discards the entity id and returns only
   the resolved canonical name (a deliberate contract - see that file's own comments), and the Booth's rail iterates
   `GuideEntity` records that do carry an id, but naming a speaker consistently between the two pages matters more
   than which identifier each happens to have lying around.
3. **What happens past the last colour**, and what an unresolved speaker gets.

## Decision

**`--speaker-1` through `--speaker-7` (`apps/ui/src/styles.css`) each alias one of the seven existing entity-kind
tokens**, in this fixed order: `character`, `place`, `org`, `review`, `lore`, `item`, `event` (and their `-text`
companions the same way). Declared once, the same alias derivation ADR 0362 used for the meter zones
(`--meter-floor: var(--non-text)` and siblings): a `--speaker-N` token needs no dark-theme override of its own, and
its contrast is already proven by that kind's own `highlight-<kind>` row in `paletteContrast.test.ts` - a dedicated
`speaker-N` row is added anyway (mirroring the meter zones' own dedicated rows), so a future repoint of a kind hue is
still caught for its speaker use specifically. Reusing the kind hues, rather than inventing seven new ones, means no
second round of hand-tuning contrast in three surfaces: the app's hue wheel is already mostly spoken for by the
existing kind and status tokens (`docs/design/colour-and-contrast.md`), and ADR 0362's own rationale for aliasing
("fewer new colours to maintain") applies here just as directly.

**A speaker's colour index is `speakerColorIndex(id)` (`apps/ui/src/components/primitives/speakerColor.ts`): a
deterministic string hash of an id, taken modulo 7, plus one.** The id is whichever stable string a caller already
has - `manuscript/ParagraphView.tsx` passes the resolved canonical name (the same value `SpeakerTag` shows as its
label, since no entity id survives `speakerLabelForParagraph`), and `booth/BoothView.tsx`'s `BoothSpeakers` passes
`entity.canonical_name` too, so the same named speaker gets the same colour on both pages without either page needing
a change to what it already threads through. **An eighth or later distinct speaker wraps back to `--speaker-1`**,
which is the `--character` alias - the app's own single colour for every speaker before this batch - so the wrap and
"no id at all" (`speakerColorIndex(undefined)` also returns 1) resolve to the same, already-familiar tone rather than
a second special case.

**Two call sites, one derivation, no visual-language duplication.** `primitives/SpeakerTag.tsx` (new) is the Script
reader's chip - a small pill, promoted out of `manuscript/SpeakerTag.tsx` (deleted) since it is now shared - reading
`speakerColorToken(id)` for its own tint and text colour. `primitives/Highlight.tsx` gained an optional `colorToken`
prop instead of a second chip component for the Booth: `BoothSpeakers` already rendered each character as a
`Highlight kind="Character"`, and the mock's boxed "Voices in scene" tags are the same tint-and-underline mark
`Highlight` already draws for a Character mention elsewhere in the app - only the Booth needed that mark to use a
speaker's own colour instead of always `--character`. `colorToken` overrides `TOKEN[kind]`/`TEXT_TOKEN[kind]` in
`highlightStyle` while leaving `data-highlight` and every existing behaviour (activation, keyboard, `aria-label`)
untouched, so `BoothView.test.tsx`'s and `BoothSession.test.tsx`'s existing assertions on `[data-highlight="Character"]`
keep passing unchanged.

## Consequences

- **Fewer new colours to maintain**, per ADR 0362's own precedent: a speaker token costs nothing to keep in sync with
  its aliased kind, because it is the same value, not a copy of it.
- **A speaker's colour can coincide with an entity-kind mark's colour nearby** (a speaker hashed to `--speaker-2`
  reads in the same blue as a Place mention). Given the alternative (inventing new hues) would have cost a second
  contrast-tuning pass across three surfaces for marginal extra distinction, and the mocks' own colours are
  themselves invented sample data, this is accepted rather than solved here. If it proves confusing in practice, a
  follow-up ADR in this block can give speakers their own hues instead of aliasing the kinds.
- **Hashing by name, not by a persistent entity id, is a known limitation**: two different speakers who happen to
  share a display name (unlikely, but possible with an unresolved or a corrected cue) would draw identically, and
  renaming a Story Bible entity would change its speaker colour. Fixing this needs the entity id to survive
  `speakerLabelForParagraph`'s return value, which is prep-depth's / character-continuity's own contract to change,
  not a lane-U token-batch concern; this ADR's derivation (`speakerColorIndex(id: string | undefined)`) accepts
  either an id or a name unchanged, so that swap needs no change here when it happens.
- **Changing this decision.** To use different hues, hash a different identifier, or change the wrap-around colour,
  write a new ADR in lane U's block (0360-0379) that supersedes this one, and re-run `paletteContrast.test.ts` (it
  fails loudly if a new value does not hold 4.5:1/3:1 in both themes) and `speakerColor.test.ts`.
