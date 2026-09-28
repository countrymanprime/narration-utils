// How to reach each `production` state in STATE_CATALOG (see app.drivers.ts).
import { type Driver, openProduction } from './shared';

export const productionDrivers: Record<string, Driver> = {
  'no-data': async (page) => {
    await openProduction(page);
    await page.getByText('No delivery date set yet').waitFor();
  },
  'on-pace': async (page) => {
    await openProduction(page, '?mockProduction=on-pace');
    await page.getByRole('status', { name: 'Timer running' }).waitFor();
  },
  'at-risk': async (page) => {
    await openProduction(page, '?mockProduction=at-risk');
    await page.getByText(/^Due 29 Sep/).waitFor();
  },
  plan: async (page) => {
    await openProduction(page, '?mockProduction=on-pace');
    const panel = page.getByRole('region', { name: 'Delivery plan' });
    await panel.getByRole('button', { name: 'Add the ACX 15-minute checkpoint' }).click();
    await panel.getByRole('list', { name: 'Milestones' }).waitFor();
    await panel.scrollIntoViewIfNeeded();
  },
  'status-report': async (page) => {
    await openProduction(page, '?mockProduction=on-pace');
    await page.getByRole('button', { name: 'Export status report' }).click();
    await page.getByText(/^Wrote production-status-/).waitFor();
    await page.getByRole('region', { name: 'Status report' }).scrollIntoViewIfNeeded();
  },
};
