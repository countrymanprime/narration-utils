# 0660. Audacity's finding detail hides REAPER's take management instead of disabling it through `CapabilityGate`

**Status:** Proposed
**Date:** 2026-09-28

## Context

[The Audacity integration PRD](../prds/audacity-integration.prd.md), Phase 9 ("Dashboard integration"): a finding sourced from an Audacity project should show only the actions that suit Audacity, with no take-management control reachable. `FindingDetail.tsx` renders three REAPER-only sections for a finding with audio - `ReaperControls` (Go to/Loop/Add marker in REAPER, [ADR 0121](0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md)), `TakeReviewReads` and `TakeComparisonView` (take review and take comparison) - all calling REAPER-bridge bindings (`FindingsGoTo`, `FindingsLoop`, `FindingsStopLoop`, `FindingsAddMarker` and their per-read siblings) that have no Audacity implementation and never will under this PRD's scope: the Decisions Log is explicit that "take management has no Audacity analog."

The DAW port PRD already built a general answer to "can this control run right now": `useCapability` reads a `DawCapabilityKey`'s live entry and `CapabilityGate` wraps a control, showing it disabled with the host's reason unless the caller opts into hiding an `unsupported` one (`hideWhenUnsupported`). That system exists precisely so callers don't hand-roll DAW-aware conditionals. But `ReaperControls`/`TakeReviewReads`/`TakeComparisonView` are not behind a `DawCapabilityKey` at all - they call fixed REAPER-bridge bindings from the review-dashboard-and-findings-adoption and take-review-pickups-duplicates-take-intelligence PRDs, predating the DAW port, with no capability declaration for Audacity to ever mark `supported` or `experimental`. Gating them through a synthetic capability would misrepresent a permanent scope boundary as a temporary readiness gap, the same distinction `navigate`/`markers` keep correctly (Experimental for Audacity today, because the pipe client is real and unfinished) versus what take management is (no Audacity feature exists to finish).

## Decision

`FindingDetail` takes a `dawKind?: DawKind` prop, read once per page by the new `apps/ui/src/useDawKind.ts` hook (`dawCapabilities().daw`, kept current by `daw_capabilities_changed`, mirroring `useCapability`'s read-then-subscribe shape) and passed down by both `ProofPage.tsx` and `ProofChapterPage.tsx`. When `dawKind === 'Audacity'`, `ReaperControls`, `TakeReviewReads` and `TakeComparisonView` are left out of the render entirely - not passed through `CapabilityGate`, not shown disabled with a reason. Every other part of a finding's detail (its evidence, Play ±3 s, Show in Script, Open in Story Bible, Open chapter view, and the decision controls) renders exactly as it does for REAPER, unconditioned on `dawKind`.

## Consequences

- Matches the PRD's success signal literally: no REAPER-only action is reachable from an Audacity project, not merely disabled-with-a-reason (which `CapabilityGate`'s own design note reserves for a capability that might still become available).
- A future Audacity take-management feature is a new decision, not a flag flip: it would need its own `DawCapabilityKey`, its own `port.Level` declaration, and would supersede this ADR rather than extend it - "no analog" is what changed, not "not built yet."
- The three sections keep taking `reaperStatus`/`onReaperStatusChange` unconditionally in their own prop types; `dawKind` is checked once in `FindingDetail`, so `ReaperControls` and friends stay unaware of DAW kind and unchanged themselves.
- Nothing about `useReaperStatus`'s own REAPER-connectivity polling changes: for a REAPER session it still drives when Go to/Loop are enabled, exactly as before.
