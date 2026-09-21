# Palette Contrast to WCAG AA

**Supersedes:** `docs/design/known-ui-defects.md` (defect 1 [medium, a design decision]; the file's last revision is `b613933`, recover it with `git show b613933:docs/design/known-ui-defects.md`)

**Source:** owner decision D5 of the [implementation plan](implementation-plan.md) (option B for the text ramp, colour-mix option A for highlight and badge text), delivered as stack S12a, tracking issue #123.

## Problem Statement

The design tokens for secondary text (`--text-faint`, `--text-muted` on the darker surfaces), the active navigation item, and the `Highlight` category colours fall below WCAG AA 4.5:1, in the light theme and, for three category colours, badly in the dark theme. Narrators with low vision or in bright rooms cannot reliably read section labels, helper text, the active nav item or highlighted entities, and the failing pairs are hidden behind four ratcheted entries in `tests/atlas/a11y-debt.ts`. Fixing it is a palette decision, not a bug fix: darkening the tokens naively collapses the faint/muted hierarchy, so it needs the user to choose a strategy first.

## Evidence

Ratios computed with a one-off WCAG 2.x script over the values in `apps/ui/src/styles.css` at `b9d348d` (script kept in the session scratchpad, not in the repo; the fix phase should add a permanent test). Re-checked at `d5cc994` (main after #42): `styles.css`, the four primitives and `tests/atlas/a11y-debt.ts` are unchanged, so the numbers stand.

**Reproduce (from the retired defects register):** run `pnpm --dir apps/ui atlas` with the four entries in `tests/atlas/a11y-debt.ts` removed; axe reports `color-contrast` for `Primitives/WorkDialog`, `MeterBar`, `NavButton` and `Highlight`. The `WorkDialog` and `MeterBar` entries share one reason (`TOKEN_CONTRAST`, the faint/muted text ramp); `NavButton` is `ACCENT_ON_TINT`; `Highlight` is `HIGHLIGHT_CONTRAST`. The register's "caught by" note: the atlas fails on any new violation and the debt list cannot grow (`src/atlasCoverage.test.ts`), so nothing regresses silently while the decision is pending. `row-alt` is `--row-alt` (94% surface + 6% text). Highlight tint is `color-mix(category 20%, transparent)` over the row background.

**Text ramp** (bg / surface / surface-2 / surface-3):

| Token | Light | Dark |
| --- | --- | --- |
| `--text` | 14.47 / 16.63 / 13.09 / 11.68 | 15.58 / 14.39 / 12.92 / 11.11 |
| `--text-muted` | 4.77 / 5.49 / **4.32** / **3.85** | 7.74 / 7.15 / 6.42 / 5.52 |
| `--text-faint` | **2.77 / 3.19 / 2.51 / 2.24** | **3.69 / 3.41 / 3.06 / 2.63** |

**Active nav** (accent text on `color-mix(accent 10%, surface)`): light accent 4.03 (fails), `--accent-strong` 5.67; dark accent 5.70 (passes), accent-strong 7.18. The same copy-pasted class is in `Settings.tsx:159` (category rail), not only `NavButton.tsx`.

**Highlight text** (category colour on its own 20% tint; over surface / over row-alt):

| Kind | Light | Dark |
| --- | --- | --- |
| Character | 3.90 / 3.52 | 4.54 / 3.90 |
| Place | 4.02 / 3.62 | 4.44 / 3.81 |
| Organization | 4.04 / 3.64 | 4.43 / 3.80 |
| Review | 4.01 / 3.61 | 4.16 / 3.58 |
| Lore | 3.60 / 3.25 | **2.93 / 2.53** |
| Item | 3.90 / 3.51 | **2.74 / 2.37** |
| Event | 4.31 / 3.88 | **2.48 / 2.16** |
| Note | text inherits `--text`: 12.79 / 11.54 | 11.62 / 10.07 |

**Findings the old defects register did not have:**
- `--lore`, `--item`, `--event`, `--note` are defined once, in an unlayered `:root` block at the bottom of `styles.css`, with **no dark override**, so dark mode reuses the light hexes. Dark Highlight for Lore/Item/Event is 2.2-2.9:1, well below the register's "3.2-3.8". The atlas debt entry masks it. As non-text (the 1.5px underline, category dots), dark Event is 2.96:1 against `--surface` (3:1 needed); dark Lore 3.65, Item 3.34.
- The category colours are **user-configurable**: `App.tsx` (~line 118) and `Settings.tsx` (~line 65) write `color_character`/`color_location`/`color_organization`/`color_lore`/`color_item`/`color_event`/`color_needs_review`/`color_note` settings as inline styles on `<html>`, which beat both theme blocks. `config/defaults.json` ships only `color_note` (`B85C1E`). Any fix that hardcodes a per-category text colour is bypassed by a user override.
- Entity **badges** (`BADGE_STYLE` in `EntitySummary.tsx`: category colour on `-soft` tint or an 18% mix) fail too: light 3.70-4.44, dark Lore/Item/Event 3.00/2.80/2.53. No story covers them, so axe never sees them.
- `--warn` used as text (`Settings.tsx:322`; `Results.tsx:142` on an 18% warn tint; `InlineDiffRow.tsx` `SKIPPED` colour is probably text too, TBD verify; `ChapterNav` uses it as a fill, which is a non-text 3:1 question): light 3.26 on surface and 2.70 on its own tint. Also unmeasured by the atlas.
- Passing but tight: primary button `--accent-contrast` on `--accent` 4.58 light; the "Reset" link accent on surface 4.58.
- Axe runs only on stories, not app states (the retired register's tooling limits; now in `test-flakiness-and-visual-suite-stability.prd.md`), so page-level pairs are checked only by eye today.
- The retired register's numbers verified: faint 2.2-3.2 light and 2.6-3.7 dark, muted on surface-2 4.32 and surface-3 3.85, active nav 4.03. Its Highlight range (3.2-3.8) matches the light theme only.
- Blast radius of the ramp: `--text-faint` is referenced 73 times across 23 files and `--text-muted` 116 times (113 in `.tsx`). Darkening `--text-muted` reaches its 116 uses without editing them, but option B (chosen, D5) retires `--text-faint` as text, so its 73 uses are edited: each is triaged into text (moves to `--text-muted`) or decoration (moves to the new non-text token).
- **What the guard test found (Phase 1).** Declaring every pair the source draws, and measuring each over every surface it can sit on, listed 26 failing pairs, more than the four debt entries: the four entries' pairs, plus entity badges (all seven kinds in light; Lore, Item and Event in dark), the warn text (3.26:1, and 2.70 on its 18% tint), `--danger` on `--surface-2` (4.20) and on `--review-soft` (4.16), `--review` on `--review-soft`, and `--info` on `--place-soft`. `Results.tsx` also draws a Tailwind palette colour (`text-red-400`) instead of a token. Phases 4 and 5 cover them. The Settings category tabs already use `--accent-strong` (ADR 0054), so `NavButton` is the only active-navigation fix left.
- Recorded constraints: ADR 0010 (dark values live only in `:root[data-theme='dark']`; tokens consumed via `var(--x)`), ADR 0016 (entities tint text in the kind colour; notes keep the text colour; tint mixes with `transparent`), ADR 0023 (contrast was deliberately ratcheted as reasoned debt rather than silently recoloured; the four entries are the ones to delete).

## Proposed Solution

Decide the palette in an ADR first ([ADR 0059](../adr/0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md)), then land it in small visual PRs guarded by a permanent token-pair contrast test. Chosen shape (owner decision D5, option B): two text levels, `--text` and `--text-muted`, both AA on every surface (light muted `#625e52`, 4.55:1 on the darkest surface; the dark value already passes); a non-text token `--non-text` at 3:1 or more (`#7e796a` light, `#817966` dark) for icons, dots and decorative glyphs; `--text-faint` is retired as text and its usages migrated; the existing `--accent-strong` for the active nav text; Highlight and badge text derived by mixing the category colour toward `--text` (45% kind colour, 55% text, colour-mix option A: 50% left stacked tints at about 4.4:1 in dark) so hue survives and AA holds for the shipped colours; dark overrides for the four category tokens that lack them; a text-safe `--warn-text` and its siblings for status text. Delete the four `A11Y_DEBT` entries and set `MAX_DEBT_ENTRIES` to 0.

## Key Hypothesis

We believe a darker two-level text ramp plus a non-text token, an on-tint accent text token, and derived on-tint category text will make every text pair in the app meet 4.5:1 in both themes, for narrators who read in varied lighting or with low vision, while type (size, weight, case, typeface) rather than a third grey carries the step between a label and prose. We'll know we're right when the token-pair test passes for every declared pair in both themes, the atlas passes with zero debt entries, the user signs off the PNGs at all four viewports (light and dark), and defect 1 is closed (Phase 6 `complete`).

## What We're NOT Building

- A new theme, a high-contrast mode, or a colour-blind palette - out of scope; this only reaches AA for the current design.
- Changes to the accent hue, surfaces or borders - non-text border contrast (`--border` is 1.56:1 on white) is a separate WCAG 1.4.11 question, not decided here.
- Contrast enforcement for arbitrary user-chosen category colours - not guaranteeable with a coloured-text design (see Open Questions 3-4).
- Axe on app states - owned by the test-stability PRD; this PRD ships a token-level guard instead.
- A CSS `contrast-color()`/APCA approach - TBD - needs research on webview support; not needed for AA.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Text pairs at AA | 100% of declared pairs >= 4.5:1, light and dark | New Vitest token-contrast test over `styles.css` |
| Non-text category marks | >= 3:1 vs `--surface` in both themes (underline, dots) | Same test |
| Debt entries | `A11Y_DEBT` empty; `MAX_DEBT_ENTRIES = 0`; the guard's `KNOWN_FAILURES` empty | `src/atlasCoverage.test.ts`; atlas; `src/paletteContrast.test.ts` |
| Hierarchy kept | Text is stronger than muted on every surface (11.7 vs 4.55 on surface-3), and the non-text token stays below both; no text uses the retired token | Test asserts the ordering; `--text-faint` is gone from `src/` |
| No unreviewed visual change | PNGs looked at at every captured viewport (desktop, small-desktop, tablet; ADR 0037), light and dark | Playwright suite (`UI_THEME=dark` for the dark run) + PNG review |
| Docs current | 42 doc images and `design-system.md` regenerated once | doc-screenshot-sync; `docScreenshots.test.ts` |
| Defect closed | Defect 1 closed: Phase 6 marked `complete` in this PRD | Review |

## Open Questions

- [x] **1. Text ramp strategy.** **Decided (D5): option B.** Options: (A) keep three levels, all AA everywhere: light muted `#454238` (7.06 on surface-3), faint `#625e52` (4.55); dark muted `#c4bead` (7.06), faint `#9e9788` (4.51); (B) two text levels plus a non-text token: muted `#635f50` (4.5 on surface-3), retire faint as text, migrate 73 usages, add a 3:1 icon/decoration token (`#7e796a` light, `#817966` dark); (C) keep faint as is and forbid it as text (not viable: faint carries real labels such as section labels, "Global defaults", "Live activity"). Original recommendation: (A) for the smallest diff and a preserved hierarchy. The owner chose (B) (implementation plan D5): two levels, a non-text token, and about 73 usages migrated. Recomputed: `#635f50` is 4.49:1 on surface-3, just short, so light muted is `#625e52` (4.55:1); the non-text values `#7e796a` (3.05:1) and `#817966` (3.03:1) hold 3:1 on every surface and are checked by the guard.
- [x] **2. How dark should muted be?** **Decided: as light as AA allows** (option B has one muted level, so the 7:1 separation from faint has no reason to exist). Options: 7:1 on surface-3 (`#454238`, wide separation from faint) or 6:1 (`#4f4c40`) or 5.5:1 (`#555145`, closest to today but only 1:1 above faint). Recommendation: 7:1; the user should confirm by eye in the Phase 2 PNGs, and the value is one line to change.
- [x] **3. Highlight and badge text.** **Decided (D5): (A), tuned to a 45% kind colour in phase 4 (see the Decisions Log).** Options: (A) text = `color-mix(category 50%, --text)`: light 6.30-6.87, dark 5.15-5.96 with today's tokens, hue retained, underline stays the pure category colour; (B) neutral `--text` on the tint (note-style): 11-12:1 in both themes and robust to any user colour, but drops coloured text, which ADR 0016 chose for entities; (C) fixed darker/lighter per-category text tokens (breaks user overrides). Recommendation: (A). It keeps ADR 0016's look and fixes every shipped colour. Caveat measured for user colours at 50%: `#00ff00` 3.80, `#ffff00` 3.35, `#00ffff` 3.65 still fail; (B) is the only design that guarantees AA for any user colour. Choose (B) if guaranteed compliance beats coloured text.
- [x] **4. User-chosen category colours.** **Decided: (a), documented in ADR 0059.** Options: (a) accept, document it; (b) show the computed ratio beside the colour picker in Settings; (c) clamp or auto-adjust. Recommendation: (a) now, (b) as a Could follow-up (touches `Settings.tsx`/`ScopedSetting.tsx`, coordinate with the settings-layout PRD). Moot if Q3 = (B).
- [x] **5. Dark overrides for `--lore/--item/--event/--note`.** **Decided: add, hexes chosen by eye in the phase 4 PNG review.** Options: add them (needed for the 3:1 non-text bar; computed safe values for 4.5:1 on dark surface: lore `#a67d4c`, item `#608b9d`, event `#af7389`, note `#c17039`; the true values are TBD by eye) or leave dark as light. Recommendation: add, with hexes chosen in the Phase 4 PNG review. Note `--note` also gets an inline override from `color_note`'s default.
- [x] **6. Scope beyond the four debt entries.** **Decided: (b), and wider:** the guard also found danger, review and info text on soft fills (phase 5). Options: (a) only the four atlas entries; (b) also entity badges and `--warn` text (introduce `--warn-text`: light `#967019` gives 4.5 on surface, `#866416` on its 18% tint). Recommendation: (b), because they are the same failure and invisible to the atlas; badges ride on Phase 4, warn text is its own Should phase.
- [x] **7. Guard mechanism.** **Decided: (a), delivered in phase 1** as `src/paletteContrast.test.ts` with `KNOWN_FAILURES` as the explicit ratchet. Options: (a) a permanent Vitest token-pair contrast test (node env like `legacyCss.test.ts`, parses both theme blocks, computes `color-mix`, asserts declared pairs); (b) rely on the atlas only; (c) wait for axe on app states. Recommendation: (a) first in Phase 1, initially listing today's failures as an explicit ratchet so each fix phase deletes entries.
- [x] **8. ADR.** **Decided: one ADR, written in phase 1 as [ADR 0059](../adr/0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md).** One new ADR before any recolouring ("AA text tokens and derived on-tint text"), amending ADR 0016 (entity text colour) and citing 0010. Confirm, and re-check `docs/adr/` numbering when writing it (0027 at d5cc994, but the dialog, a11y-components and settings-layout PRDs also plan ADRs, so take the next free number at merge time).

## Users & Context

**Primary User**
- **Who**: a narrator with low vision, or reading in bright or dim rooms, on the desktop app in either theme.
- **Current behavior**: strains to read faint labels and helper text, misses the active nav state in light mode, cannot read Lore/Item/Event highlights in dark mode.
- **Trigger**: any screen; the reader and Story Bible most.
- **Success state**: all text is legible in both themes and the faint/muted/text hierarchy still guides the eye.

**Job to Be Done**: When I read the app in my normal lighting, I want every label and highlight legible without losing the visual hierarchy.

**Non-Users**: developers benefit from a guard test; no behaviour change for anyone else.

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Token-pair contrast test with a ratchet; ADR |
| Must | Two-level text ramp AA on all surfaces, light and dark; the non-text token; every `--text-faint` usage migrated and the token deleted |
| Must | Active nav text AA (`NavButton`; the Settings category tabs already pass) |
| Must | Highlight text AA for shipped colours; dark overrides for the four missing tokens; delete the four debt entries |
| Should | Entity badges AA; warn, danger, review and info text AA; 3:1 for the underline and dots |
| Could | Contrast hint next to user colour pickers |
| Won't (here) | High-contrast mode; border contrast; axe on app states |

### MVP Scope

Phases 1-4 and 6. Phase 5 (status text) is Should. Phase 2 is split by area into five reviewable pull requests (2a to 2e).

### User Flow

1. The owner's answers (D5 and the recommendations) are recorded in an ADR.
2. A guard test lands that fails on any new low-contrast pair.
3. Each recolouring PR flips its pairs green, deletes its debt entry, and is reviewed as PNGs at desktop, small-desktop and tablet (no phone viewport, ADR 0037) in light and dark.
4. A final docs pass regenerates the documentation images once.

## Technical Approach

**Feasibility**: HIGH for tokens (one file, all consumers inherit); MEDIUM overall because visual sign-off is subjective and the change reaches every screen.

**Architecture Notes**
- Tokens stay in `styles.css` (ADR 0010): light in `:root`, dark only in `:root[data-theme='dark']`. The four category tokens now living in a second unlayered `:root` block at the bottom should move next to the others when their dark overrides are added; `legacyCss.test.ts` ignores `:root`, so this is allowed.
- Derived text: add tokens such as `--character-text: color-mix(in srgb, var(--character) 45%, var(--text))` (one per kind) in the same blocks, and have `highlightStyle()` and `BADGE_STYLE` reference them. Because user overrides replace `--character`, the derived token follows the user's hue automatically. `color-mix` is already used throughout (`NavButton`, `Highlight`), so webview support is proven.
- Active nav: swap `text-[var(--accent)]` for `text-[var(--accent-strong)]` in the active branch of `NavButton.tsx` (a ternary, so ADR 0017's mutual-exclusivity rule holds). The Settings category rail is now the `Tabs` sidebar variant, which already uses `--accent-strong`.
- The test computes WCAG luminance, composites `color-mix(... transparent)` over the row backgrounds (surface and `--row-alt`), and asserts ordering `text > muted > faint`.
- The ramp is not a token-only change under option B: `--text-muted` is darkened (its 116 references follow), but every one of the 73 `--text-faint` references is edited, triaged into text (`--text-muted`) or decoration (`--non-text`), by area. A ratchet test (`src/retiredTokens.test.ts`, phase 2a) holds a per-file ceiling on `--text-faint` occurrences that only goes down, and the last slice deletes the token.
- Per-phase documentation refresh: the doc-screenshot set (`apps/ui/tests/visual/doc-screenshots.json`, 42 images) regenerates on visual change (doc-screenshot-sync skill); do it once in the final phase to avoid binary conflicts. The guide lives in `docs/guides/using-the-app/`; `apps/ui/src/docsGuide.test.ts` checks that every manifest entry is embedded on exactly one page.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Darker muted flattens the hierarchy or feels heavy | Medium | Three concrete levels proposed; user PNG sign-off; one-line tuning |
| Derived text colours look muddy on some user colours | Medium | 50% mix is tunable; Q3 fallback (B) |
| User-chosen colours still fail | High (by design) | Q4; documented; Q3 (B) removes it |
| Regenerating 42 doc images collides with other PRs | High | Regenerate only in the final phase, after rebase; never merge binaries |
| Tint over `--row-alt` is worse than over `--surface` | Certain (up to 0.7 lower) | Test uses the worst case |
| Missed pairs outside the declared list | Medium | The test fails when the source draws text with a colour token that has no declared pair; a scratch axe run over the app states in both themes at each phase; axe on app states is the long-term catch (test-stability PRD, now unblocked) |
| A `--text-faint` usage is triaged wrongly (a label sent to the non-text token, or an icon to muted) | Medium | The triage is per usage and recorded in the PR; muted is the default for anything that reads as text; PNG review at every viewport in both themes |
| Two ratchets drift (test vs `A11Y_DEBT`) | Low | Phase 6 sets both to empty in one review |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Decision, ADR and guard test | Reconcile this PRD with the owner decisions; [ADR 0059](../adr/0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md); the token-pair contrast test with an explicit current-failure ratchet; `UI_THEME=dark` for the visual suite; no visual change | complete | No | - | - |
| 2a | Text ramp: tokens, primitives, shell | `--non-text`; light `--text-muted` `#625e52`; the `--text-faint` usage ratchet; migrate the primitives, the app shell and `components.css`; delete the `WorkDialog` and `MeterBar` debt entries | complete | No | 1 | - |
| 2b | Text ramp: Home, project picker, Settings, Tracks | Triage and migrate `--text-faint` in those pages | complete | No | 2a | - |
| 2c | Text ramp: Manuscript | Triage and migrate `--text-faint` in the reader, chapter navigation and entity summary | complete | No | 2b | - |
| 2d | Text ramp: Proofing, Teleprompter | Triage and migrate `--text-faint` in those pages | complete | No | 2c | - |
| 2e | Text ramp: Story Bible, retire the token | Triage and migrate `--text-faint` in the Story Bible; delete `--text-faint` from both theme blocks | complete | No | 2d | - |
| 3 | Active nav on tint | `--accent-strong` text in `NavButton.tsx`; delete the `NavButton` debt entry | complete | No | 2a | - |
| 4 | Highlight, badges, dark category tokens | Derived `--<kind>-text` tokens, dark overrides for lore/item/event/note, `Highlight.tsx`, `EntitySummary.tsx` badges; delete the `Highlight` debt entry | complete | No | 2e | - |
| 5 | Status text | `--warn-text` and its siblings for `Settings.tsx`, `Results.tsx`, `InlineDiffRow.tsx`, the danger and review text on soft fills, and the Tailwind `text-red-400` | pending | No | 4 | - |
| 6 | Sweep and docs | Close defect 1 (delete this PRD); `MAX_DEBT_ENTRIES = 0`, `KNOWN_FAILURES` empty; `design-system.md` colour section; regenerate `docs/ui` and the doc images once; final PNG pass | pending | No | 2e, 3, 4, 5 | - |

### Phase Details

**Phase 1 - Decision, ADR and guard test.** Goal: settle the palette on paper and make regression impossible. Scope: this PRD reconciled with the owner decisions; `docs/adr/0059-*.md`; `src/tokenContrast.ts` (parses the tokens, evaluates `var()`, `color-mix` and `transparent`, composites, computes WCAG contrast) with `src/tokenContrast.test.ts`; `src/paletteContrast.test.ts` (the declared pairs, the `KNOWN_FAILURES` ratchet, the ordering and the census of text tokens); `UI_THEME=dark` in the visual suite's `beforeCapture`; no CSS change. Success signal: the test runs green with the 26 known failures listed, and any new failing pair, or a fixed pair left in the ratchet, turns it red (both shown by mutation).

**Phase 2 - Text ramp (2a to 2e).** Goal: two text levels AA on every surface, the third grey gone. 2a adds `--non-text` and darkens the light `--text-muted` in `styles.css`, adds the per-file ceiling test for `--text-faint`, migrates the primitives, the shell and `components.css`, and deletes the `WorkDialog` and `MeterBar` debt entries; 2b to 2e migrate the pages one area at a time and 2e deletes the token. Each usage is triaged: anything that reads as text (labels, counts, helper text, placeholders, empty states) moves to `--text-muted`; icons, dots, glyph borders and decorative arrows move to `--non-text`. Each slice runs the full gate, the visual suite for that area's states at every viewport in both themes (looked at, not only run), and a scratch axe pass over the same states. Success signal: `text-muted` and `text-faint` leave `KNOWN_FAILURES`, the atlas passes for `WorkDialog` and `MeterBar` without their entries.

**Phase 3 - Active nav.** Goal: active item AA in light. Scope: `NavButton.tsx` and its debt entry (the Settings category tabs already use `--accent-strong`). Success signal: atlas `NavButton` passes; the `global/nav-*` and `settings/*` PNGs reviewed; `nav-active` leaves `KNOWN_FAILURES`.

**Phase 4 - Highlight, badges, dark tokens.** Goal: highlights and badges AA and the dark palette complete. Scope: `styles.css` token blocks (the `--note`, `--lore`, `--item`, `--event` block moves next to the others with dark overrides), `Highlight.tsx`, `EntitySummary.tsx`, stories, the debt entry. Change-impact-scan: `ParagraphView`, `EntitySummary`, `GuideDetail`, `ReaderText` (teleprompter) consume `Highlight`. Success signal: dark Lore/Item/Event highlights legible, `manuscript/*` and `storybible/*` PNGs looked at in both themes; every `highlight-*`, `badge-*` and `mark-*` pair leaves `KNOWN_FAILURES`.

**Phase 5 - Status text.** Goal: no measured text pair below AA. Scope: `--warn-text` and the danger, review and info text-safe values, at the call sites the guard lists (`Settings.tsx`, `Results.tsx`, `InlineDiffRow.tsx`, `Home.tsx`, the danger button and field error) and the `text-red-400` in `Results.tsx`. Success signal: the status pairs leave `KNOWN_FAILURES`.

**Phase 6 - Sweep and docs.** Goal: leave nothing stale. Scope: both ratchets to zero, `docs/design/design-system.md` (colour section), `docs/ui` regen (`node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir apps/ui`), doc-screenshot-sync (regenerates the doc images; `pnpm --dir apps/ui test` for `docScreenshots.test.ts`), full-verification-gate, and the PRD's deletion. Success signal: `pnpm check` and the atlas green with zero debt.

### Parallelism Notes

Delivered as one stack of stacked pull requests in the order of the table, so there are no sibling conflicts; phases 2 to 5 all edit the token blocks of `styles.css`, which is why they are sequenced and not parallel.

### Parallel-session compatibility

Files owned: `apps/ui/src/styles.css` (token blocks only), `primitives/NavButton.tsx`, `primitives/Highlight.tsx`, `manuscript/EntitySummary.tsx` (`BADGE_STYLE`), every component that draws `--text-faint` (Phase 2), `Results.tsx`, `InlineDiffRow.tsx`, `Settings.tsx` and `Home.tsx` (Phase 5), `tests/atlas/a11y-debt.ts`, `src/atlasCoverage.test.ts` (`MAX_DEBT_ENTRIES`), the new token test, `docs/design/design-system.md`, the ADR, all 42 doc images (final phase only), the Status cells of this PRD's phase table.
- Can run concurrently with: the a11y-components PRD (disjoint; both regenerate `docs/ui/**`), the settings-layout PRD (both edit `Settings.tsx`, different regions; second to merge rebases), the test-stability PRD's Go and frontend-test phases.
- Do not run concurrently with: (the `WorkDialog` markup is final now that the dialog work is delivered, [ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md), so this PRD's Phase 2 can delete the `WorkDialog` debt entry; the running-job notice it added is `text-muted` on the surface, so check it when the ramp lands); `teleprompter-manuscript-integration.prd.md` Phase 7 (new `Highlight` kinds and the atlas debt list; sequence after Phase 4 here); any PRD that also regenerates `docs/images/ui/*.webp`.
- Generated/shared files that always conflict: `docs/ui/**`, `docs/images/ui/*.webp`, `docs/design/design-system.md`.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Dark values live only in `:root[data-theme='dark']`; tokens consumed as `var(--x)` (prior decision, ADR 0010) | Keep; add the missing dark overrides there | Media-query copy | Single source of truth |
| Entities tint their text in the kind colour; notes keep text colour; tint mixes with `transparent` (prior decision, ADR 0016) | Keep unless Q3 = (B), which needs a superseding/amending ADR | Solid fills | Reads on alternating rows |
| Mutually exclusive state classes (prior decision, ADR 0017) | Ternary for the active nav colour | Base + override | Stylesheet-order bugs |
| Contrast is recorded, reasoned, ratcheted debt, not silently recoloured (prior decision, ADR 0023) | Fix via ADR, then delete entries | Silent recolour | This PRD |
| Custom colours come from user settings (prior decision, existing behaviour) | Derived tokens follow user hue | Hardcoded per-category text | Overrides must keep working |
| Nothing merges without the user (prior decision, CLAUDE.md) | One PR per phase | - | - |
| Two text levels plus a non-text token; `--text-faint` retired as text (owner decision D5; chosen over the recommended option A) | Option B | A (three levels), C (keep faint, forbid as text) | The owner's call; ADR 0059. Recomputed values: light muted `#625e52`, non-text `#7e796a` light and `#817966` dark |
| `--accent-strong` for active nav text (decided) | Existing token | Darken `--accent` | No new token; keeps buttons unchanged. The Settings tabs already use it |
| Derived on-tint text, 45% kind colour and 55% `--text` (decided, D5 said 50%; tuned in phase 4) | Colour-mix option A | Neutral text; fixed tokens | Keeps ADR 0016's coloured text; user colours are not guaranteed (Q4 a) |
| Scope beyond the four debt entries (decided) | Badges, `--warn-text`, and the danger, review and info text the guard found | Only the four entries | Same failure, invisible to the atlas |
| A permanent guard with an explicit ratchet (decided) | Vitest token-pair test, `KNOWN_FAILURES` shrinks each phase | Atlas only; wait for axe on app states | Fast, runs in the gate, names the pair and the surface |
| Phase 2 is split by area (owner instruction) | 2a to 2e, each with the full gate | One PR for about 73 usages in 23 files | Reviewable slices; a per-file ceiling test keeps the migration honest |

## Research Summary

**Market Context**: WCAG 2.2 SC 1.4.3 requires 4.5:1 for normal text and SC 1.4.11 requires 3:1 for meaningful non-text marks; large text (>= 24px, or 18.66px bold) needs 3:1, but the faint labels are 11.5px, so no large-text exemption applies. CSS `contrast-color()` and APCA are not settled in the target webviews (TBD - needs research).

**Technical Context**: tokens in `apps/ui/src/styles.css`; debt list `apps/ui/tests/atlas/a11y-debt.ts` and ratchet `apps/ui/src/atlasCoverage.test.ts` (`MAX_DEBT_ENTRIES = 4`); Highlight in `primitives/Highlight.tsx` (ADR 0016), badges in `manuscript/EntitySummary.tsx`; user colours applied in `App.tsx` and `Settings.tsx`; verification per CLAUDE.md (plan, change-impact-scan, TDD, `pnpm check`, `pnpm --dir apps/ui atlas`, Playwright visual suite with PNG review at all four viewports, design-spec-guard because this edits `styles.css` and primitives, feature-cleanup); `docs/ui/` via `node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir apps/ui`; mark each phase `complete` in the same PR that lands it.

---

*Generated: 2026-09-19*
*Status: IN DELIVERY - stack S12a, phase 1 complete (issue #123)*
