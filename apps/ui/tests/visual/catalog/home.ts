// The `home` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { TOOLTIP_CLOSES_ON_RESIZE, KEEPS_DESKTOP_SCROLL, LIVE_PROGRESS_MOVES_ON, TOAST_FADES_OUT } from './shared';

export const homeStates: StateEntry[] = [
  // Home
  { page: 'home', state: 'default', description: 'Home, manuscript found' },
  { page: 'home', state: 'manuscript-not-found', description: 'Home, manuscript-not-found banner' },
  {
    page: 'home',
    state: 'chapter-table-collapsed',
    description: 'Home, chapter table collapsed',
    sameAs: { of: 'home/default', reason: 'The per-chapter table starts collapsed, so the default view already is this state.' },
  },
  { page: 'home', state: 'chapter-table-expanded', description: 'Home, chapter table expanded' },
  {
    page: 'home',
    state: 'chapter-table-credits-missing',
    description:
      'Home, chapter table expanded with no closing credit template configured: the Closing credits row reads "Not set up" and links to Settings > Credits (credits-in-chapter-table.prd.md Phase 2, CT5)',
  },
  {
    page: 'home',
    state: 'chapter-names',
    description:
      "Home, chapter table expanded with the owner's heading shapes (?mockManuscript=mixed): a source-capitals title with a subtitle, a title with no subtitle, a long subtitle and a title already ending in a colon, one style (chapterName()/TitleSubtitle) throughout (chapter-title-display-consistency.prd.md Phase 2, mockups/chapter-title-display-consistency/02-home-table-*.webp)",
  },
  // chapter-track-link-control.prd.md Phase 2: the Track column and its slide-over (mockups/chapter-track-link-control/).
  // "chapter-table-expanded" above already carries mockup 01's variety of default states (suggested, not linked); the
  // renamed state (04) has no host or mock simulation yet (nothing records a track's name at confirm time to compare
  // against), so it is not captured here.
  {
    page: 'home',
    state: 'chapter-track-panel-linked',
    description:
      'Home, chapter track panel open on a confirmed link, showing its facts and how it was found (?mockChapterLink=confirmed, mockups/chapter-track-link-control/02-slideover-linked.webp)',
  },
  {
    page: 'home',
    state: 'chapter-track-panel-ambiguous',
    description:
      'Home, chapter track panel open on a chapter confirmed to two tracks at once, offering to keep one (?mockChapterLink=ambiguous, TL6, mockups/chapter-track-link-control/03-slideover-ambiguous.webp)',
  },
  {
    page: 'home',
    state: 'chapter-track-panel-missing',
    description:
      'Home, chapter track panel open on a confirmed link whose track is no longer in the project (?mockChapterLink=missing, mockups/chapter-track-link-control/05-slideover-track-missing.webp)',
  },
  {
    page: 'home',
    state: 'chapter-remove-confirm',
    description:
      'Home, "Remove from recording?" open from a chapter\'s track slide-over (chapter-track-link-control.prd.md Phase 3, mockup 06-remove-from-recording-confirm.webp)',
  },
  {
    page: 'home',
    state: 'chapter-removed-list',
    description:
      'Home, chapter table expanded with the last narration chapter already removed from recording (?mockRemoved=1, mockup 07-removed-from-recording-list.webp)',
  },
  {
    page: 'home',
    state: 'chapter-track-no-project',
    description:
      'Home, chapter table expanded with no REAPER project found: the Track column is absent and its place names why (TL7, ?mockNoRpp=1, mockups/chapter-track-link-control/08-no-project-line.webp)',
  },
  {
    page: 'home',
    state: 'chapter-sync-toast-undo',
    description:
      'Home, the toast for a chapter-sync batch that just linked a track, with Undo (?mockChapterSync=linked, daw-chapter-track-auto-sync.prd.md Phase 3, S12, mockups/daw-chapter-track-auto-sync/03-auto-linked-toast-undo.webp)',
    ...TOAST_FADES_OUT,
  },
  {
    page: 'home',
    state: 'hint-chips',
    description: 'Vocabulary hint chips widget (accepted + pending) - lives on Proofing, catalogued under "home" for historical reasons',
  },
  { page: 'home', state: 'info-tooltip', description: 'Home, info icon tooltip visible', pointer: 'keep', ...TOOLTIP_CLOSES_ON_RESIZE },
  { page: 'home', state: 'manuscript-candidate-offer', description: 'Home, offer to import a manuscript file found in the project folder' },
  {
    page: 'home',
    state: 'credits-setup-dialog',
    description:
      'Home, "Set up the credits" dialog (credits-token-setup-and-front-matter-detection.prd.md Phase 2, CS1 C / D35, ?mockCredits=setup): Title and Author prefilled from the detected front matter with their source captions, Narrator empty with "Use for all my projects" checked (CS7 B) since no global default is set, "Don\'t ask for this project" alongside Not now and Save (mockups/credits-token-setup-and-front-matter-detection/01b-alt-setup-dialog-narrator-empty.webp)',
  },
  {
    page: 'home',
    state: 'credits-setup-dialog-narrator-default',
    description:
      'Home, "Set up the credits" dialog when the narrator token already has a value (?mockCredits=setup-narrator-default): only Title and Author are asked, with no Narrator field or checkbox - the state a returning narrator with a saved default sees',
  },
  {
    page: 'home',
    state: 'credits-setup-banner',
    description:
      'Home, the credits-setup banner after "Not now" - naming the unresolved tokens, "Don\'t ask for this project" and "Fill in" (credits-token-setup-and-front-matter-detection.prd.md Phase 3, mockups/credits-token-setup-and-front-matter-detection/02-home-banner-after-not-now.webp)',
  },
  { page: 'home', state: 'import-activity-log', description: 'Home, manuscript import finished with its live activity log populated' },
  {
    page: 'home',
    state: 'import-build-running',
    description:
      'Home, the Story Bible build chained after an import (on by default, owner decision D8) still running in its own "Build the Story Bible" dialog, the import already reported (?mockBuild=hold)',
  },
  {
    page: 'home',
    state: 'import-build-failed',
    description:
      'Home, the chained Story Bible build failed after a successful import: the build dialog shows the reason and the import stays reported as done (?mockBuild=fails)',
  },
  {
    page: 'home',
    state: 'import-confirm',
    description:
      'Home, import manuscript confirm dialog with format/paragraph/chapter preview (reached via "Replace manuscript" since a manuscript is already loaded)',
  },
  {
    page: 'home',
    state: 'import-confirm-markdown',
    description: 'Home, import review dialog for a Markdown file: the same review plus the chapter heading level choice in an options group',
  },
  {
    page: 'home',
    state: 'import-review-collapsed',
    description: 'Home, import review with every group folded: the summary and one line per group say what was found',
  },
  {
    page: 'home',
    state: 'import-review-characters',
    description: 'Home, import review with the character suggestions open and one unchecked: the summary and the group count both say 2 of 3',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'home',
    state: 'import-review-repaired',
    description: 'Home, import review of a Word file whose headings the importer repaired: the repairs are listed as a group',
  },
  {
    page: 'home',
    state: 'import-review-subtitles-off',
    description:
      'Home, import review with "Read a heading\'s second line as its subtitle" turned off and one row turned back on: the other subtitles are joined to their titles',
  },
  {
    page: 'home',
    state: 'import-review-text-subtitle',
    description: "Home, import review of a plain-text file with the first chapter's subtitle turned off: the epigraph under the heading is read as text",
  },

  {
    page: 'home',
    state: 'live-updates-degraded',
    description: 'Home, the notice that live updates from the desktop host could not be read and the page may be out of date (ADR 0069)',
  },
  {
    page: 'home',
    state: 'daw-not-linked',
    description:
      'Home with no linked REAPER project file (?mockNoDaw=1, PRD project-workspace-and-daw-link.prd.md W13-W16): the header pill reads "No REAPER project linked" and the Proofing nav item is locked',
  },

  // The recording check (docs/utilities/recording-coverage.md, ADR 0130), from a row of the per-chapter breakdown. The mock's chapters 1-3 have a
  // current check with every word, 4-6 a current check with a third of the text missing, the rest were never checked.
  {
    page: 'home',
    state: 'recording-check-never',
    description: 'Home, recording check dialog for a chapter never checked: the saved-project basis, what a check does, and Check recording',
  },
  {
    page: 'home',
    state: 'recording-check-running',
    description:
      'Home, a recording check running (?mockCoverage=hold): the work dialog with the real percent from the host, its activity log, Cancel and Continue in background',
    ...LIVE_PROGRESS_MOVES_ON,
  },
  {
    page: 'home',
    state: 'recording-check-complete',
    description:
      'Home, recording check result for a chapter read in full: the chapter summary (text present, paragraphs, audio checked), no pickups, the paragraph detail folded (recording-check-summary.prd.md Phase 1)',
  },
  {
    page: 'home',
    state: 'recording-check-incomplete',
    description:
      'Home, recording check result for a chapter not finished: the summary states "Recorded to paragraph N of M" rather than listing the unread end as a pickup (RS2), with no pickups from this check (recording-check-summary.prd.md Phase 1)',
  },
  {
    page: 'home',
    state: 'recording-check-pickups',
    description:
      'Home, recording check result with interior gaps (?mockCoverage=pickups): a skip and a short read listed one per line under Pickups, each with Go to paragraph, alongside a small unread tail stated in the summary, not listed (recording-check-summary.prd.md Phase 1, RS2/RS8)',
  },
  {
    page: 'home',
    state: 'recording-check-stale',
    description: 'Home, a stored recording check that is out of date (?mockCoverage=stale): the plain-language reason and the old counts labelled as from then',
  },
  {
    page: 'home',
    state: 'recording-check-refused',
    description:
      'Home, a recording check refused because the chapter has no confirmed track (?mockCoverageRefusal=unmapped): the reason in plain words and the track link in place',
  },
  {
    page: 'home',
    state: 'recording-check-model-required',
    description: 'Home, a recording check that needs the Whisper model first (?mockAssets=missing): the first-use download question, never a silent download',
  },
  // Stage suggestions (docs/prds/chapter-stage-recommendations.prd.md Phase 5, ADR 0160 and 0161), on `?mockStages=mixed`: Chapter 4 read in
  // full (suggested), Chapter 5 with no track linked (can't tell), Chapter 6 short (not ready), Chapter 7 confirmed into Editing and since
  // found short (evidence changed), Chapter 8 confirmed on evidence that still holds.
  {
    page: 'home',
    state: 'stage-summary-chips',
    description: 'Home, the collapsed estimate card with its stage suggestion chips: one chapter has a suggestion, one chapter’s evidence changed',
  },
  {
    page: 'home',
    state: 'stage-suggestions',
    description:
      'Home, the breakdown with a stage suggestion under each status: Suggested with Confirm, Dismiss and Why; can’t tell with its cause; not ready; evidence changed with Revert; confirmed with Revert',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'home',
    state: 'stage-dismissed',
    description:
      'Home, the breakdown after Dismiss on Chapter 4: the row reads the suggestion as dismissed, its status unchanged, and the suggestion chip is gone',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'home',
    state: 'stage-error',
    description:
      'Home, the stage suggestions could not be read (?mockStages=error): the error chip, the reason above the table with Try again, and "Couldn’t check" in every row',
  },
  {
    page: 'home',
    state: 'stage-evidence-recommended',
    description:
      'Home, the evidence of a suggestion in its slide-over: the verdict, Confirm and Dismiss, the recording check met with its evidence, the saved-project basis and its age, Check now',
  },
  {
    page: 'home',
    state: 'stage-evidence-not-ready',
    description: 'Home, the evidence of a chapter not ready: the check not met, its reason, the missing region with Go to paragraph',
  },
  {
    page: 'home',
    state: 'stage-evidence-unknown',
    description: 'Home, the evidence of a chapter that can’t tell yet: the cause (no track linked), what resolves it and Open recording check',
  },
  {
    page: 'home',
    state: 'stage-evidence-changed',
    description:
      'Home, "Evidence changed since you confirmed": when it was confirmed, the check now not met, and Revert to Recording; nothing moved on its own',
  },

  // Editing check panel (editing-readiness-analysis.prd.md Phase 7), opened from SR's evidence popover's "Open
  // editing check" (?mockEditingSignal=, main.tsx). The panel never starts a scan on its own (Q9), so every state but
  // running/partial is reached with no click at all, straight from the signal or the seeded findings.
  {
    page: 'home',
    state: 'editing-check-never-checked',
    description:
      'Home, editing check panel: empty space "Can’t tell yet: not checked yet", click and breath always "Not yet validated on the corpus" (Phase 4 not shipped), the source-audio caveat, Check editing (?mockEditingSignal=never)',
  },
  {
    page: 'home',
    state: 'editing-check-running',
    description:
      'Home, editing check panel: Check editing pressed, real progress and Cancel over the previous candidates still listed below (?mockEditing=hold&mockEditingSignal=not-met&mockEditingCandidates=1)',
    ...LIVE_PROGRESS_MOVES_ON,
  },
  {
    page: 'home',
    state: 'editing-check-partial',
    description:
      'Home, editing check panel: Cancel pressed mid-run - the items already checked stay cached, and Check again offers a fresh run (?mockEditing=hold&mockEditingSignal=not-met&mockEditingCandidates=1)',
  },
  {
    page: 'home',
    state: 'editing-check-complete-candidates',
    description:
      'Home, editing check panel: empty space "Not met" with two open candidates, each with time range, confidence, reason, Hear, Accept/Dismiss/Defer (RD-4) and Go to/Loop in REAPER (RD Phase 7) (?mockEditingCandidates=1&mockEditingSignal=not-met)',
  },
  {
    page: 'home',
    state: 'editing-check-complete-clean',
    description: 'Home, editing check panel: empty space "Met. Checked; no open empty-space candidate remains." (?mockEditingSignal=met)',
  },
  {
    page: 'home',
    state: 'editing-check-stale',
    description:
      'Home, editing check panel: empty space "Can’t tell yet: Check editing again: since the last check an item on this chapter’s track changed." (?mockEditingSignal=stale)',
  },
  {
    page: 'home',
    state: 'editing-check-settings-unset',
    description:
      'Home, editing check panel: empty space "Can’t tell yet: No maximum gap is set for empty space." with a link to Settings > Editing (?mockEditingSignal=settings-unset)',
  },
  {
    page: 'home',
    state: 'editing-check-unsupported',
    description:
      'Home, editing check panel: empty space "Can’t tell yet: An item on this chapter’s track is not a WAV file the check can analyze." (?mockEditingSignal=unsupported)',
  },
];
