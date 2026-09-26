// The `delivery` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL } from './shared';

export const deliveryStates: StateEntry[] = [
  // Delivery (diagnostics-delivery-and-cleanup-tools.prd.md Phase 5), judged against a delivery profile (delivery-platform-profiles.prd.md Phase 3)
  {
    page: 'delivery',
    state: 'empty',
    description:
      'Delivery, nothing measured yet - the project judged against ACX (September 2026), built in and read-only, with how many rules the app checks, does not check, leaves to listening and has yet to verify (ADR 0179), and Choose files to measure',
  },
  {
    page: 'delivery',
    state: 'profile-rules',
    description:
      'Delivery, the profile\'s "Rules and their sources" opened (mockup 01) - every ACX rule with what ACX requires, how the app checks it (measured, not checked by the app, listen) and a verified, to verify or conflicting-sources mark',
  },
  {
    page: 'delivery',
    state: 'running',
    description:
      'Delivery, a measurement part way through (?mockMeasure=running) - its real progress from the bytes read (ADR 0015), what it is reading, Cancel, and each file waiting or being measured',
  },
  {
    page: 'delivery',
    state: 'measured',
    description:
      'Delivery, three picked files measured against ACX (mockup 03) - a column per rule with its bound, the 48 kHz render not met on sample rate in words as well as colour, room tone and the MP3 "Not checked", a silent render whose levels are "Not measurable", a file it could not read with why, and each file\'s result counted',
  },
  {
    page: 'delivery',
    state: 'file-rules',
    description:
      "Delivery, a measured file opened rule by rule (mockup 04) - each rule's result, this file's value, what ACX requires and how that was verified, loudness as information",
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'delivery',
    state: 'custom-profile',
    description:
      'Delivery judged by a custom profile (?mockDeliveryProfile=custom, mockup 07) - "My ACX, tighter peak", custom and based on ACX, two rules off, and every rule the app checks met',
  },
  {
    page: 'delivery',
    state: 'cancelled',
    description: 'Delivery, a running measurement cancelled - "Measurement cancelled.", with every file not yet read saying so',
  },
  {
    page: 'delivery',
    state: 'error',
    description:
      'Delivery, a measurement that broke (?mockMeasure=fails) - the alert asking to choose the files again, the reason on the file it broke on, the files after it not read',
  },
  // Delivery, Diagnostics tab (diagnostics-delivery-and-cleanup-tools.prd.md Phase 6)
  {
    page: 'delivery',
    state: 'diagnostics-empty',
    description:
      'Delivery / Diagnostics, nothing checked yet - "Rendered chapters" or "Raw recordings", Choose files to check, and every threshold the check uses shown before any finding (ADR 0158)',
  },
  {
    page: 'delivery',
    state: 'diagnostics-running',
    description:
      'Delivery / Diagnostics, a check part way through (?mockDiagnostics=running) - its real progress from the bytes read (ADR 0015), what it is reading, Cancel, and the source-kind choice locked while it runs',
  },
  {
    page: 'delivery',
    state: 'diagnostics-findings',
    description:
      'Delivery / Diagnostics, the measured files checked without picking them again - each file summarised (pacing not available without transcript timing), a file it could not read with why, and each finding with its time, what was measured, the threshold that raised it and the source kind, read-only and unreviewed',
  },
  {
    page: 'delivery',
    state: 'diagnostics-cancelled',
    description: 'Delivery / Diagnostics, a running check cancelled - "Diagnostics cancelled.", with every file not yet read saying so',
  },
  {
    page: 'delivery',
    state: 'diagnostics-error',
    description:
      'Delivery / Diagnostics, a check that broke (?mockDiagnostics=fails) - the alert asking to choose the files again, the reason on the file it broke on, the files after it not read',
  },
  // Delivery, the report export (diagnostics-delivery-and-cleanup-tools.prd.md Phase 7)
  {
    page: 'delivery',
    state: 'report-exported',
    description:
      'Delivery with the files measured against ACX, then Export report - the HTML and JSON file names written to narration-utils/delivery, what the report counts, and that it holds file names only (scrolled to the Report panel)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'delivery',
    state: 'report-refused',
    description: 'Delivery, Export report before anything was measured - the host’s refusal as an alert, and nothing written',
  },
];
