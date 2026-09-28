# 0465. The shell's header states are also captured at the reflow width, because that's what a narrator sees at high zoom

**Status:** Proposed
**Date:** 2026-09-28
**Supersedes:** none

## Context

[ADR 0061](0061-settings-states-are-also-captured-at-a-390px-reflow-width.md) already captures every Settings state at
a 390px reflow width, on top of the regular desktop/small-desktop/tablet matrix (ADR 0037: no phone viewport), because
Settings' own layout stacks below `md`. The [App Navigation and Zoom Controls PRD](../prds/app-navigation-and-zoom-controls.prd.md)
(Phase 1: Back/Forward; Phase 2: the zoom group) adds new, permanent header controls the narrator can reach at *any*
window width or zoom level, not only below `md`: the real webview zoom this PRD adds runs from 100% to 200% on
Windows (Q6, [ADR 0201](0201-app-zoom-under-wails-v3-on-windows-runs-from-100-to-200-percent-and-reads-the-level-back-from-the-window.md)),
and at 200% on the app's 960px minimum window the CSS viewport is 480px - already below `md` - while a stray
Ctrl+wheel or pinch can go further still. The header at a narrow width is therefore not a rare edge case but exactly
what a narrator sees whenever they zoom in, and no `shell` state existed at the reflow width before this PRD (only
Settings did).

## Decision

The `shell` page's header-focused visual states - `history-enabled`, `history-forward` (Phase 1) and `zoom-level`
(Phase 2) - each carry `extraViewports: [REFLOW_VIEWPORT]` (`apps/ui/tests/visual/catalog/shell.ts`), the same
mechanism ADR 0061 uses for Settings. This is a declared, reasoned extension of the reflow rows beyond Settings, not
an accident: any future PRD adding a new header control (a third chip, a second zoom-like binding) should ask the same
question - "is this reachable at a width below `md`, including through real zoom, not just a narrow window?" - and
capture it at reflow if so, rather than assuming reflow coverage is Settings-only.

The `shell` page's other states (`engine-builtin`, `engine-mismatch`, and the header controls' own default -
disabled - states already shown by other pages' captures) are unchanged: this ADR extends reflow coverage for the
states that are new *because of* a header change, not for every `shell` row going forward by default.

## Consequences

- A future header control's collapsed-control and overflow checks (ADR 0060) run at 390px from the day it ships, the
  same width a high-zoom narrator actually has, instead of only being found later against a real build.
- Each header-focused row's screenshot count doubles (one more viewport), the same cost ADR 0061 already accepted for
  Settings; this is worth it for a header, which is visible on every page.
- The zoomed layouts themselves need no matrix of their own: real zoom at level Z on a window W CSS px wide is the
  app at W/Z CSS px, which the existing desktop/small-desktop/tablet/reflow widths already cover (a 1280px window at
  125% is `small-desktop`, the 960px minimum at 125% is `tablet`, and 400% is the `reflow` range) - this equivalence
  is what Phase 2's Technical Approach relies on instead of adding new viewport constants.
- A future PRD that wants to *stop* capturing a header row at reflow (a control proven never reachable below `md`)
  needs a new ADR superseding this one, naming which row and why.
