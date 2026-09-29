# 0590. The mock fidelity token batch fills badges with opaque soft tokens and names the mocks' sizes and type

**Status:** Proposed (Phase 0b of the mock fidelity PRD, stream F-0b on [#509](https://github.com/countrymanprime/narration-utils/issues/509); its Q3 and Q6 recommendations were taken per D22 and are for the owner to confirm on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-28
**Supersedes:** [ADR 0362](0362-studio-token-batch-aliases-meter-and-badge-colours-and-a-minimal-booth-override.md)'s badge-fill clause only (its meter aliases and the `experimental` tone stand)

## Context

The owner found that the merged pages don't match the approved mocks (D91): the buttons, the tables and the Production pills. The mock fidelity PRD fixes this one primitive at a time (phases 1 to 15). Every phase needs colours, radii, sizes and type that `apps/ui/src/styles.css` doesn't name. [ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md) says such tokens land in one batch, alone, before the primitives use them. Phase 0b is that batch.

The PRD's spec tables give the mock values. This batch checked each value again on the benchmark mocks (`docs/research/mockups/audiobook-studio-benchmark/`), sampling pixels with sharp. The mocks are lossy WebP, so a flat fill is good to about ±3 to ±8 per channel. Four findings changed a value or a formula:

1. **The badge fills.** The mocks fill status pills and Production board cells with opaque `-soft` colours. The ok cell measures `#d8e8dc` (`--character-soft`), the danger cells `#f4dedc` (`--review-soft`), the info cell `#dce4f2` (`--place-soft`) and the warn pill `#f2ead6`. ADR 0362's badge fills are 14% tints over whatever sits behind them, so they draw differently on a card and on a selected row. The warn fill has no entity twin: `--warn` at 18% over `--surface` gives `#f2e9d6`, one step from the measurement.
2. **The selected row.** Mocks 04 and 05 draw it as `#faf1ed`. The PRD's formula, `--accent-soft` at 40% over `--surface`, gives `#f9f1e7`, six steps off in blue. `--accent` at 8% over `--surface` gives `#f9f2ed`.
3. **The waveform and the target zone.** The measured values fail a mark's 3:1. Mock 04's bars measure 65% to 77% accent over the card; 70% is 2.77:1 in light. Mock 05's target zone is exactly `--ok` at 18% over `--surface-2` (`#c8d4c2`), but the band's `--accent` chapter ticks are then 2.98:1 on it.
4. **The toast text.** The dark set (daw-chapter-track-auto-sync/03) draws the inverted toast with a fill of `#f1ece2` (dark `--text`) and text no lighter than `#1a140b`. That is dark `--bg`, not the PRD's `--surface`. The app's existing `toast` pair was already `--bg` on `--text`.

## Decision

**Colours (`:root`, derived once unless a dark value is listed):**

| Token | Value | Dark |
| --- | --- | --- |
| `--ok-soft` | `var(--character-soft)` | follows |
| `--warn-soft` | `color-mix(in srgb, var(--warn) 18%, var(--surface))` | follows |
| `--info-soft` | `var(--place-soft)` | follows |
| `--danger-soft` | `var(--review-soft)` | follows |
| `--row-selected` | `color-mix(in srgb, var(--accent) 8%, var(--surface))` | follows |
| `--reading-bg` | `var(--surface)` | `#0e0d09` (mock 03) |
| `--rec-fill` / `--rec-text` | `var(--review-soft)` / `var(--danger-text)` (the danger pill: light has no mock) | `#5e1d16` / `#f9b8af` (mock 03) |
| `--toast-bg` / `--toast-text` | `var(--text)` / `var(--bg)` | follows |
| `--waveform` | `color-mix(in srgb, var(--accent) 76%, var(--surface))` | follows |
| `--ok-zone` | `color-mix(in srgb, var(--ok) 16%, var(--surface-2))` | follows |

- **Waveform and zone.** `--waveform` is 76%, the least percentage that holds 3:1 (3.06:1) and within what was measured. `--ok-zone` is 16% rather than the measured 18%, so the ticks hold 3:1 (3.05:1). It is four steps lighter than the mock, which is within the WebP tolerance.
- **The soft family replaces ADR 0362's badge fills.** Status fills are opaque `--<tone>-soft` colours. Each aliases the entity `-soft` fill the mocks paint with where one exists.
- **The old tokens stay for now.** `--badge-ok-fill`, `--badge-warn-fill`, `--badge-info-fill` and `--badge-danger-fill` stay until Phase 2 moves `StatusBadge`, and Phase 13 moves `ReadingControlBar`, off them. The phase that removes the last use deletes them. `--badge-experimental-fill` stays, because the mocks draw no experimental pill.

**Sizes and type (`:root`, the same in both themes, in rem at a 16 px root):**

| Token | Value |
| --- | --- |
| `--radius-button` | 6 px |
| `--radius-card` | 8 px |
| `--radius-tag` | 3 px |
| `--button-height` | 32 px, border included (14 benchmark buttons, no variance) |
| `--button-height-sm` | 28 px |
| `--row-height` | 34 px, divider included (mocks 01 and 05) |
| `--header-row-height` | 31 px, rule included (mock 01; 04 and 05 draw 32) |
| `--font-size-page-title` | 26 px (Barlow Condensed cap height 19 px) |
| `--font-size-card-title` | 19 px (cap height 13 px) |
| `--font-size-label` | 11 px (cap height 8 px) |
| `--tracking-label` | 0.1em |
| `--tracking-button` | 0.06em |
| `--font-size-booth-script` | 26 px, moved from 17.6 px (Q6) |
| `--line-height-booth-script` | 1.85, a 48 px line |

**No primitive uses these tokens in this batch.** `--font-size-booth-script` had no consumer, so moving it changes nothing on screen. Phases 1 to 15 consume the tokens through `[var(--token)]`, as the primitives already do.

**Checks:**

- `paletteContrast.test.ts` holds each new colour to its floor in both themes:
  - each tone's `-text` on its soft fill, over the card and over a selected row;
  - the REC pill;
  - the toast;
  - the waveform and the zone's ticks as marks.
- `--row-selected` joins the surfaces every text and mark pair is measured over. `--reading-bg` joins the reading surfaces, so the booth's highlights and speaker colours are measured on it.
- `mockFidelityTokens.test.ts` pins every size and type token to its measured px value.

## Consequences

- **Phases 1 to 15 can start.** No phase may add a token in a feature PR. A later need is a follow-up batch (ADR 0360).
- **Every consumer gets one fill.** A pill draws the same colour on a card and in a selected row, because the fills are opaque. The cost is that they no longer follow an overlay behind them. The mocks never draw one.
- **Two colours are knowingly off the mock** to keep WCAG AA: `--waveform`, possibly slightly darker than drawn, and `--ok-zone`, four steps lighter. A mock-match score counts the difference, but it is too small to decide a state.
- **The booth's light REC pill and light reading surface are unmocked.** They reuse the danger pill and the card surface. If the owner wants a different light booth, that is a new batch.
- **Changing this decision.** Write a new ADR that supersedes this one and re-run `paletteContrast.test.ts` and `mockFidelityTokens.test.ts`.
