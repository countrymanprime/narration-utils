import type { StatusTone } from './components/primitives/StatusBadge';

// The five chapter production statuses: their labels, their order and the token each one is drawn in. Shared by the
// chapter list, the audiobook estimate and the MeterBar story, so it sits above the feature folders (a primitive's story
// may not import a feature component, ADR 0062).
export const STATUS_LABELS = { not_started: 'Not Started', recording: 'Recording', editing: 'Editing', proofing: 'Proofing', finalized: 'Finalized' } as const;
export const STATUS_ORDER = ['not_started', 'recording', 'editing', 'proofing', 'finalized'] as const;
export const STATUS_COLOR: Record<keyof typeof STATUS_LABELS, string> = {
  not_started: 'var(--non-text)',
  recording: 'var(--info)',
  editing: 'var(--warn)',
  proofing: 'var(--org)',
  finalized: 'var(--character)',
};

// StatusBadge's tone (studio-ui-primitives.prd.md Phase 3, Q6): a closed set of meanings, so three stage names in the
// middle of the pipeline share one meaning, `progress`, rather than each inventing its own. The hand-drawn dots above
// stay on STATUS_COLOR for now; a feature that adopts StatusBadge for a chapter's status reads this map instead.
export const STATUS_TONE: Record<keyof typeof STATUS_LABELS, StatusTone> = {
  not_started: 'neutral',
  recording: 'progress',
  editing: 'progress',
  proofing: 'progress',
  finalized: 'success',
};
