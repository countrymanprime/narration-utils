// The `master` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured. Master & QC
// (stage-navigation-and-page-replacement.prd.md Phase 8, mock 05) replaces the Delivery page; each `delivery/*` state is re-keyed
// here, and `delivery/master-qc-empty` went (it was this page's `empty`, now one page).
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL } from './shared';

export const masterStates: StateEntry[] = [
  {
    page: 'master',
    state: 'empty',
    description:
      'Master & QC, nothing measured yet (mock 05) - the ACX platform tab, Master all to spec… and Check files…, the empty per-file checks, the book consistency with no measurements, the built-in chain as three steps, and the delivery package with the book checklist and what it waits on',
  },
  {
    page: 'master',
    state: 'profile-rules',
    description:
      'Master & QC, the delivery profile\'s "Rules and their sources" opened (delivery profiles mockup 01) - every ACX rule with what ACX requires, how the app checks it and a verified, to verify or conflicting-sources mark',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'running',
    description:
      'Master & QC, a check part way through (?mockMeasure=running) - its real progress from the bytes read (ADR 0015), what it is reading, Cancel, and each file waiting or being measured',
  },
  {
    page: 'master',
    state: 'measured',
    description:
      'Master & QC, three files checked against ACX (mock 05) - length, RMS, true peak, noise floor and head / tail per file, the 48 kHz render failed in words as well as colour with "1 to check yourself", a silent render not judged, a file it could not read with why, and "Chapter 01.wav · Why it fails" with its suggested fix beside the book consistency',
  },
  {
    page: 'master',
    state: 'file-rules',
    description:
      "Master & QC, the failing file's Every rule opened (delivery profiles mockup 04) - each rule's result, this file's value, what ACX requires and how that was verified, loudness as information",
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'book-spread',
    description:
      'Master & QC, six chapters already checked against ACX (?mockMeasure=spread, delivery profiles mockup 11) - every file passing, so the panel below the checks is the book consistency alone: RMS, peak and noise floor each as a min-to-max band with a median tick and one tick per chapter',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'custom-profile',
    description:
      'Master & QC judged by a custom profile (?mockDeliveryProfile=custom) - a second platform tab "My ACX, tighter peak" chosen, the package named after it, and every rule the app checks met',
  },
  {
    page: 'master',
    state: 'cancelled',
    description: 'Master & QC, a running check cancelled - "Measurement cancelled.", with every file not yet read saying so',
  },
  {
    page: 'master',
    state: 'error',
    description:
      'Master & QC, a check that broke (?mockMeasure=fails) - the alert asking to choose the files again, the reason on the file it broke on, the files after it not read',
  },
  // Master & QC, Diagnostics (diagnostics-delivery-and-cleanup-tools.prd.md Phase 6): a section below the chain, scrolled to
  {
    page: 'master',
    state: 'diagnostics-empty',
    description:
      'Master & QC / Diagnostics, nothing checked yet - "Rendered chapters" or "Raw recordings", Choose files to check, and every threshold the check uses shown before any finding (ADR 0158)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'diagnostics-running',
    description:
      'Master & QC / Diagnostics, a check part way through (?mockDiagnostics=running) - its real progress from the bytes read (ADR 0015), what it is reading, Cancel, and the source-kind choice locked while it runs',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'diagnostics-findings',
    description:
      'Master & QC / Diagnostics, the checked files diagnosed without picking them again - each file summarised, a file it could not read with why, and each finding with its time, what was measured, the threshold that raised it and the source kind, read-only and unreviewed',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'diagnostics-cancelled',
    description: 'Master & QC / Diagnostics, a running check cancelled - "Diagnostics cancelled.", with every file not yet read saying so',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'diagnostics-error',
    description:
      'Master & QC / Diagnostics, a check that broke (?mockDiagnostics=fails) - the alert asking to choose the files again, the reason on the file it broke on, the files after it not read',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Master & QC, the report export (diagnostics-delivery-and-cleanup-tools.prd.md Phase 7)
  {
    page: 'master',
    state: 'report-exported',
    description:
      'Master & QC with the files checked against ACX, then Export report - the HTML and JSON file names written to narration-utils/delivery, what the report counts, and that it holds file names only (scrolled to the Report panel)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'report-refused',
    description: 'Master & QC, Export report before anything was checked - the host’s refusal as an alert, and nothing written (scrolled to the Report panel)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Master & QC, "Master all to spec…" and the package (render-encode-master.prd.md Phase 5, mock 05)
  {
    page: 'master',
    state: 'to-spec-picked',
    description:
      'Master & QC, Master all to spec… with five files picked and given a role - two chapters (their titles editable), opening and closing credits, a retail sample, Master before encoding on with the built-in chain, and Master & encode',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'to-spec-running',
    description:
      'Master & QC, mastering and encoding part way through (?mockRenderExport=running) - real progress, Cancel, and each file waiting, mastering or encoding',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'package-built',
    description:
      'Master & QC, the ACX package built from the five encoded files (mock 05\'s delivery package) - the packager\'s checklist with every rule included, the OUTPUTS folder and the files written, and "Built the acx package"',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Master & QC, multi-platform export (render-encode-master.prd.md Phase 6): several profiles' packages from one
  // mastered/encoded source, in one action, beside the single-platform Delivery package above
  {
    page: 'master',
    state: 'multi-export-empty',
    description: 'Master & QC, Multi-platform export with nothing checked - a checkbox per delivery platform and "Build 0 packages" disabled',
    sameAs: {
      of: 'master/diagnostics-empty',
      reason:
        'At the desktop viewport height, scrolling the Diagnostics section (left column) into view also brings the Multi-platform export panel (right column) into the same frame on this freshly opened, nothing-done page, so the two captures match; narrower viewports crop differently and the states diverge there.',
      viewports: ['desktop'],
    },
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'multi-export-selected',
    description:
      'Master & QC, Multi-platform export with the files already mastered and encoded and one platform checked (?mockDeliveryProfile=custom for a second platform to choose from) - "Build 1 package" enabled',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'multi-export-running',
    description:
      'Master & QC, a multi-platform build part way through (?mockPackageMulti=running) - the first checked platform Building…, the rest waiting, Cancel, and a progress indicator',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'master',
    state: 'multi-export-results',
    description:
      'Master & QC, a finished multi-platform build (?mockDeliveryProfile=custom, both platforms checked) - a per-profile result row for each: its name, Built, the output folder and how many files it wrote',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Delivery findings on Proof (delivery-platform-profiles.prd.md Phase 9, P12): "Open in Master & QC" lands here
  {
    page: 'master',
    state: 'from-proof',
    description:
      'Master & QC, opened from a delivery finding on Proof - scrolled to that file opened rule by rule, under "Opened from a note on Proof: sample rate in Chapter 01.wav."',
    ...KEEPS_DESKTOP_SCROLL,
  },
];
