// The `proofing` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { TOOLTIP_CLOSES_ON_RESIZE, LIVE_PROGRESS_MOVES_ON, FREEZES_THE_CLOCK } from './shared';

export const proofingStates: StateEntry[] = [
  // Proofing
  { page: 'proofing', state: 'setup-default', description: 'Proofing, setup panel default selection' },
  { page: 'proofing', state: 'setup-alt-selection', description: 'Proofing, setup panel alternate model/worker/chunk selection' },
  { page: 'proofing', state: 'running', description: 'Proofing, running panel mid-progress with log', ...LIVE_PROGRESS_MOVES_ON },
  { page: 'proofing', state: 'results-row-expanded', description: 'Proofing, results table with one discrepancy row expanded' },
  {
    page: 'proofing',
    state: 'results-extra-row-expanded',
    description: 'Proofing, results table with an EXTRA (words heard but not written) discrepancy row expanded',
  },
  {
    page: 'proofing',
    state: 'disabled-button',
    description: 'Home with no manuscript - the Proofing action is locked and its tooltip says why',
    pointer: 'keep',
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },
  { page: 'proofing', state: 'toast', description: 'Proofing, a toast visible', ...FREEZES_THE_CLOCK },
  {
    page: 'proofing',
    state: 'no-daw',
    description: 'Proofing setup with no linked REAPER project file (?mockNoDaw=1, PRD W16): Start comparison is disabled',
  },
  {
    page: 'proofing',
    state: 'no-daw-review',
    description:
      'Proofing reviewing the last completed comparison with no linked REAPER project file (?mockNoDaw=1, PRD W16): offline review stays reachable, but every Play recorded audio button and the marker Export button are disabled',
  },
  // The Preview panel (proofing-preview-suggestion.prd.md Phase 3): a suggested five-minute excerpt from the manuscript, computed on
  // read (SR D1 - never applied, exported or stored). It sits above Setup regardless of the compare workflow's own phase.
  {
    page: 'proofing',
    state: 'preview-default',
    description: 'Proofing, the Preview panel with its default candidates from the demo manuscript: three full-length chapters, no warnings',
  },
  { page: 'proofing', state: 'preview-computing', description: 'Proofing, the Preview panel still reading candidates (?mockPreviewCandidates=computing)' },
  {
    page: 'proofing',
    state: 'preview-no-manuscript',
    description:
      'Proofing, the Preview panel answering no_manuscript (?mockPreviewCandidates=no-manuscript) - a defensive state the binding can return that the page itself cannot otherwise reach, since /proofing redirects away with no manuscript at all',
  },
  {
    page: 'proofing',
    state: 'preview-nothing-eligible',
    description: 'Proofing, the Preview panel with no eligible text found (?mockPreviewCandidates=nothing-eligible)',
  },
  {
    page: 'proofing',
    state: 'preview-shorter',
    description:
      'Proofing, the Preview panel with a candidate shorter than the target length even in full (?mockPreviewCandidates=shorter), warned in text and an icon',
  },
  {
    page: 'proofing',
    state: 'preview-warnings',
    description:
      'Proofing, the Preview panel with a full-length candidate warned for a reason other than being short (an unclassified import, ?mockPreviewCandidates=warnings) - text and an icon, never colour alone',
  },
  // The stage recommendations panel (chapter-stage-recommendations.prd.md Phase 8, proofing-readiness-signals.prd.md Phases 1
  // and 5): every narration chapter currently in Proofing, using the same StageSuggestion/StageEvidence pattern Home's
  // breakdown table uses (Phase 5). It sits above Setup, independent of the compare workflow's own phase.
  {
    page: 'proofing',
    state: 'stage-panel-suggestions',
    description:
      'Proofing, the stage recommendations panel with both default Proofing chapters seeded (?mockProofingStages=mixed): Chapter 9 clear (Suggested: Finalized), Chapter 10 with an open pickup (Not ready)',
  },
  {
    page: 'proofing',
    state: 'stage-panel-evidence-recommended',
    description: 'Proofing, the stage recommendations panel: Why opened on the clear chapter (?mockProofingStages=mixed), Confirm and Dismiss offered',
  },
  {
    page: 'proofing',
    state: 'stage-panel-evidence-not-ready',
    description: 'Proofing, the stage recommendations panel: Why opened on the chapter with an open pickup (?mockProofingStages=mixed), naming the Review page',
  },
  {
    page: 'proofing',
    state: 'stage-panel-evidence-unknown',
    description:
      'Proofing, the stage recommendations panel: Why opened on an unmapped-track cause (?mockProofingSignal=unmapped-track) - "Open Tracks", never "Open recording check" (stageText.ts PROOFING_CAUSE_TEXT)',
  },
];
