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
    await page.getByText(/^Due 30 Sep/).waitFor();
  },
};
