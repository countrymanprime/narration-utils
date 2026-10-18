// How to reach each `project` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import type { Driver } from './shared';

export const projectDrivers: Record<string, Driver> = {
  'picker-empty': async (page) => {
    // Reload with the mock's no-project boot seam (see main.tsx) instead
    // of an init-script - the outer loop's default `page.goto('/')` has
    // already happened by the time a driver runs, so this simply
    // re-navigates before settling.
    await page.goto('/?mockNoProject=1');
    await settlePage(page);
  },
  'new-project-dialog': async (page) => {
    await page.goto('/?mockNoProject=1');
    await settlePage(page);
    await page.getByRole('button', { name: 'Create new…' }).click();
    await page.getByRole('dialog', { name: 'New Project' }).getByText('C:/Users/Mock/NarrationStudio').waitFor();
  },
};
