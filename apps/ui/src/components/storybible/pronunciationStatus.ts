import type { GuidePronunciation, GuidePronunciationStatus, GuidePronunciationValue } from '../../types';
import type { StatusTone } from '../primitives/StatusBadge';

// How a pronunciation's status reads (prep-depth P1, ADR 0346). The tone is a meaning, not a colour per status: a question still out
// is a warning, a confirmation is a success, and a plain lookup is neutral.
export const PRONUNCIATION_STATUSES: { value: GuidePronunciationStatus; label: string; tone: StatusTone }[] = [
  { value: 'researched', label: 'Researched', tone: 'neutral' },
  { value: 'query_sent', label: 'Query sent', tone: 'warning' },
  { value: 'author_confirmed', label: 'Author confirmed', tone: 'success' },
];

export const pronunciationStatusOf = (value: Pick<GuidePronunciation, 'status'>): GuidePronunciationStatus => value.status ?? 'researched';

export const pronunciationStatusInfo = (value: Pick<GuidePronunciation, 'status'>) =>
  PRONUNCIATION_STATUSES.find((row) => row.value === pronunciationStatusOf(value)) ?? PRONUNCIATION_STATUSES[0];

/** The source as the narrator reads it: their own typed pronunciation is "Yours", a dictionary keeps its own name. */
export const pronunciationSourceLabel = (value: Pick<GuidePronunciationValue, 'source'>): string => (value.source === 'user' ? 'Yours' : value.source);
