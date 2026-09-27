// The interaction feedback rows for the production tracking call sites (see interactionFeedback.catalog.ts for what a row says).
import { type FeedbackRow, row } from './row';

// prettier-ignore
export const productionFeedback: Record<string, FeedbackRow> = {
  // Production (production-tracking.prd.md Phase 4)
  'src/components/production/ProductionPage.tsx::productionOverview#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'On opening Production: the figures, the board and Next up; while it reads the page says so, and a failed read is an inline alert in place of the page.'),
  'src/components/production/ProductionPage.tsx::productionOverview#2': row('click', 'file-io', 'none', 'none', 'ui', 'inline', 'na', 'ok', 'Refresh, and the re-read after starting or stopping a timer: the page is redrawn from the new overview; a failed read replaces it with an inline alert.'),
  'src/components/production/ProductionPage.tsx::productionStartTimer#1': row('click', 'file-io', 'pending', 'disabled', 'ui', 'inline', 'yes', 'ok', 'Start timer is busy on its chapter and the other chapters\' buttons are off until it answers; the running-timer bar then names the chapter and stage and every Start timer goes away. A refusal (a timer already running) or a failure is an inline alert in the host words, and nothing is logged.'),
  'src/components/production/ProductionPage.tsx::productionStopTimer#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'yes', 'ok', 'Stop timer is busy until the session is logged, then the bar goes away and a status line names the chapter whose session was logged. A failure is an inline alert and the timer keeps running.'),
};
