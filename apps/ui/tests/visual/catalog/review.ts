// The `review` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL } from './shared';

export const reviewStates: StateEntry[] = [
  // Review (review-dashboard-and-findings-adoption.prd.md Phase 5)
  {
    page: 'review',
    state: 'default',
    description: 'Review, the latest run of every check in one list with the counts by status, and a prompt to select a finding',
  },
  {
    page: 'review',
    state: 'empty',
    description:
      'Review, a project with no findings at all - "Nothing to review yet" and where findings come from (reached via the ?mockFindings=empty mock seam)',
  },
  {
    page: 'review',
    state: 'filtered',
    description: 'Review, filtered to the Proofing comparison and to findings scored 50% or more - one row left and Clear filters offered',
  },
  {
    page: 'review',
    state: 'filtered-empty',
    description: 'Review, filters that match nothing (Deferred) - "No findings match these filters." with Clear filters in the list',
  },
  {
    page: 'review',
    state: 'detail-open',
    description:
      'Review, a transcript difference selected - what the script says and what was recorded, where, the evidence, the confidence reason, and the decision controls',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'decision-saved',
    description: 'Review, a finding accepted with a note - "Saved as accepted.", its status and time, Reopen offered, and the list and counts updated',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'evidence-changed',
    description:
      'Review, a decision refused because the check ran again since the finding was shown (ADR 0120) - the plain-language alert, the latest version and the typed note kept (reached via the ?mockFindings=changed mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'not-in-latest-run',
    description: 'Review, findings the latest run did not repeat included, and one selected - the "did not find this again" notice over its evidence',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Review in REAPER (review-dashboard-and-findings-adoption.prd.md Phase 7): Go to, Loop and Stop, and why they are off
  {
    page: 'review',
    state: 'reaper-go-to',
    description: 'Review, Go to in REAPER pressed on a transcript difference - REAPER selected its item and the cursor time is announced',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'reaper-looping',
    description: 'Review, Loop in REAPER pressed - the looped window is announced and Stop loop is offered beside Go to and Loop',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'reaper-stale',
    description:
      "Review, Go to refused because the finding's item is no longer in the REAPER project - the plain-language alert, nothing moved (reached via the ?mockReaper=stale mock seam)",
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'reaper-not-running',
    description:
      'Review, REAPER not answering (its heartbeat stopped) - Go to and Loop disabled with the reason under them (reached via the ?mockReaper=not-running mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'reaper-standalone',
    description:
      'Review, the app opened on its own rather than from REAPER - Go to and Loop disabled, and how to connect REAPER (reached via the ?mockReaper=standalone mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // The approved marker (review-dashboard-and-findings-adoption.prd.md Phase 8): one take marker for an accepted finding, after a confirm
  {
    page: 'review',
    state: 'reaper-marker-confirm',
    description:
      'Review, a transcript difference accepted and Add marker in REAPER pressed - the confirm dialog that says what REAPER will add and that one Undo removes it',
  },
  {
    page: 'review',
    state: 'reaper-marker-added',
    description: 'Review, the approved marker confirmed - the take marker REAPER added is announced by name under the REAPER controls',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Pickups and duplicates on the Review page (take-review-pickups-duplicates-take-intelligence.prd.md Phase 5)
  {
    page: 'review',
    state: 'take-review-scan-form',
    description:
      'Review, Find pickups and duplicates pressed - the scan dialog with the track to scan and the optional pickup track or stretch of the timeline (Q3)',
  },
  {
    page: 'review',
    state: 'take-review-scan-progress',
    description:
      "Review, a pickup and duplicate scan running - the sidecar's own percent and stage, the live activity, Cancel and Continue in background (reached via the ?mockTakeReviewScan=running mock seam)",
  },
  {
    page: 'review',
    state: 'take-review-results',
    description: 'Review, a scan of Chapter 1 closed - the list narrowed to take review, one partial pickup and one near duplicate, no ranking column (Q9)',
  },
  {
    page: 'review',
    state: 'take-review-group',
    description:
      'Review, a pickup group selected - every read with its range in its own file, coverage and script match, each with Go to and Loop in REAPER, Audition reads and Add as take (off until accepted)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'take-review-read-looping',
    description: 'Review, Loop pressed on one read of a pickup group - the looped window is announced and Stop loop is offered under the reads',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'take-review-audition',
    description:
      'Review, Audition reads pressed on a pickup group - the side-by-side A/B dialog with the "Raw source, no FX or edits applied" label and Read A/Read B pickers (phase 7, Q7)',
  },
  {
    page: 'review',
    state: 'take-review-add-take',
    description:
      'Review, a pickup group accepted and Add as take pressed - the confirm with the target item and the candidate read chosen by the narrator, never preselected (Q4/Q8)',
  },
  // Take comparison on the Review page (take-review-pickups-duplicates-take-intelligence.prd.md Phase 10)
  {
    page: 'review',
    state: 'take-comparison-progress',
    description:
      "Review, Compare takes pressed on a pickup group - the comparison running with the sidecar's own percent and stage, Cancel and Continue in background (reached via the ?mockTakeComparison=running mock seam)",
  },
  {
    page: 'review',
    state: 'take-comparison',
    description:
      'Review, a take comparison finished and opened - each read of the span word by word, the misread and unreached words marked and listed with their times, each read with Go to and Loop; no ranking (Q9)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'review',
    state: 'take-comparison-measurements',
    description:
      "Review, a take comparison's audio table - clipping, room noise, level, length and pauses, a row each with what it measures and a column per read, an unavailable figure with its reason; nothing adds the rows up",
    ...KEEPS_DESKTOP_SCROLL,
  },
];
