// The `production` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { TOOLTIP_CLOSES_ON_RESIZE, KEEPS_DESKTOP_SCROLL, LIVE_PROGRESS_MOVES_ON, TOAST_FADES_OUT } from './shared';

export const productionStates: StateEntry[] = [
  // The Production home at `/` (production-tracking.prd.md Phase 4, stage-navigation-and-page-replacement.prd.md Phase 2, mock 01)
  {
    page: 'production',
    state: 'no-data',
    description:
      "Production before anything is logged or set - every undefined figure a dash with why (no measured time, no contracted amount, no delivery date), the chapter pipeline from the chapters' statuses and stage suggestions with Prep and Delivery a dash (PR10), and Next up with Start timer",
  },
  {
    page: 'production',
    state: 'on-pace',
    description:
      'Production with a time log, a delivery date 18 days out and a contracted amount (?mockProduction=on-pace) - hours by stage, PFH and the effective rate from logged hours and measured audio only, the running timer on Chapter 6 with Stop timer, and no Start timer while it runs',
  },
  // mock-fidelity-primitives-and-components.prd.md Phase 11: benchmark mock 01's own data (Q5), the state the pixel-match tool scores.
  {
    page: 'production',
    state: 'mock-fidelity-01',
    description:
      "Production drawn with benchmark mock 01's data (?mockFidelity=01) - chapters 1-4 finished, 5 in proof, 6 in edit, 7 being recorded with the timer on it (its row bold), the mock's hours and delivery date - the one-card figures, the flush Chapter pipeline with its board cells beside Next up, the state mock 01 is scored against",
  },
  {
    page: 'production',
    state: 'at-risk',
    description:
      'Production 3 days from its delivery date with chapters unfinished (?mockProduction=at-risk) - the delivery date as a warning, a higher PFH from more hours logged, and Next up led by the chapters whose stage is held back',
  },
  {
    page: 'production',
    state: 'plan',
    description:
      "Production's Delivery plan panel (?mockProduction=on-pace) with the ACX 15-minute checkpoint added from its template and not saved yet - the delivery date and contracted amount the figures use, each milestone's name, due date and note with Remove, and the template button off once the checkpoint is listed",
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Status report export (production-tracking.prd.md Phase 5)
  {
    page: 'production',
    state: 'status-report',
    description:
      'Production (?mockProduction=on-pace) after Export status report - the HTML and JSON file names written to narration-utils/production/reports, and that the contracted amount and effective rate were left out (scrolled to the Status report panel)',
    ...KEEPS_DESKTOP_SCROLL,
  },

  // Home's surfaces, opened from the board (stage-navigation-and-page-replacement.prd.md Phase 2)
  {
    page: 'production',
    state: 'no-manuscript',
    description:
      'Production with no imported manuscript (?mockNoManuscript=1): the page is the import - "No imported manuscript" with Import manuscript, and no figures or board (stage-navigation-and-page-replacement.prd.md Phase 2, which replaced Home)',
  },
  // chapter-track-link-control.prd.md Phase 2: the track slide-over, from a chapter's Recorded cell (mockups/chapter-track-link-control/).
  // The renamed state (04) has no host or mock simulation yet (nothing records a track's name at confirm time to compare
  // against), so it is not captured here.
  {
    page: 'production',
    state: 'chapter-track-panel-linked',
    description:
      'Production, chapter track panel open on a confirmed link, showing its facts and how it was found (?mockChapterLink=confirmed, mockups/chapter-track-link-control/02-slideover-linked.webp)',
  },
  {
    page: 'production',
    state: 'chapter-track-panel-ambiguous',
    description:
      'Production, chapter track panel open on a chapter confirmed to two tracks at once, offering to keep one (?mockChapterLink=ambiguous, TL6, mockups/chapter-track-link-control/03-slideover-ambiguous.webp)',
  },
  {
    page: 'production',
    state: 'chapter-track-panel-missing',
    description:
      'Production, chapter track panel open on a confirmed link whose track is no longer in the project (?mockChapterLink=missing, mockups/chapter-track-link-control/05-slideover-track-missing.webp)',
  },
  {
    page: 'production',
    state: 'chapter-remove-confirm',
    description:
      'Production, "Remove from recording?" open from a chapter\'s track slide-over (chapter-track-link-control.prd.md Phase 3, mockup 06-remove-from-recording-confirm.webp)',
  },
  {
    page: 'production',
    state: 'chapter-removed-list',
    description:
      'Production, the board with the last narration chapter already removed from recording, listed under it with Restore (?mockRemoved=1, mockup 07-removed-from-recording-list.webp)',
    // The list is under the board: on the first screen beside Next up at 1440 px, below it when Next up stacks above the board.
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'production',
    state: 'chapter-track-no-project',
    description:
      'Production, the board with no REAPER project found: the line above it names why, and every Recorded cell reads No project (TL7, ?mockNoRpp=1, mockups/chapter-track-link-control/08-no-project-line.webp)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'production',
    state: 'chapter-sync-toast-undo',
    description:
      'Production, the toast for a chapter-sync batch that just linked a track, with Undo (?mockChapterSync=linked, daw-chapter-track-auto-sync.prd.md Phase 3, S12, mockups/daw-chapter-track-auto-sync/03-auto-linked-toast-undo.webp)',
    ...TOAST_FADES_OUT,
  },
  {
    page: 'production',
    state: 'info-tooltip',
    description: 'Production, "About these figures" beside the subtitle: time is logged only while a timer runs, and every figure is measured or logged',
    pointer: 'keep',
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },
  { page: 'production', state: 'manuscript-candidate-offer', description: 'Production, offer to import a manuscript file found in the project folder' },
  {
    page: 'production',
    state: 'credits-setup-dialog',
    description:
      'Production, "Set up the credits" dialog (credits-token-setup-and-front-matter-detection.prd.md Phase 2, CS1 C / D35, ?mockCredits=setup): Title and Author prefilled from the detected front matter with their source captions, Narrator empty with "Use for all my projects" checked (CS7 B) since no global default is set, "Don\'t ask for this project" alongside Not now and Save (mockups/credits-token-setup-and-front-matter-detection/01b-alt-setup-dialog-narrator-empty.webp)',
  },
  {
    page: 'production',
    state: 'credits-setup-dialog-narrator-default',
    description:
      'Production, "Set up the credits" dialog when the narrator token already has a value (?mockCredits=setup-narrator-default): only Title and Author are asked, with no Narrator field or checkbox - the state a returning narrator with a saved default sees',
  },
  {
    page: 'production',
    state: 'credits-setup-banner',
    description:
      'Production, the credits-setup banner after "Not now" - naming the unresolved tokens, "Don\'t ask for this project" and "Fill in" (credits-token-setup-and-front-matter-detection.prd.md Phase 3, mockups/credits-token-setup-and-front-matter-detection/02-home-banner-after-not-now.webp)',
  },
  { page: 'production', state: 'import-activity-log', description: 'Production, manuscript import finished with its live activity log populated' },
  {
    page: 'production',
    state: 'import-build-running',
    description:
      'Production, the Story Bible build chained after an import (on by default, owner decision D8) still running in its own "Build the Story Bible" dialog, the import already reported (?mockBuild=hold)',
  },
  {
    page: 'production',
    state: 'import-build-failed',
    description:
      'Production, the chained Story Bible build failed after a successful import: the build dialog shows the reason and the import stays reported as done (?mockBuild=fails)',
  },
  {
    page: 'production',
    state: 'import-confirm',
    description:
      'Production, import manuscript confirm dialog with format/paragraph/chapter preview (reached via "Replace manuscript" since a manuscript is already loaded)',
  },
  {
    page: 'production',
    state: 'import-confirm-markdown',
    description: 'Production, import review dialog for a Markdown file: the same review plus the chapter heading level choice in an options group',
  },
  {
    page: 'production',
    state: 'import-review-collapsed',
    description: 'Production, import review with every group folded: the summary and one line per group say what was found',
  },
  {
    page: 'production',
    state: 'import-review-characters',
    description: 'Production, import review with the character suggestions open and one unchecked: the summary and the group count both say 2 of 3',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'production',
    state: 'import-review-repaired',
    description: 'Production, import review of a Word file whose headings the importer repaired: the repairs are listed as a group',
  },
  {
    page: 'production',
    state: 'import-review-subtitles-off',
    description:
      'Production, import review with "Read a heading\'s second line as its subtitle" turned off and one row turned back on: the other subtitles are joined to their titles',
  },
  {
    page: 'production',
    state: 'import-review-text-subtitle',
    description: "Production, import review of a plain-text file with the first chapter's subtitle turned off: the epigraph under the heading is read as text",
  },

  {
    page: 'production',
    state: 'live-updates-degraded',
    description: 'Production, the notice that live updates from the desktop host could not be read and the page may be out of date (ADR 0069)',
  },
  {
    page: 'production',
    state: 'daw-not-linked',
    description:
      'Production with no linked REAPER project file (?mockNoDaw=1, PRD project-workspace-and-daw-link.prd.md W13-W16): the header engine chip reads "No REAPER project linked"',
  },

  // The recording check (docs/utilities/recording-coverage.md, ADR 0130), from a chapter's Record cell on the board. The mock's chapters 1-3 have a
  // current check with every word, 4-6 a current check with a third of the text missing, the rest were never checked.
  {
    page: 'production',
    state: 'recording-check-never',
    description: 'Production, recording check dialog for a chapter never checked: the saved-project basis, what a check does, and Check recording',
  },
  {
    page: 'production',
    state: 'recording-check-running',
    description:
      'Production, a recording check running (?mockCoverage=hold): the work dialog with the real percent from the host, its activity log, Cancel and Continue in background',
    ...LIVE_PROGRESS_MOVES_ON,
  },
  {
    page: 'production',
    state: 'recording-check-complete',
    description:
      'Production, recording check result for a chapter read in full: the chapter summary (text present, paragraphs, audio checked), no pickups, the paragraph detail folded (recording-check-summary.prd.md Phase 1)',
  },
  {
    page: 'production',
    state: 'recording-check-incomplete',
    description:
      'Production, recording check result for a chapter not finished: the summary states "Recorded to paragraph N of M" rather than listing the unread end as a pickup (RS2), with no pickups from this check (recording-check-summary.prd.md Phase 1)',
  },
  {
    page: 'production',
    state: 'recording-check-pickups',
    description:
      'Production, recording check result with interior gaps (?mockCoverage=pickups): a skip and a short read listed one per line under Pickups, each with Go to paragraph, alongside a small unread tail stated in the summary, not listed (recording-check-summary.prd.md Phase 1, RS2/RS8)',
  },
  {
    page: 'production',
    state: 'recording-check-stale',
    description:
      'Production, a stored recording check that is out of date (?mockCoverage=stale): the plain-language reason and the old counts labelled as from then',
  },
  {
    page: 'production',
    state: 'recording-check-refused',
    description:
      'Production, a recording check refused because the chapter has no confirmed track (?mockCoverageRefusal=unmapped): the reason in plain words and the track link in place',
  },
  {
    page: 'production',
    state: 'recording-check-model-required',
    description:
      'Production, a recording check that needs the Whisper model first (?mockAssets=missing): the first-use download question, never a silent download',
  },
  {
    page: 'production',
    state: 'recording-check-cascade',
    description:
      'Production, a recording check result from the model cascade (?mockCoverage=cascade, recording-check-model-cascade PRD Phase 5): the summary names both models and the re-checked passage, and each pickup it confirmed missing says so (MC5)',
  },
  {
    page: 'production',
    state: 'recording-check-recheck-model-required',
    description:
      'Production, a recording check whose re-check model needs downloading first (?mockCoverage=recheck-required, Phase 5, MC4): the same first-use question as the first-pass model, with "Check with tiny only" beside the download',
  },
  // Stage suggestions (chapter-stage-recommendations.prd.md Phase 5, deleted, ADR 0160 and 0161), on `?mockStages=mixed`: Chapter 4 read in
  // full (suggested), Chapter 5 with no track linked (can't tell), Chapter 6 short (not ready), Chapter 7 confirmed into Editing and since
  // found short (evidence changed), Chapter 8 confirmed on evidence that still holds.
  {
    page: 'production',
    state: 'stage-summary-chips',
    description:
      "Production, the board with its stage suggestion chips (?mockStages=mixed): one chapter has a suggestion, one chapter’s evidence changed, and those chapters' current-stage cells read Ready and Changed",
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'production',
    state: 'stage-dismissed',
    description:
      "Production, the board after Dismiss on Chapter 4's stage slide-over: its Edit cell no longer reads Ready, its status unchanged, and the suggestion chip is gone",
  },
  {
    page: 'production',
    state: 'stage-error',
    description: 'Production, the stage suggestions could not be read (?mockStages=error): the error chip and the reason above the board with Try again',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'production',
    state: 'stage-evidence-recommended',
    description:
      'Production, the evidence of a suggestion in its slide-over: the verdict, Confirm and Dismiss, the recording check met with its evidence, the saved-project basis and its age, Check now',
  },
  {
    page: 'production',
    state: 'stage-evidence-not-ready',
    description: 'Production, the evidence of a chapter not ready: the check not met, its reason, the missing region with Go to paragraph',
  },
  {
    page: 'production',
    state: 'stage-evidence-unknown',
    description: 'Production, the evidence of a chapter that can’t tell yet: the cause (no track linked), what resolves it and Open recording check',
  },
  {
    page: 'production',
    state: 'stage-evidence-changed',
    description:
      'Production, "Evidence changed since you confirmed": when it was confirmed, the check now not met, and Revert to Recording; nothing moved on its own',
  },

  // Editing check panel (editing-readiness-analysis.prd.md Phase 7), opened from SR's evidence popover's "Open
  // editing check" (?mockEditingSignal=, main.tsx). The panel never starts a scan on its own (Q9), so every state but
  // running/partial is reached with no click at all, straight from the signal or the seeded findings.
  {
    page: 'production',
    state: 'editing-check-never-checked',
    description:
      'Production, editing check panel: empty space "Can’t tell yet: not checked yet", click and breath always "Not yet validated on the corpus" (Phase 4 not shipped), the source-audio caveat, Check editing (?mockEditingSignal=never)',
  },
  {
    page: 'production',
    state: 'editing-check-running',
    description:
      'Production, editing check panel: Check editing pressed, real progress and Cancel over the previous candidates still listed below (?mockEditing=hold&mockEditingSignal=not-met&mockEditingCandidates=1)',
    ...LIVE_PROGRESS_MOVES_ON,
  },
  {
    page: 'production',
    state: 'editing-check-partial',
    description:
      'Production, editing check panel: Cancel pressed mid-run - the items already checked stay cached, and Check again offers a fresh run (?mockEditing=hold&mockEditingSignal=not-met&mockEditingCandidates=1)',
  },
  {
    page: 'production',
    state: 'editing-check-complete-candidates',
    description:
      'Production, editing check panel: empty space "Not met" with two open candidates, each with time range, confidence, reason, Hear, Accept/Dismiss/Defer (RD-4) and Go to/Loop in REAPER (RD Phase 7) (?mockEditingCandidates=1&mockEditingSignal=not-met)',
  },
  {
    page: 'production',
    state: 'editing-check-complete-clean',
    description: 'Production, editing check panel: empty space "Met. Checked; no open empty-space candidate remains." (?mockEditingSignal=met)',
  },
  {
    page: 'production',
    state: 'editing-check-cleanup-confirm',
    description:
      'Production, editing check panel: "Trim silence…" (booth-actions-enablement PRD Phase 5, CapabilityGate(\'silence_trim\')) opened over the same two candidates, its ConfirmDialog previewing the trim (?mockEditingCandidates=1&mockEditingSignal=not-met&mockDawExperimentalOn=1)',
  },
  {
    page: 'production',
    state: 'editing-check-gain-match-confirm',
    description:
      "Production, editing check panel: \"Match levels…\" (CapabilityGate('item_gain')) opened, its ConfirmDialog previewing the linked track's one gain candidate (?mockEditingSignal=met&mockDawExperimentalOn=1)",
  },
  {
    page: 'production',
    state: 'editing-check-stale',
    description:
      'Production, editing check panel: empty space "Can’t tell yet: Check editing again: since the last check an item on this chapter’s track changed." (?mockEditingSignal=stale)',
  },
  {
    page: 'production',
    state: 'editing-check-settings-unset',
    description:
      'Production, editing check panel: empty space "Can’t tell yet: No maximum gap is set for empty space." with a link to Settings > Editing (?mockEditingSignal=settings-unset)',
  },
  {
    page: 'production',
    state: 'editing-check-unsupported',
    description:
      'Production, editing check panel: empty space "Can’t tell yet: An item on this chapter’s track is not a WAV file the check can analyze." (?mockEditingSignal=unsupported)',
  },
  // A credits row's slide-over (credits-in-chapter-table.prd.md Phase 2, moved from Home's table rows)
  {
    page: 'production',
    state: 'credits-panel',
    description:
      'Production, the Opening credits row opened from the board: its template, words and estimated length, Open in Script, its status select and why credits are not checked yet',
  },
  {
    page: 'production',
    state: 'credits-panel-not-set-up',
    description:
      'Production, the Closing credits row opened with no closing template in the library (?mockCreditsMissing=1): "Not set up" with a link to Settings > Credits (CT5)',
  },
  {
    page: 'production',
    state: 'chapter-sync-consent',
    description:
      'Production, "Sync chapters to tracks?" (?mockChapterSync=ask) - it shows from every link path, not only Tracks (daw-chapter-track-auto-sync.prd.md Phase 3)',
  },
];
