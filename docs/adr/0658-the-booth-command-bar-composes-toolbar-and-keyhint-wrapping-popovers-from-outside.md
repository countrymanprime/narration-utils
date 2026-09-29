# 0658. The Booth command bar composes `Toolbar` and `KeyHint`, wrapping popovers from outside

**Status:** Proposed (Phase 13 of the mock fidelity PRD, stream F-P13 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28

## Context

Mock 03's command bar (≈64 px) draws each action as a key cap beside its label. `booth/ReadingControlBar.tsx` drew its own `<div role="toolbar">` by hand instead of composing Phase 10's `Toolbar`/`ToolbarButton` primitives, and showed Play/Pause's real `Space` shortcut (wired through `useCommand('reading.toggle', ...)`, unchanged) only as an icon with text hidden below `lg`, never as a visible key cap.

The bar mixes plain buttons with three composite controls that manage their own trigger prop — the Microphone and Settings `Popover`s and the REAPER toggle's `CapabilityGate`. `ToolbarButton`'s `render` prop and `Popover`'s `trigger`/`CapabilityGate`'s children both work by cloning props onto the element they're given, one layer deep; nesting a `ToolbarButton` *inside* a `Popover`'s `trigger` (or inside `CapabilityGate`'s children) has `Popover`/`CapabilityGate` clone their own open/gating props onto `ToolbarButton` itself rather than the real button underneath, silently dropping the click handler that opens the popover.

## Decision

1. Every interactive control in the bar (Play/Pause, Stop, Follow, the Microphone popover, the REAPER indicator's toggle/Arm-only/Refresh, the built-in `RecordButton`, the Settings popover) is wrapped in a `ToolbarButton`, and the bar's own wrapper is the `Toolbar` primitive.
2. For a composite control (`Popover`, `CapabilityGate`, `RecordButton`), `ToolbarButton` wraps it from the *outside* (`render={<Popover ...>...}`), not the reverse. This keeps every popover/capability-gate/record behaviour exactly as it was; the cost is that these specific items don't gain real roving-tabindex membership in the toolbar (their own internal tab behaviour is unaffected and remains fully usable by keyboard, just not through `Toolbar`'s Home/End/arrow-key bookkeeping). A plain `Button`/`IconButton` control nests the other way (`ToolbarButton` outside, `Button` as its `render`) and gets full membership.
3. Play/Pause's visible label becomes `<KeyHint keys={['Space']} action={playPauseLabel} size="md" />` (23 px cap, Phase 10's own size for this bar) instead of an icon plus hidden text — the one action in this bar with a real, already-wired shortcut. No other action in the bar gets an invented cap: mock 03 also shows key hints for punch-and-roll, back-one-sentence, flag and mark-pickup, none of which are bound commands yet (they belong to the not-yet-built booth-actions-enablement/input-commands PRDs; see `docs/research/visual-mockup-divergence-audit.md` row BO10).
4. The bar's height moves to ≈64 px (mock spec) with ordinary Tailwind padding, not a new token.

## Consequences

- The command bar's ARIA/keyboard semantics come from the shared `Toolbar` primitive for its plain-button items.
- Play/Pause visibly documents its own shortcut, matching the mock's key-cap-plus-label pattern, without fabricating shortcuts the app doesn't have.
- The Microphone/Settings popovers, the REAPER toggle and the built-in recorder keep 100% of their existing behaviour; their toolbar membership is partial, a known, harmless, documented trade-off of `render`-prop composition rather than a defect.
- A later phase that wants full roving-tabindex membership for a popover-based toolbar item would need `Popover`/`CapabilityGate` to forward unrecognised props, which is out of this phase's scope.
