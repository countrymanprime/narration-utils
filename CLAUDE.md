# Working in this repo

## Visual bug fixes require screenshot verification

When fixing a visual/UI bug in `shared/ui`, do not consider it done from code review or a single manual screenshot alone. Before reporting a visual fix as complete:

1. Run the Playwright visual suite for the affected page/state across all viewports in `shared/ui/tests/visual/viewports.ts` (desktop, small-desktop, tablet, mobile):
   ```bash
   cd shared/ui
   npx playwright test tests/visual/app.spec.ts -g "<page>.*<state>"
   ```
2. Open and actually look at the generated PNGs under `shared/ui/screenshots/app/<page>/<state>/<viewport>.png` for every viewport — not just the one you eyeballed live in a browser pane. A fix that looks right at one width is not verified.
3. If the bug is about responsive/layout behavior specifically, check it at every viewport in that list, since "responsive" bugs routinely only reproduce below/above one specific breakpoint.

`shared/ui/screenshots/` is gitignored — these are scratch verification artifacts, not committed output.
