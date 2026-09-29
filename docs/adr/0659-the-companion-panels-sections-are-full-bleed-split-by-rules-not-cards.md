# 0659. The companion panel's sections are full-bleed, split by rules, not cards

**Status:** Proposed (Phase 13 of the mock fidelity PRD, stream F-P13 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28

## Context

Mock 07 (the companion panel pinned beside a DAW) draws its sections (Script, Note at playhead, Pickups, Hotkeys, This session) full-bleed on `--bg`, each separated from the next by a single 1 px `--border` rule, with no card chrome of its own. `booth/CompanionShell.tsx` drew each section as its own bordered, radiused, padded card (a local `SECTION` class), and its Play/Pause/Stop/Follow/"Full app" buttons carried a hand-rolled `TOOLBAR_BUTTON_CLASS` padding override instead of the `Button` primitive's own `sm` size. `primitives/CompactShell.tsx`'s header, the companion's only other consumer, was sized by padding alone (≈40.8 px) rather than the mock's measured 45 px.

## Decision

1. `CompanionShell.tsx`'s local `Section` component drops its card chrome; each section after the first draws a `border-t border-[var(--border)] pt-3` divider instead (the first section needs none, sitting right under the header's own rule).
2. Every companion button (Play/Pause, Stop, Follow, "Full app") uses `Button size="sm"` (28 px, `--button-height-sm`) instead of a pasted padding/text-size override. Mock 07 draws "Full app" slightly smaller still, at 26 px; `sm` is the closest existing size, and this phase does not add a new one for a 2 px gap.
3. `primitives/CompactShell.tsx` (confirmed to have no consumer besides `CompanionShell.tsx`) gets `min-h-[2.8125rem]` (45 px) on its header instead of relying on padding alone.
4. The companion's pickups list (`pickups/PickupsCompanionSummary.tsx`) moves to Plex Mono 13 px on a 29 px row, the same monospace convention `Kbd`/`KeyHint` already use for dense rows.

## Consequences

- The companion panel's section rhythm and button sizing match the mock; `src/buttonOverrides.test.ts`'s `CompanionShell.tsx` ceiling entry is deleted (its migrated recipe leaves nothing to count).
- `CompactShell`'s header height change affects only its one real consumer.
- The companion's reading text (Plex 16 px/27 px in the mock) and three sections the mock draws with real data ("Note at playhead", "Hotkeys", "This session") are not built here: they need either a `ReaderText`/`ReadAlongView` prop this phase doesn't have a slot for, or real data from PRDs this phase does not own (proofing, booth-actions-enablement, input-commands) — see the Mockup check for the itemised list, and `docs/research/visual-mockup-divergence-audit.md`'s companion-mode table.
