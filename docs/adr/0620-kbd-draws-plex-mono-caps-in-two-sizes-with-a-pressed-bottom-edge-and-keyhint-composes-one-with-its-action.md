# 0620. Kbd draws Plex Mono caps in two sizes with a pressed bottom edge, and KeyHint composes one with its action

**Status:** Proposed (Phase 10 of the mock fidelity PRD, stream F-P10 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** nothing recorded. [ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md)'s "`Kbd` only draws keys" stands unchanged.

## Context

The mock fidelity PRD's Phase 10 table measures `Kbd` against the benchmark mocks (03, the booth; 07, the companion): a IBM Plex Mono cap, `--surface-2` fill, a 1 px `--border`, radius 3-4 px, about 6 px side padding, drawn at **23 px** in the booth and **18 px** in the companion, each with a **2 px bottom edge** rather than a flat 1 px border all round. Today's `Kbd` (`Kbd.tsx`) uses Tailwind's `font-mono` (the system `ui-monospace` stack, not Plex Mono), one fixed 17.2 px height and a flat 1 px border.

The mock's command bar (mock 03) also draws a cap next to its action's name ("R" next to "Record"), a pairing the app draws nowhere: every current `Kbd` call site is either a bare cap (a chord in the shortcut sheet, Settings) or a cap glued to a button's own label by the caller's own markup (`booth/ReadingControlBar.tsx`'s `<Kbd keys={['Space']} />{playPauseLabel}`).

## Decision

- **`Kbd` gains `size: 'md' | 'sm'`**, 23 px and 18 px respectively (`h-[1.4375rem]`/`h-[1.125rem]`), defaulting to `sm` since every migrated call site outside the booth's own command bar (Phase 13's) is a dense row. Phase 13 passes `size="md"` when it builds the booth command bar.
- **The cap uses Plex Mono** (`font-['IBM_Plex_Mono',ui-monospace,monospace]`, matching the mono stack already used for the transport's elapsed readout and REAPER paths elsewhere in the app), not the system `font-mono`.
- **The bottom border is 2 px**, one step past the 1 px top/left/right border (`border border-b-2`), so the cap reads as a pressed key rather than a flat chip. This applies to both sizes; the dark PRD sets' 17-18 px flat-border caps are the pre-benchmark rendering, and the benchmark mocks win where they disagree (Q1, D69/D85).
- **A new `KeyHint` primitive** composes one `Kbd` with a visible action label, 10 px apart, in Plex Sans 13 px `--text-muted` (mock 03's bottom command bar: a cap, then "Play", "Record", ...). `Kbd`'s own `label` prop (the spoken name for a symbol key) is exposed through `KeyHint`'s `spokenLabel`, kept apart from the visible `action` text so the two never collide. `KeyHint` is additive: it does not replace a bare `Kbd`, which stays for a chord with no single action (the shortcut sheet, Settings).
- **`Toolbar` gains `gapClassName`** (default `gap-1`, unchanged for every existing consumer) so a segmented-looking bar whose items touch and share a border instead of a gap (`SelectionMenu`) can pass `gap-0` without a page fighting the primitive's own gap utility.
- **`Kbd` still only draws keys.** No platform or command-registry logic moves into `Kbd` or `KeyHint` (ADR 0360 stands): both take the caps and the label as plain strings, exactly as `Kbd` did before.

## Consequences

- **Every `Kbd` consumer inherits Plex Mono and the pressed edge for free**, without a file change: the shortcut sheet, Settings' keyboard panel, and the booth's own caps (`BoothView.tsx`, `CompanionShell.tsx`, both owned by Phase 13) all move off the system mono stack and the flat border the moment this phase merges.
- **`proof/TransportBar.tsx` and `manuscript/SelectionMenu.tsx` become `Toolbar`s** (APG roving focus, one tab stop), which they were not before. Their own `Button`/`disabled`/`pending` props are left exactly as they were - the native `disabled` attribute, not `ToolbarButton`'s own `disabled`, is what takes each control out of the roving order, so the migration changes no visible or keyboard behaviour beyond the toolbar semantics themselves.
- **`engine/RenderConfigDialog.tsx`'s manual-render hint** ("Ctrl+Alt+R") is a real `Kbd` cap instead of plain text.
- **The booth's command bar and companion (mock 03, 07) are Phase 13's** to compose from `Toolbar` and `KeyHint`; this phase only adds the primitives and the sizing they need.
- **Changing this decision.** Write a new ADR that supersedes this one and re-run `Kbd.test.tsx`, `KeyHint.test.tsx` and the atlas.
