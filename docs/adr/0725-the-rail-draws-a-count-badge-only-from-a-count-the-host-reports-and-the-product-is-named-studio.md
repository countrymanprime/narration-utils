# 0725. The rail draws a count badge only from a count the host reports, and the product is named Studio

**Status:** Accepted (owner ruling 2026-09-29 on the brand name; stream N-B61 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-29

## Context

The benchmark mocks draw the rail's brand as "NARRATION / STUDIO" and put count pills on Story Bible ("3"), Proof ("14") and Pickups ("9"). The app said "Console" and drew no pills, although `NavButton` already had a `count` prop that nothing passed (visual audit SH5, SH11). The owner ruled that the nav reads "Studio", and that a badge is drawn only from data the app really has: a number is never invented.

## Decision

- The brand line in `AppShell.tsx` reads **Studio**.
- `useNavCounts` (`components/layout/useNavCounts.ts`) reads the three counts from bindings that already exist and are already schema-checked, on every page move, and `AppShell` passes them to `NavButton`'s `count`:
  - Story Bible: the number of open pronunciation queries (`guidePronunciationQueries`), read only once there is a manuscript.
  - Proof: the notes still to review (`findingsSummary().unreviewed`), the number the Proof page's own "to review" chip shows.
  - Pickups: `pickupsState().remaining` and the `pickups:state` event, that is, what REAPER last reported. The hook never calls `pickupsCount`, so drawing the rail never talks to REAPER.
- A failed read, or a count of zero, draws **no** badge. There is no placeholder and no cached number.
- The badge is spoken with the name ("Proof, 4") on the wide rail. The icon rail keeps the plain name and draws no badge.
- The header is unchanged. Its geometry already matches the mocks; the series chip, "following Ch N" and (outside a running stage) the timer need data the app doesn't have, and are questions on [#510](https://github.com/countrymanprime/narration-utils/issues/510).

## Consequences

- Three cheap reads per page move, none of them touching REAPER or a file the page hasn't already read.
- The Pickups badge is empty until a count has run (Pickups page, Booth companion or a recording check), as the count is REAPER's to give.
- A wire or contract change to any of the three bindings changes the rail, and `useNavCounts.test.tsx` and the navigation aria snapshots are where that shows.
- The badge numbers in the mock backend are the mock backend's, not the mocks' sample data (13, 4 rather than 3, 14); sample data is not changed to match.
