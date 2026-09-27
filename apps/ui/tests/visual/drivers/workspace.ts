// How to reach each `workspace` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, clickVisible, openWorkspaceFor } from './shared';

export const workspaceDrivers: Record<string, Driver> = {
  never: async (page) => {
    // Chapter 7 has no recordedFraction in the fixture (mockFixtures.ts: only chapters 1-6 do), so it reads "never checked".
    await openWorkspaceFor(page, 'Chapter 7');
    await page.getByText(/hasn.t been checked yet/).waitFor();
  },
  stale: async (page) => {
    // ?mockCoverage=stale marks Chapter 4's check stale (main.tsx).
    await page.goto('/?mockCoverage=stale');
    await settlePage(page);
    await openWorkspaceFor(page, 'Chapter 4');
    await page.getByText('Check stale').waitFor();
  },
  current: async (page) => {
    await openWorkspaceFor(page, 'Chapter 1');
    await page.getByText('Check current').waitFor();
  },
  playing: async (page) => {
    await openWorkspaceFor(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Play');
    await page.getByRole('button', { name: 'Pause' }).waitFor();
  },
  'flag-selected': async (page) => {
    // ?mockCoverage=pickups replaces the default findings seed with one scoped to Chapter 4 (main.tsx), so Chapter
    // 1's own misread flag here carries no finding - a plain, read-only flag straight from the check's alignment
    // (Phase 2), distinct from flag-finding-open below (the same flag, Phase 4's default seed, finding-backed).
    await page.goto('/?mockCoverage=pickups');
    await settlePage(page);
    await openWorkspaceFor(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Next flag');
    await page.getByText('Play from here').waitFor();
  },
  // edit-and-proof-workspace.prd.md Phase 4: Chapter 1's mock seeds a transcript_discrepancy finding at the same
  // misread the check already flags (mockApi.ts's workspaceOverlayFinding), so "Next flag" selects the one flag on
  // this chapter and it is finding-backed - the "From"/Decision section shown here is the merge, not a second flag.
  'flag-finding-open': async (page) => {
    await openWorkspaceFor(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Next flag');
    await page.getByText('Decision', { exact: true }).waitFor();
  },
  'flag-decided': async (page) => {
    await openWorkspaceFor(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Next flag');
    await clickVisible(page, 'button', 'Accept');
    await page.getByText('Saved as accepted.').waitFor();
  },
  standalone: async (page) => {
    await page.goto('/?mockReaper=standalone');
    await settlePage(page);
    await openWorkspaceFor(page, 'Chapter 1');
    await page.getByText('Check current').waitFor();
    // Phase 3: Go to/Loop are disabled once useReaperStatus's first poll answers 'standalone'.
    await page.getByRole('button', { name: 'Go to in REAPER' }).waitFor();
  },
};
