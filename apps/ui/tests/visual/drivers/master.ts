// How to reach each `master` state in STATE_CATALOG (see app.drivers.ts).
import {
  type Driver,
  checkOnDiagnostics,
  diagnosticsEnded,
  measurementEnded,
  measureOnMaster,
  openDeliveryFindingOnProof,
  openDiagnostics,
  openMaster,
  pickFilesToMaster,
  scrollToTop,
} from './shared';

const MEASURED = /^Measured 2 of 3 files; 1 could not be measured\./;

export const masterDrivers: Record<string, Driver> = {
  empty: async (page) => {
    await openMaster(page);
    await page.getByText(/^Nothing measured yet/).waitFor();
  },
  'profile-rules': async (page) => {
    await openMaster(page);
    await page.getByRole('button', { name: /^Rules and their sources/ }).click();
    const rules = page.getByRole('table', { name: 'Rules and their sources' });
    await rules.waitFor();
    await scrollToTop(page, page.getByRole('region', { name: 'Delivery profile' }));
  },
  running: async (page) => {
    await measureOnMaster(page, '?mockMeasure=running');
    await page.getByRole('progressbar', { name: 'Measuring' }).waitFor();
    await page.getByText('Measuring Chapter 01.wav (1 of 3).').waitFor();
  },
  measured: async (page) => {
    await measureOnMaster(page);
    await measurementEnded(page, MEASURED);
    await page.getByRole('region', { name: 'Chapter 01.wav · Why it fails' }).waitFor();
  },
  'mock-fidelity-05': async (page) => {
    await measureOnMaster(page, '?mockFidelity=05');
    await measurementEnded(page, /^Measured 6 files\./);
    await page.getByRole('region', { name: '04 The Rabbit Sends in a Little Bill.wav · Why it fails' }).waitFor();
  },
  'file-rules': async (page) => {
    await measureOnMaster(page);
    await measurementEnded(page, MEASURED);
    await page.getByRole('region', { name: 'Chapter 01.wav · Why it fails' }).getByRole('button', { name: 'Every rule' }).click();
    const detail = page.getByRole('table', { name: 'Chapter 01.wav, rule by rule' });
    await detail.waitFor();
    await scrollToTop(page, page.getByRole('region', { name: 'Chapter 01.wav against ACX (September 2026)' }));
  },
  'book-spread': async (page) => {
    await openMaster(page, '?mockMeasure=spread');
    await page.getByRole('table', { name: 'Per-file checks' }).waitFor();
    const consistency = page.getByRole('region', { name: 'Book consistency' });
    await consistency.waitFor();
    await scrollToTop(page, consistency);
  },
  'custom-profile': async (page) => {
    await measureOnMaster(page, '?mockDeliveryProfile=custom');
    await measurementEnded(page, MEASURED);
    await page.getByText(/^Every rule the app checks is met/).waitFor();
  },
  cancelled: async (page) => {
    await measureOnMaster(page, '?mockMeasure=running');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText(/^Measurement cancelled\./).waitFor();
  },
  error: async (page) => {
    await measureOnMaster(page, '?mockMeasure=fails');
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
    await measureOnMaster(page);
    await measurementEnded(page, MEASURED);
    const diagnostics = page.getByRole('region', { name: 'Diagnostics' });
    await diagnostics.getByRole('button', { name: 'Check the 3 measured files' }).click();
    await diagnosticsEnded(page, 'Checked 2 of 3 files; 1 could not be checked.');
    await page.getByRole('table', { name: 'Findings' }).waitFor();
    await scrollToTop(page, diagnostics);
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
    await measureOnMaster(page);
    await measurementEnded(page, MEASURED);
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    await page.getByText(/^Wrote delivery-report-/).waitFor();
    await scrollToTop(page, page.getByRole('region', { name: 'Report' }));
  },
  'report-refused': async (page) => {
    await openMaster(page);
    await page.getByRole('button', { name: 'Export report', exact: true }).click();
    await page
      .getByRole('alert')
      .getByText(/^The report was not written: nothing has been measured or checked/)
      .waitFor();
    await scrollToTop(page, page.getByRole('region', { name: 'Report' }));
  },
  'to-spec-picked': async (page) => {
    await openMaster(page);
    await pickFilesToMaster(page);
    await page.getByRole('button', { name: 'Master & encode' }).waitFor();
    await scrollToTop(page, page.getByRole('region', { name: 'Master to spec' }));
  },
  'to-spec-running': async (page) => {
    await openMaster(page, '?mockRenderExport=running');
    await pickFilesToMaster(page);
    await page.getByRole('button', { name: 'Master & encode' }).click();
    await page.getByRole('progressbar', { name: 'Preparing files' }).waitFor();
    await scrollToTop(page, page.getByRole('region', { name: 'Master to spec' }));
  },
  'outputs-preview': async (page) => {
    await openMaster(page);
    const pkg = page.getByRole('region', { name: 'Delivery package · ACX' });
    await pkg.getByRole('list', { name: 'Files the package will create' }).waitFor();
    await scrollToTop(page, pkg);
  },
  'package-built': async (page) => {
    await openMaster(page);
    await pickFilesToMaster(page);
    await page.getByRole('button', { name: 'Master & encode' }).click();
    await page
      .getByRole('region', { name: 'Master to spec' })
      .getByText(/^Prepared 5 files\./)
      .waitFor({ timeout: 15_000 });
    const pkg = page.getByRole('region', { name: 'Delivery package · ACX' });
    await pkg.getByRole('button', { name: 'Build packages' }).click();
    await pkg.getByText(/^Built the acx package/).waitFor();
    await pkg.getByRole('heading', { name: 'Outputs' }).waitFor();
    // Both jobs' ends raise a toast (job:ended, ADR 0076) that would cover the package; dismiss them, as measurementEnded does.
    const dismiss = page.getByRole('button', { name: 'Dismiss message' });
    while ((await dismiss.count()) > 0) await dismiss.first().click();
    await scrollToTop(page, pkg);
  },
  'from-proof': async (page) => {
    await openDeliveryFindingOnProof(page);
    await page.getByRole('button', { name: 'Open in Master & QC' }).click();
    await page.getByRole('table', { name: 'Chapter 01.wav, rule by rule' }).waitFor();
    // The page scrolls the note and the file's rules into view itself; wait for it to settle there.
    const note = page.getByText('Opened from a note on Proof: sample rate in Chapter 01.wav.');
    await note.waitFor();
    await note.scrollIntoViewIfNeeded();
  },
};
