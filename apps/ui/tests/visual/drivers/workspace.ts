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
    await openWorkspaceFor(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Next flag');
    await page.getByText('Play from here').waitFor();
  },
  standalone: async (page) => {
    await page.goto('/?mockReaper=standalone');
    await settlePage(page);
    await openWorkspaceFor(page, 'Chapter 1');
    await page.getByText('Check current').waitFor();
  },
};
