// How to reach each `startup` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import type { Driver } from './shared';

export const startupDrivers: Record<string, Driver> = {
  'invalid-payload': async (page) => {
    // Reload with the mock's invalid-payload seam (see main.tsx): the Bootstrap goes through the real parseWire.
    await page.goto('/?mockInvalidPayload=bootstrap');
    await settlePage(page);
    await page.getByText('The app received data it could not read.').waitFor();
  },
};
