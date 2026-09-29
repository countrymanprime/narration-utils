# 0656. The Booth's REC pill draws with its own `--rec-fill`/`--rec-text` tokens, not a status tone

**Status:** Proposed (Phase 13 of the mock fidelity PRD, stream F-P13 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28

## Context

Mock 03's top bar draws a recording pill ("REC · P&R") filled a specific dark maroon with pink text — `--rec-fill`/`--rec-text` (`#5e1d16`/`#f9b8af` dark, Phase 0b, [ADR 0590](0590-the-mock-fidelity-token-batch-fills-badges-with-opaque-soft-tokens-and-names-the-mocks-sizes-and-type.md)), Barlow Condensed bold at 13 px with 0.13 em tracking — noticeably wider tracking and a different fill than `StatusBadge`'s `danger` tone (`--danger-soft`/`--danger-text`, [ADR 0600](0600-every-pill-tag-and-status-dot-is-one-badge-primitive-with-a-pill-a-tag-and-a-booth-shape.md)), which several other Booth chips (mic errors, etc.) still correctly use for genuine danger-tone meaning.

`BoothStatus` (`booth/BoothView.tsx`) previously mapped a live recording to `StatusBadge tone="danger"`, which drew the wrong colours and the standard pill's 0.06 em tracking.

## Decision

While actively recording (`rec` true), `BoothStatus` draws a small inline pill directly with `background: var(--rec-fill)`, `color: var(--rec-text)`, Barlow Condensed bold, `tracking-[0.13em]`, instead of routing through `StatusBadge`. Every other status (Reading/Paused/Ready) keeps `StatusBadge` at its existing `info`/`neutral` tones, which the mock does not contradict.

`--rec-fill`/`--rec-text` already exist in both themes (Phase 0b); this only adds their first real consumer. `StatusBadge`'s `TONE_STYLE` gains no new tone: the REC pill is not a status meaning other pages will ever reuse (`--badge-danger-fill` — a different, pre-existing token — stays reserved for `ReadingControlBar`'s own finished-recording ring, per [ADR 0600](0600-every-pill-tag-and-status-dot-is-one-badge-primitive-with-a-pill-a-tag-and-a-booth-shape.md)'s "Retired tokens" note).

## Consequences

- The REC pill now matches the mock's colour and tracking exactly.
- `--rec-fill`/`--rec-text` have their first consumer, closing the gap Phase 0b opened for.
- If a second page ever needs the same maroon "hardware is recording" pill, this ADR's markup (not a new `StatusTone`) is the pattern to copy, since the tokens are already named for exactly this.
