# 0665. Master's rule marks compose StatusBadge; `warn` and `muted` keep their outline look

**Status:** Proposed (Phase 14 of the mock fidelity PRD, stream F-P14 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** none (`RuleBadges.tsx`'s five-tone `Mark` had no ADR of its own; [ADR 0600](0600-every-pill-tag-and-status-dot-is-one-badge-primitive-with-a-pill-a-tag-and-a-booth-shape.md) is extended to cover it)

## Context

`master/RuleBadges.tsx`'s `Mark` (used by `ResultMark`, `VerificationMark`, `PerFileChecks`' old Result cell, `DiagnosticsSection` and by `settings/DeliveryProfilesPanel` and `DeliveryProfileEditor`'s "Built in"/"Custom" tags) drew its own hand-rolled `rounded-full` span with a local five-tone palette (`ok`, `danger`, `info`, `warn`, `muted`), predating `StatusBadge` (ADR 0600, Phase 2). Three of its tones (`ok`, `danger`, `info`) filled a 12%-tinted background; the other two (`warn`, `muted`) drew no fill, an outline only. The mock fidelity PRD's Phase 14 scope ("`RuleBadges`' `Mark` becomes `StatusBadge`") asks Master to stop maintaining a second badge system.

## Decision

`Mark`'s tones map onto `StatusBadge`'s `StatusTone` and `shape="pill"` (the closest existing shape to `Mark`'s own `rounded-full` chip):

| `Mark` tone | `StatusTone` | `look` |
| --- | --- | --- |
| `ok` | `success` | `soft` |
| `danger` | `danger` | `soft` |
| `info` | `info` | `soft` |
| `warn` | `warning` | `outline` |
| `muted` | `neutral` | `outline` |

`warn` and `muted` keep the outline look their tinted fill never had, so `VerificationMark`'s "To verify" and "Conflicting sources" and the delivery profile panels' "Built in"/"Custom" tags are visually unchanged apart from moving onto the shared badge metrics (`StatusBadge`'s pill padding and gap, not `Mark`'s own). `ResultIcon` (the bare icon used by `BookChecklist` and `DeliveryPackagePanel`'s checklists) moves from 14 px (`size-3.5`) to 16 px, the mock's measured round checklist icon (mock 05), and reads its colour from `toneColors(StatusTone)` instead of the deleted local palette.

`Mark`'s own signature (`tone`, `icon?: IconDefinition`, `children: string`) is unchanged, so every call site keeps working unedited.

## Consequences

- `RuleBadges.tsx` no longer draws a badge look of its own; `badgeShapes.test.ts`'s Phase 14 allowances (`RuleBadges.tsx`, `MasteringChain.tsx`, `BookConsistency.tsx`) are removed rather than lowered, since each is now zero.
- `settings/DeliveryProfilesPanel.tsx` and `DeliveryProfileEditor.tsx` need no edit (unchanged per the PRD's own note), since `Mark`'s call signature didn't change.
- A future tone or look for `Mark` is a change to this table and a new ADR superseding this one.
