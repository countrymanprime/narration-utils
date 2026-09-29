# 0730. Production draws a figure mock 01 shows only from data the app has, and says so otherwise

**Status:** Accepted (owner ruling 2026-09-29 on [#510](https://github.com/countrymanprime/narration-utils/issues/510); stream N-P1 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-29

## Context

Benchmark mock 01 draws Production with a pace pill, a burndown chart, a "This week" card, Pickups, Master and QC columns on the board, and Open pickups and Delivery check tiles. The owner ruled the missing features are drawn, real chapter names show, and data gaps are accepted; and that [ADR 0320](0320-pfh-and-the-effective-rate-come-only-from-logged-hours-and-measured-recorded-time.md) concerned PFH and the effective rate, not an estimate of the finish, so it does not block the pace pill. Much of what the mock shows has no source in the app: the pickup list is project-wide, the ACX check runs on the mastered package, nothing records booked hours, recorded audio per day or a proofer, and there is no plan to draw a plan line from.

## Decision

- Every element the mock draws is drawn. Where the app cannot back it, it shows a dash and says why in words ("Not counted yet: open Pickups with REAPER running", "No delivery check run yet", "Not measured yet"). It never shows an invented number, and never 0 for an unknown one.
- The board's Prep, Pickups, Master and QC cells are dashes (`BOARD_COLUMNS` in `productionFormat.ts`) until a per-chapter producer exists.
- **Open pickups** is what REAPER last reported (`pickupsState` and the `pickups:state` event, as the rail's badge in [ADR 0725](0725-the-rail-draws-a-count-badge-only-from-a-count-the-host-reports-and-the-product-is-named-studio.md)); Production never asks REAPER to count.
- The **pace pill** is a projection worded as one ("at current pace done Oct 9"). It uses chapters finalized per day since the first logged day, and reads "Pace unknown" and says which input is missing until both exist (`productionPace.ts`). It is not PFH or the effective rate, which stay measured.
- The **chart** draws cumulative hours logged with the delivery date marked, from `productionBurndown`. There is no plan line and no finished-hours history to draw one from.
- **This week** draws the hours logged per day for seven days; Voice rest and Proofer are unknown rows.
- The questions that need the owner (a plan line, booked hours, voice rest, a proofer) are on #510 and are not built.

## Consequences

- Production looks less full than the mock until sources exist, by design; each dash is where a later phase plugs in.
- The pace projection is coarse (a straight rate); a better basis is a change to `paceOf` and this ADR's consequences, not to the UI.
- Match against mock 01 is a diagnostic only (owner rulings D96-D97), so the dashes and wrapped hints cost a little of it and that is accepted.
