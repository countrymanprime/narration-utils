// How to reach each `master` state in STATE_CATALOG (see app.drivers.ts).
import {
  type Driver,
  checkOnDiagnostics,
  openWithoutManuscript,
  diagnosticsEnded,
  measurementEnded,
  measureOnMaster,
  openDiagnostics,
  openMaster,
  pickFilesToMaster,
  panelTitled,
  scrollToTop,
} from './shared';

const MEASURED = /^Measured 2 of 3 files; 1 could not be measured\./;

export const masterDrivers: Record<string, Driver> = {
  empty: async (page) => {
    await openMaster(page);
    await page.getByText(/^Nothing measured yet/).waitFor();
  },
  running: async (page) => {
    await measureOnMaster(page, '?mockMeasure=running');
    await page.getByRole('progressbar', { name: 'Measuring' }).waitFor();
    await page.getByText('Measuring Chapter 01.wav (1 of 3).').waitFor();
  },
  measured: async (page) => {
    await measureOnMaster(page);
    await measurementEnded(page, MEASURED);
    await page.getByRole('heading', { name: 'Chapter 1 — Down the Rabbit-Hole · Why it fails' }).waitFor();
  },
  'file-rules': async (page) => {
    await measureOnMaster(page);
    await measurementEnded(page, MEASURED);
    const detail = page.getByRole('table', { name: 'Chapter 01.wav, rule by rule' });
    await detail.waitFor();
    await scrollToTop(page, panelTitled(page, 'Chapter 01.wav against ACX (September 2026)'));
  },
  'book-spread': async (page) => {
    await openMaster(page, '?mockMeasure=spread');
    await page.getByRole('grid', { name: 'Per-file checks' }).waitFor();
    const consistency = panelTitled(page, 'Book consistency');
    await consistency.waitFor();
    await scrollToTop(page, consistency);
  },
  'custom-profile': async (page) => {
    await measureOnMaster(page, '?mockDeliveryProfile=custom');
    await measurementEnded(page, MEASURED);
    await page.getByTitle('Open Delivery').getByText('My ACX, tighter peak').waitFor();
  },
  cancelled: async (page) => {
    await measureOnMaster(page, '?mockMeasure=running');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('grid', { name: 'Per-file checks' }).getByText('Not measured').first().waitFor();
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
  'report-needs-files': async (page) => {
    await openMaster(page);
    await page.getByText(/^Check some files first: the report covers the files measured here/).waitFor();
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
  'multi-export-empty': async (page) => {
    await openMaster(page);
    const panel = page.getByRole('region', { name: 'Multi-platform export' });
    await panel.waitFor();
    await scrollToTop(page, panel);
  },
  'multi-export-selected': async (page) => {
    await openMaster(page, '?mockDeliveryProfile=custom');
    await pickFilesToMaster(page);
    await page.getByRole('button', { name: 'Master & encode' }).click();
    await page
      .getByRole('region', { name: 'Master to spec' })
      .getByText(/^Prepared 5 files\./)
      .waitFor({ timeout: 15_000 });
    const dismiss = page.getByRole('button', { name: 'Dismiss message' });
    while ((await dismiss.count()) > 0) await dismiss.first().click();
    const panel = page.getByRole('region', { name: 'Multi-platform export' });
    await panel.getByRole('checkbox', { name: 'ACX', exact: true }).click();
    await panel.getByRole('button', { name: 'Build 1 package' }).waitFor();
    await scrollToTop(page, panel);
  },
  'multi-export-running': async (page) => {
    await openMaster(page, '?mockPackageMulti=running');
    await pickFilesToMaster(page);
    await page.getByRole('button', { name: 'Master & encode' }).click();
    await page
      .getByRole('region', { name: 'Master to spec' })
      .getByText(/^Prepared 5 files\./)
      .waitFor({ timeout: 15_000 });
    const dismiss = page.getByRole('button', { name: 'Dismiss message' });
    while ((await dismiss.count()) > 0) await dismiss.first().click();
    const panel = page.getByRole('region', { name: 'Multi-platform export' });
    await panel.getByRole('checkbox', { name: 'ACX', exact: true }).click();
    await panel.getByRole('button', { name: 'Build 1 package' }).click();
    await page.getByRole('progressbar', { name: 'Building packages' }).waitFor();
    await scrollToTop(page, panel);
  },
  'multi-export-results': async (page) => {
    await openMaster(page, '?mockDeliveryProfile=custom');
    await pickFilesToMaster(page);
    await page.getByRole('button', { name: 'Master & encode' }).click();
    await page
      .getByRole('region', { name: 'Master to spec' })
      .getByText(/^Prepared 5 files\./)
      .waitFor({ timeout: 15_000 });
    const dismiss = page.getByRole('button', { name: 'Dismiss message' });
    while ((await dismiss.count()) > 0) await dismiss.first().click();
    const panel = page.getByRole('region', { name: 'Multi-platform export' });
    await panel.getByRole('checkbox', { name: 'ACX', exact: true }).click();
    await panel.getByRole('checkbox', { name: /^My ACX/ }).click();
    await panel.getByRole('button', { name: /^Build 2 packages/ }).click();
    await panel.getByRole('list', { name: 'Multi-platform export results' }).waitFor();
    while ((await dismiss.count()) > 0) await dismiss.first().click();
    await scrollToTop(page, panel);
  },
  'no-manuscript': async (page) => {
    await openWithoutManuscript(page, 'Master & QC');
    await page.getByRole('button', { name: 'Import manuscript' }).waitFor();
  },
};
