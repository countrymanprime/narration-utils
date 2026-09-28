// The `proof` rows of STATE_CATALOG: Proof's book level, the notes (the `review` page key until stage-navigation-and-page-replacement.prd.md Phase 5) (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL } from './shared';

export const proofStates: StateEntry[] = [
  // Proof's notes (review-dashboard-and-findings-adoption.prd.md Phase 5, restyled as mock 04's notes table by stage navigation Phase 5)
  {
    page: 'proof',
    state: 'default',
    description:
      'Proof, the latest run of every check in one list under mock 04\'s notes header ("Notes · 4", a chip per resolution, Import proofer sheet, Export for proofer), the Sources line, and a prompt to select a finding',
  },
  {
    page: 'proof',
    state: 'empty',
    description:
      'Proof, a project with no findings at all - "Nothing to review yet" and where findings come from (reached via the ?mockFindings=empty mock seam)',
  },
  {
    page: 'proof',
    state: 'filtered',
    description: 'Proof, filtered to Local AI compare and to findings scored 50% or more - one row left and Clear filters offered',
  },
  {
    page: 'proof',
    state: 'filtered-empty',
    description: 'Proof, filters that match nothing (Deferred) - "No findings match these filters." with Clear filters in the list',
  },
  {
    page: 'proof',
    state: 'detail-open',
    description:
      'Proof, a transcript difference selected - mock 04\'s "0:12.4 · Misread" title, Play ±3 s, what the script says and what was recorded, where, the evidence, the confidence reason, and Pickup, Waive and Defer',
    ...KEEPS_DESKTOP_SCROLL,
  },

  {
    page: 'proof',
    state: 'decision-saved',
    description:
      'Proof, a misread marked for a pickup with a note - "Saved: needs a pickup.", its resolution and time, Reopen offered, and the Pickup chip and "1 need pickup" in the list',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'evidence-changed',
    description:
      'Proof, a decision refused because the check ran again since the finding was shown (ADR 0120) - the plain-language alert, the latest version and the typed note kept (reached via the ?mockFindings=changed mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'not-in-latest-run',
    description: 'Proof, findings the latest run did not repeat included, and one selected - the "did not find this again" notice over its evidence',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Review in REAPER (review-dashboard-and-findings-adoption.prd.md Phase 7): Go to, Loop and Stop, and why they are off
  {
    page: 'proof',
    state: 'reaper-go-to',
    description: 'Proof, Go to in REAPER pressed on a transcript difference - REAPER selected its item and the cursor time is announced',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'reaper-looping',
    description: 'Proof, Loop in REAPER pressed - the looped window is announced and Stop loop is offered beside Go to and Loop',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'reaper-stale',
    description:
      "Proof, Go to refused because the finding's item is no longer in the REAPER project - the plain-language alert, nothing moved (reached via the ?mockReaper=stale mock seam)",
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'reaper-not-running',
    description:
      'Proof, REAPER not answering (its heartbeat stopped) - Go to and Loop disabled with the reason under them (reached via the ?mockReaper=not-running mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'reaper-standalone',
    description:
      'Proof, the app opened on its own rather than from REAPER - Go to and Loop disabled, and how to connect REAPER (reached via the ?mockReaper=standalone mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // The approved marker (review-dashboard-and-findings-adoption.prd.md Phase 8): one take marker for an accepted finding, after a confirm
  {
    page: 'proof',
    state: 'reaper-marker-confirm',
    description:
      'Proof, a transcript difference accepted and Add marker in REAPER pressed - the confirm dialog that says what REAPER will add and that one Undo removes it',
  },
  {
    page: 'proof',
    state: 'reaper-marker-added',
    description: 'Proof, the approved marker confirmed - the take marker REAPER added is announced by name under the REAPER controls',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Pickups and duplicates on Proof (take-review-pickups-duplicates-take-intelligence.prd.md Phase 5)
  {
    page: 'proof',
    state: 'take-review-scan-form',
    description:
      'Proof, Find pickups and duplicates pressed - the scan dialog with the track to scan and the optional pickup track or stretch of the timeline (Q3)',
  },
  {
    page: 'proof',
    state: 'take-review-scan-progress',
    description:
      "Proof, a pickup and duplicate scan running - the sidecar's own percent and stage, the live activity, Cancel and Continue in background (reached via the ?mockTakeReviewScan=running mock seam)",
  },
  {
    page: 'proof',
    state: 'take-review-results',
    description: 'Proof, a scan of Chapter 1 closed - the list narrowed to take review, one partial pickup and one near duplicate, no ranking column (Q9)',
  },
  {
    page: 'proof',
    state: 'take-review-group',
    description:
      'Proof, a pickup group selected - every read with its range in its own file, coverage and script match, each with Go to and Loop in REAPER, Audition reads and Add as take (off until accepted)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'take-review-read-looping',
    description: 'Proof, Loop pressed on one read of a pickup group - the looped window is announced and Stop loop is offered under the reads',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'take-review-audition',
    description:
      'Proof, Audition reads pressed on a pickup group - the side-by-side A/B dialog with the "Raw source, no FX or edits applied" label and Read A/Read B pickers (phase 7, Q7)',
  },
  {
    page: 'proof',
    state: 'take-review-add-take',
    description:
      'Proof, a pickup group accepted and Add as take pressed - the confirm with the target item and the candidate read chosen by the narrator, never preselected (Q4/Q8)',
  },
  // Take comparison on Proof (take-review-pickups-duplicates-take-intelligence.prd.md Phase 10)
  {
    page: 'proof',
    state: 'take-comparison-progress',
    description:
      "Proof, Compare takes pressed on a pickup group - the comparison running with the sidecar's own percent and stage, Cancel and Continue in background (reached via the ?mockTakeComparison=running mock seam)",
  },
  {
    page: 'proof',
    state: 'take-comparison',
    description:
      'Proof, a take comparison finished and opened - each read of the span word by word, the misread and unreached words marked and listed with their times, each read with Go to and Loop; no ranking (Q9)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof',
    state: 'take-comparison-measurements',
    description:
      "Proof, a take comparison's audio table - clipping, room noise, level, length and pauses, a row each with what it measures and a column per read, an unavailable figure with its reason; nothing adds the rows up",
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Delivery findings on Proof (delivery-platform-profiles.prd.md Phase 9, P12)
  {
    page: 'proof',
    state: 'delivery-finding',
    description:
      "Proof, after a measurement on the Delivery page - its missed and unmeasurable rules listed as Delivery checks by file, one opened: the rule, ACX's requirement, the value measured and the profile that judged it, Open in Delivery in place of Show in Script, and the same decision controls as every finding",
    ...KEEPS_DESKTOP_SCROLL,
  },
];
