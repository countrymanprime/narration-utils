# 0407. A new page replaces its old counterpart in the same change, and the navigation is grouped by production stage

**Status:** Proposed
**Date:** 2026-09-27

## Context

The [audiobook studio benchmark](../research/audiobook-studio-benchmark.md#3-what-the-ideal-looks-like-concept-mocks) drew seven concept mocks around a navigation grouped by production stage (Production, Prep, Record, Review, Finish, then Settings) and a top bar that always shows the audio engine ("REAPER linked" or "Built-in recorder"). The owner approved those mocks as the build spec (D69, 2026-09-27), and the benchmark PRDs started building their pages: production tracking's Production page, booth mode's `BoothView`, the chapter workspace, render-encode-master's Master & QC panel.

Each of those PRDs was written to add its page **beside** the page it overlaps: the Production page beside Home (production tracking P4, PR #760 adds a `/production` route and a nav entry and leaves Home as it is), the booth as a second entry point beside the Read Aloud dialog and the Teleprompter page (booth mode Q1 A: "lets a narrator who prefers the normal dialog keep using it"), the chapter workspace beside Tracks and Proofing until a late consolidation phase (edit-and-proof-workspace EP13, P10). Left alone, the app would carry two versions of Home, three ways to read aloud and two players, each needing its visual rows, aria snapshots, guide pages and fixes kept in step.

On 2026-09-27 the owner decided against that (D79 on #509): "the 'booth' page basically replaces the teleprompter page so i don't want to maintain 2 different versions and have dev slowed down by doing so - same with other pages."

## Decision

1. **A new page replaces its old counterpart in the same pull request.** The pull request that lands a replacement page also deletes the old page, its route (a `<Navigate replace>` redirect from the old path to the new one takes its place, carrying the hash and query), its nav item, its rows in `apps/ui/tests/visual/state-catalog.ts` and `app.drivers.ts`, its aria snapshots, its stories, its guide page under `docs/guides/using-the-app/`, its doc screenshots under `docs/images/ui/`, and any component, hook or test that nothing else imports. There is never a period on `main` with both versions reachable, and no setting, toggle or "classic view" chooses between them.
2. **A component the new page keeps moves; it is not copied.** Where the replacement reuses part of the old page (the teleprompter session, the reader's paragraph renderer, the findings list, the delivery tables), the file moves to the new page's feature folder or stays where it is and is imported, and the old page's copy never lives on.
3. **The navigation is grouped by stage.** `AppShell.tsx`'s `NAV` becomes a list of groups: **Production**, **Prep**, **Record**, **Review** and **Finish**, with Settings pinned at the foot. A page's nav item sits in the group of the stage it serves, and a new page names its group in its PRD. On the wide rail the group names are text labels; on the icon-only rail and in the drawer they are dividers with the group name as the accessible name. The groups are drawn with the existing `NavButton` and `NavDrawer` primitives and the `section-label` style; no new primitive.
4. **The top bar is one design.** From the left: the drawer button (below `md`), Back and Forward, the project name (and, once a project belongs to a series, its series chip), then, on the right, a running-timer chip while a stage timer runs, the zoom group, and the **engine chip**. The engine chip replaces the REAPER link pill, keeps its link action and its three states (linked, wrong project open, not linked) and adds a fourth, "Built-in recorder", which the UI can draw but which nothing selects until native recording is built.
5. **Not every mock nav item becomes a page.** A nav item exists only for a page that exists. The mocks' Schedule, Pickups and Delivery items are covered by [Stage Navigation and Page Replacement](../prds/stage-navigation-and-page-replacement.prd.md): Pickups is a page of its own, Schedule stays Production's plan panel and Delivery stays the package panel of Master & QC until either needs a page.

## Consequences

- Each page has one set of visual rows, aria snapshots, stories and guide text to keep current, so a fix is made once, and the visual suite stops paying for states nobody will ship.
- A replacement phase is larger than an "add a page" phase: it carries the deletion, the redirect, every inbound link and the doc screenshots. The PRD cuts one phase per replacement so each stays reviewable.
- Every replacement touches `AppShell.tsx` and `App.tsx`, which are serial points ([agent train](../operations/agent-train.md#serial-points)), so replacements merge one at a time even when their page code is file-disjoint and was written in parallel.
- A narrator who preferred an old page's layout loses it. The owner accepted that trade in D79; a missed capability is a defect against the new page, fixed there, not a reason to keep the old one.
- Old URLs keep working through redirects, so deep links in findings, guide pages and the host's own links still land. A redirect is removed only by a later ADR.
- A future PRD that wants two versions of a page side by side (an A/B trial, a "classic" option) needs a new ADR superseding this one.
