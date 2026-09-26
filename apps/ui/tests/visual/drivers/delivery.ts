// How to reach each `delivery` state in STATE_CATALOG (see app.drivers.ts).
import { type Driver, checkOnDiagnostics, diagnosticsEnded, measurementEnded, measureOnDelivery, openDelivery, openDiagnostics } from './shared';

export const deliveryDrivers: Record<string, Driver> = {
  empty: async (page) => {
    await openDelivery(page);
    await page.getByText(/^Nothing measured yet/).waitFor();
  },
  running: async (page) => {
    await measureOnDelivery(page, '?mockMeasure=running');
    await page.getByRole('progressbar', { name: 'Measuring' }).waitFor();
    await page.getByText('Measuring Chapter 01.wav (1 of 3).').waitFor();
  },
  measured: async (page) => {
    await measureOnDelivery(page);
    await measurementEnded(page, /^Measured 2 of 3 files; 1 could not be measured\./);
    await page.getByText(/^1 rule not met in 1 file/).waitFor();
  },
  'profile-rules': async (page) => {
    await openDelivery(page);
    await page.getByRole('button', { name: /^Rules and their sources/ }).click();
    await page.getByRole('table', { name: 'Rules and their sources' }).waitFor();
  },
  'file-rules': async (page) => {
    await measureOnDelivery(page);
    await measurementEnded(page, /^Measured 2 of 3 files; 1 could not be measured\./);
    await page.getByRole('table', { name: 'Measurements' }).getByRole('row').filter({ hasText: 'Chapter 01.wav' }).click();
    const detail = page.getByRole('table', { name: 'Chapter 01.wav, rule by rule' });
    await detail.waitFor();
    await detail.scrollIntoViewIfNeeded();
  },
  'custom-profile': async (page) => {
    await measureOnDelivery(page, '?mockDeliveryProfile=custom');
    await measurementEnded(page, /^Measured 2 of 3 files; 1 could not be measured\./);
    await page.getByText(/^Every rule the app checks is met/).waitFor();
  },
  cancelled: async (page) => {
    await measureOnDelivery(page, '?mockMeasure=running');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText(/^Measurement cancelled\./).waitFor();
  },
  error: async (page) => {
    await measureOnDelivery(page, '?mockMeasure=fails');
    await measurementEnded(page, /^The measurement stopped unexpectedly\. Choose/);
  },
  'diagnostics-empty': async (page) => {
    await openDiagnostics(page);
    await page.getByText(/^Nothing checked yet/).waitFor();
  },
  'diagnostics-running': async (page) => {
    await checkOnDiagnostics(page, '?mockDiagnostics=running');
    await page.getByRole('progressbar', { name: 'Checking' }).waitFor();
    await page.getByText('Checking Chapter 01.wav (1 of 3).').waitFor();
  },
  'diagnostics-findings': async (page) => {
    await measureOnDelivery(page);
    await measurementEnded(page, /^Measured 2 of 3 files; 1 could not be measured\./);
    await page.getByRole('tab', { name: 'Diagnostics' }).click();
    await page.getByRole('button', { name: 'Check the 3 measured files' }).click();
    await diagnosticsEnded(page, 'Checked 2 of 3 files; 1 could not be checked.');
    await page.getByRole('table', { name: 'Findings' }).waitFor();
  },
  'diagnostics-cancelled': async (page) => {
    await checkOnDiagnostics(page, '?mockDiagnostics=running');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText(/^Diagnostics cancelled\./).waitFor();
  },
  'diagnostics-error': async (page) => {
    await checkOnDiagnostics(page, '?mockDiagnostics=fails');
    await diagnosticsEnded(page, /^The diagnostics stopped unexpectedly\. Choose/);
  },
  'report-exported': async (page) => {
    await measureOnDelivery(page);
    await measurementEnded(page, /^Measured 2 of 3 files; 1 could not be measured\./);
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    await page.getByText(/^Wrote delivery-report-/).waitFor();
    await page.getByRole('region', { name: 'Report' }).scrollIntoViewIfNeeded();
  },
  'report-refused': async (page) => {
    await openDelivery(page);
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText(/^The report was not written: nothing has been measured or checked/)
      .waitFor();
  },
};
