// The `proof-chapter` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured: Proof's chapter view,
// `/proof/:chapterId` (stage-navigation-and-page-replacement.prd.md Phase 5). It is the chapter workspace of
// edit-and-proof-workspace.prd.md (the `workspace` page key until Phase 5) with the Proofing page folded in (the `proofing`
// page key): the compare run, its results as flags, and the Preview and stage panels.
import type { StateEntry } from '../lib/types';
import { FREEZES_THE_CLOCK, KEEPS_DESKTOP_SCROLL, LIVE_PROGRESS_MOVES_ON } from './shared';

export const proofChapterStates: StateEntry[] = [
  // The chapter workspace (edit-and-proof-workspace.prd.md Phases 2 to 4), reached from a linked chapter's "Open workspace" link.
  {
    page: 'proof-chapter',
    state: 'never',
    description:
      'Proof chapter view, a chapter with a confirmed track link that has never been checked - "hasn’t been checked yet", Check recording, no player or script yet',
  },
  {
    page: 'proof-chapter',
    state: 'stale',
    description:
      'Proof chapter view, a stale check (an item was trimmed since) - "Check stale" state pill, the script and player still shown from the last check',
  },
  {
    page: 'proof-chapter',
    state: 'current',
    description:
      'Proof chapter view, a current check - "Proof · Chapter 1" header, transport, script with its flags struck through/underlined in place, and the Flags panel with its legend',
  },
  {
    page: 'proof-chapter',
    state: 'playing',
    description: 'Proof chapter view, Play pressed - transport shows Pause and a live elapsed readout, the currently spoken word highlighted in the script',
  },
  {
    page: 'proof-chapter',
    state: 'flag-selected',
    description: 'Proof chapter view, a flag selected from the Flags panel - its script/heard text and "Play from here" shown in the panel’s detail section',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof-chapter',
    state: 'flag-finding-open',
    description:
      'Proof chapter view, a finding-backed flag selected (edit-and-proof-workspace.prd.md Phase 4): "From <analyzer>", Go to/Loop in REAPER for that word, and the Decision section (Accept/Dismiss/Defer, a note field) - mockups/edit-and-proof-workspace/02-flag-detail-open.webp',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof-chapter',
    state: 'flag-decided',
    description:
      'Proof chapter view, the finding-backed flag just accepted in place - "Saved as accepted." and the decision reflected, without leaving the page',
  },
  {
    page: 'proof-chapter',
    state: 'standalone',
    description:
      'Proof chapter view with REAPER not running (edit-and-proof-workspace PRD Phase 3) - Go to in REAPER and Loop in REAPER on the transport bar are disabled, with the reason under a tooltip; everything else still works',
  },
  // The compare run (the Proofing page's setup, run and results, folded in by stage navigation Phase 5), scrolled into view.
  {
    page: 'proof-chapter',
    state: 'compare-setup',
    description: 'Proof chapter view, the compare run’s setup with its default model, chunk length and workers',
  },
  {
    page: 'proof-chapter',
    state: 'compare-setup-alt',
    description: 'Proof chapter view, the compare run’s setup with the Large model picked, capping chunk length and workers',
  },
  {
    page: 'proof-chapter',
    state: 'compare-running',
    description: 'Proof chapter view, a comparison running mid-progress with its live activity log',
    ...LIVE_PROGRESS_MOVES_ON,
  },
  {
    page: 'proof-chapter',
    state: 'compare-results-misread',
    description:
      "Proof chapter view, a finished comparison's misread selected in the Flags panel - the inline script/heard diff, its marker state, Show in manuscript, Play recorded audio and Add pronunciation equivalence (the Proofing page's expanded results row)",
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof-chapter',
    state: 'compare-results-extra',
    description: 'Proof chapter view, a finished comparison’s EXTRA (words heard but not written) selected in the Flags panel, with its inline diff',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'proof-chapter',
    state: 'compare-results-summary',
    description: 'Proof chapter view, a finished comparison’s summary - how many discrepancies are this chapter’s, Export 1 marker and New comparison',
    ...KEEPS_DESKTOP_SCROLL,
  },
  { page: 'proof-chapter', state: 'compare-toast', description: 'Proof chapter view, Suggest from manuscript answered with a toast', ...FREEZES_THE_CLOCK },
  // The vocabulary hints tag-input box (proofing-vocabulary-hints.prd.md Phase 2): the pills box is the input, no separate Add row.
  {
    page: 'proof-chapter',
    state: 'compare-hints-typing',
    description: 'Proof chapter view, the vocabulary hints box mid-typed, the draft inline after the last pill',
  },
  {
    page: 'proof-chapter',
    state: 'compare-hints-many-pills',
    description: 'Proof chapter view, the vocabulary hints box with many accepted terms wrapping across lines',
  },
  {
    page: 'proof-chapter',
    state: 'compare-hints-pending-suggestions',
    description: 'Proof chapter view, the vocabulary hints box with dashed suggested-term pills from Suggest from manuscript',
  },
  {
    page: 'proof-chapter',
    state: 'compare-hints-chips',
    description:
      'Proof chapter view, the vocabulary hints box with one suggested term accepted (a solid pill) beside the ones still pending (the home/hint-chips row until Phase 5)',
  },
  {
    page: 'proof-chapter',
    state: 'compare-no-daw',
    description: 'Proof chapter view with no linked REAPER project file (?mockNoDaw=1, PRD W16): Start comparison is gated, with the reason as its description',
  },
  {
    page: 'proof-chapter',
    state: 'compare-no-daw-review',
    description:
      'Proof chapter view reviewing the last completed comparison with no linked REAPER project file (?mockNoDaw=1, PRD W16): its misread selected, Play recorded audio off, and Export off in the summary',
    ...KEEPS_DESKTOP_SCROLL,
  },
  // The Preview panel (proofing-preview-suggestion.prd.md Phase 3): a suggested five-minute excerpt from the manuscript, computed on
  // read (SR D1 - never applied, exported or stored), beside the compare run.
  {
    page: 'proof-chapter',
    state: 'preview-default',
    description: 'Proof chapter view, the Preview panel with its default candidates from the demo manuscript: three full-length chapters, no warnings',
  },
  {
    page: 'proof-chapter',
    state: 'preview-computing',
    description: 'Proof chapter view, the Preview panel still reading candidates (?mockPreviewCandidates=computing)',
  },
  {
    page: 'proof-chapter',
    state: 'preview-no-manuscript',
    description:
      'Proof chapter view, the Preview panel answering no_manuscript (?mockPreviewCandidates=no-manuscript) - a defensive state the binding can return that the page itself cannot otherwise reach, since a chapter view redirects away with no manuscript at all',
  },
  {
    page: 'proof-chapter',
    state: 'preview-nothing-eligible',
    description: 'Proof chapter view, the Preview panel with no eligible text found (?mockPreviewCandidates=nothing-eligible)',
  },
  {
    page: 'proof-chapter',
    state: 'preview-shorter',
    description:
      'Proof chapter view, the Preview panel with a candidate shorter than the target length even in full (?mockPreviewCandidates=shorter), warned in text and an icon',
  },
  {
    page: 'proof-chapter',
    state: 'preview-warnings',
    description:
      'Proof chapter view, the Preview panel with a full-length candidate warned for a reason other than being short (an unclassified import, ?mockPreviewCandidates=warnings) - text and an icon, never colour alone',
  },
  // The stage recommendations panel (chapter-stage-recommendations.prd.md Phase 8, proofing-readiness-signals.prd.md Phases 1 and 5):
  // every narration chapter currently in Proofing, with the StageSuggestion/StageEvidence pattern Home's breakdown table uses.
  {
    page: 'proof-chapter',
    state: 'stage-panel-suggestions',
    description:
      'Proof chapter view, the stage recommendations panel with both default Proofing chapters seeded (?mockProofingStages=mixed): Chapter 9 clear (Suggested: Finalized), Chapter 10 with an open pickup (Not ready)',
  },
  {
    page: 'proof-chapter',
    state: 'stage-panel-evidence-recommended',
    description:
      'Proof chapter view, the stage recommendations panel: Why opened on the clear chapter (?mockProofingStages=mixed), Confirm and Dismiss offered',
  },
  {
    page: 'proof-chapter',
    state: 'stage-panel-evidence-not-ready',
    description: 'Proof chapter view, the stage recommendations panel: Why opened on the chapter with an open pickup (?mockProofingStages=mixed), naming Proof',
  },
  {
    page: 'proof-chapter',
    state: 'stage-panel-evidence-unknown',
    description:
      'Proof chapter view, the stage recommendations panel: Why opened on an unmapped-track cause (?mockProofingSignal=unmapped-track) - "Open Tracks", never "Open recording check" (stageText.ts PROOFING_CAUSE_TEXT)',
  },
];
