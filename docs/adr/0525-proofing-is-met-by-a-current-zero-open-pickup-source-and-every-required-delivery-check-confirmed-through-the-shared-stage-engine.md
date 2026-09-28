# 0525. Proofing is met by a current, zero-open pickup source and every required delivery check, confirmed through the shared stage engine with no proofing-specific confirm code

**Status:** Proposed
**Date:** 2026-09-28
**Supersedes:** none

## Context

`docs/prds/proofing-readiness-signals.prd.md` computes, on read, a tri-state suggestion for whether a chapter's
proofing pass is done: `proofing.pickups` (a roll-up of open items across Transcript Compare, take-review findings and
proofer markers) and `proofing.delivery.<check>` (one per profile metric the narrator has set a limit for). Phases 1-6
built the signals and the Proofing readiness panel (`apps/ui/src/components/proof/ProofingStagePanel.tsx`); Phase 7
("Mark proofing done and close-out", the PRD's last phase) was to route "Mark proofing done" through
`chapter-stage-recommendations.prd.md`'s ("SR") Confirm flow, enabled only when recommended (the PRD's Q14), and make
the signals "callable for a confirmed chapter" so SR can show "evidence changed since you confirmed" with a revert.

The SR PRD is itself already delivered and deleted (steady state:
[Stage recommendations](../architecture/stage-recommendations.md)). Investigating Phase 7 found that
`stages.Service.Confirm`/`Dismiss`/`Revert` (`apps/desktop/internal/stages/service.go`) and the
`StageConfirm`/`StageDismiss`/`StageRevert` bindings are already stage-agnostic, that
`ProofingStagePanel.tsx` already reuses the shared `StageSuggestion`/`StageEvidence` components (Confirm only when
`verdict === 'recommended'`, satisfying Q14 without proofing-specific code), and that
`stages.Service.assess` (`internal/stages/assess.go`) already re-evaluates a live confirmation's *from* stage on every
read to raise the "evidence changed since you confirmed" contradiction and offer Revert - generically, for any
`stages.Provider`. `proofing.SignalProvider.Signals` (`internal/proofing/provider.go`) never branches on
`chapter.Status`; its `Stage()` is the fixed constant `stages.StageProofing`. That is exactly what makes it already
"callable for a confirmed chapter": when `assess` rolls a chapter's status back to `live.From` to re-check what was
confirmed, `stages.Collect` dispatches to the proofing provider purely because `provider.Stage() == StageProofing`,
with no knowledge that the chapter's real, current status is `finalized`. No production code needed to change for
Phase 7's stated scope; what was missing was proof that this holds for the *real* provider, not a fake one -
`internal/stages/service_test.go` exercises the generic mechanism only with a fake `Provider`, and no existing test in
`internal/proofing` or `apps/desktop/bindings_stages_test.go` drove a proofing chapter through the confirm -> new open
pickup -> contradiction -> revert round trip. `internal/proofing/confirm_test.go`
(`TestMarkProofingDoneConfirmsAndCanBeReverted`) now does, against the real `stages.Service` and the real
`SignalProvider`, and passes unmodified.

This ADR is the "proofing-complete definition" the PRD's own Phase 7 scope calls for (open-item semantics, the
source-availability rule, the render-attestation rule), written now that the code and its round-trip test both exist,
so the rule survives the PRD's own deletion (`docs/prds/README.md`'s lifecycle: the PRD is deleted in the PR that
completes its last phase, in favor of steady-state documentation and this ADR).

## Decision

A chapter's `proofing.pickups` signal (`PickupsSignal`, `internal/proofing/pickups.go`) is:

- **`not_met`** if any pickup source (Transcript Compare, take-review, proofer markers) has an open item. Open is
  `unreviewed`, `deferred` or `accepted` (`findings.Status`, PRD D9/Q2); only `dismissed` is not open
  (`PickupItem.Open`). This is checked first and wins over every other state.
- **`unknown`** if no `not_met` item exists but no source is both current and covering the chapter (a source that ran
  is stale, partial, unmapped, or its run judge could not answer), or the chapter's track mapping itself is
  unconfirmed. A source that never ran at all is simply absent, not evidence of anything.
- **`met`** only when at least one source is current, covers the chapter's played items, and has zero open items.
  No source is individually required (PRD Q3): a narrator who proofs only by a human proofer's marker list never
  needs to run Transcript Compare, and vice versa. This is the rule the PRD's Success Metrics table calls "0 false
  done": an empty roll-up (nothing has ever run) is `unknown`, never `met`.

Each `proofing.delivery.<check>` signal (`DeliverySignal`, `internal/proofing/delivery.go`) is `met` only when the
chapter has a current, attested render (`internal/proofing/renders.go`) whose stored `measure.Report` value is inside
the narrator's own `deliveryprofile.Profile` limit for that check; `not_met` when it is outside; `unknown` when the
render is missing, stale, unmeasured or unsupported, or the metric itself is nil/NaN/infinite. A check with no limit
set is not required at all (`SignalProvider.FilterRequired`), so a chapter with no delivery limits configured can
still be recommended on `proofing.pickups` alone. Render attestation (PRD Q9) stores the narrator's own statement -
the chapter items' fingerprint and the render file's fingerprint at the moment they associated it - and a later change
to either invalidates the delivery signals to `unknown`, never silently re-measures or trusts a stale value.

The overall proofing stage is `recommended` (target `finalized`) only when every required signal among these is
`met` - the shared stage engine's own rule (`stages.Evaluate`, `internal/stages/engine.go`), applied with no
proofing-specific override.

**"Mark proofing done" is the shared `StageSuggestion` Confirm button, unchanged.** No new binding, wire contract, or
UI component exists for it: `ProofingStagePanel.tsx` renders the same `StageSuggestion`/`StageEvidence` pair every
other stage consumer does, Confirm shows only when the verdict is `recommended` (Q14), and its accessible name and
the evidence popover's sentence already state the consequence ("Confirm `<chapter>` as Finalized" / "...ready to move
from Proofing to Finalized. Nothing changes until you confirm."). **Proofing signals are "callable for a confirmed
chapter" because `SignalProvider.Signals` never reads `chapter.Status`** - it is fixed to evaluate the proofing rules
above regardless of what stage the chapter is actually in, which is what lets `stages.Service.assess`'s generic
contradiction re-evaluation work for it with zero proofing-specific code. A future proofing signal must preserve this:
it must not special-case the chapter's current status, or the confirmed-chapter re-evaluation silently stops covering
it.

## Consequences

- The proofing-complete rule (open-item semantics, source availability, render attestation) has one authoritative
  home once `docs/prds/proofing-readiness-signals.prd.md` is deleted: this ADR, plus
  `docs/architecture/stage-recommendations.md` (the generic Confirm/Contradiction/Revert mechanism) and
  `docs/utilities/transcript-compare.md` (comparison currency) and `docs/architecture/findings-contract.md` (D9's
  open semantics) for the parts they already owned.
- `internal/proofing/confirm_test.go` is now the regression guard for the confirm -> contradiction -> revert round
  trip specifically for proofing; a future change to `PickupsSignal`, `DeliverySignal` or `SignalProvider.Signals`
  that starts branching on `chapter.Status` will make that test's assumptions wrong in a way its assertions should
  catch (the contradiction stops appearing once the chapter is no longer literally in `proofing`).
- Any future stage that wants its own Confirm button label, or a `chapter.Status`-dependent signal provider, needs a
  new ADR superseding this one - the current shared-engine design deliberately keeps both generic.
