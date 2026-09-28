import type { TakeComparisonMember, TakeMetrics, TakeMetricStatus } from '../../types';
import { formatTime } from './findingFormat';

// How the Review page words a take comparison (take review Phase 10). Every figure is the host's own, shown per category and
// per read; nothing here adds categories up, orders the reads or calls one better (Q9). Display only.

const one = (value: number): string => value.toFixed(1);
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/** How a read read the script: "14 of 16 words as written · 1 misread · 1 not reached". */
export function scriptSummary(member: TakeComparisonMember, spanWords: number): string {
  if (!member.counts) return 'Not compared';
  const { matched, misread, skipped, unread, extra_words: extra } = member.counts;
  return [
    `${matched} of ${spanWords} words as written`,
    misread > 0 ? `${misread} misread` : '',
    skipped > 0 ? `${skipped} left out` : '',
    unread > 0 ? `${unread} not reached` : '',
    extra > 0 ? plural(extra, 'extra word') : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const DIVERGENCE_LABELS: Record<string, string> = { misread: 'Misread', skipped: 'Left out', unread: 'Not reached', extra: 'Extra words' };

/** One place a read departs from the script, in words: `Misread “tired.” as “tried” at 0:04.5`. */
export function divergenceLabel(divergence: TakeComparisonMember['divergences'][number]): string {
  const label = DIVERGENCE_LABELS[divergence.kind] ?? divergence.kind;
  const where = divergence.start === null ? '' : ` at ${formatTime(divergence.start)}`;
  if (divergence.kind === 'misread') return `${label} “${divergence.manuscript_text}” as “${divergence.audio_text}”${where}`;
  if (divergence.kind === 'extra') return `${label} “${divergence.audio_text}”${where}`;
  return `${label}: “${divergence.manuscript_text}”${where}`;
}

type Category = 'clipping' | 'noise' | 'level_consistency' | 'duration' | 'pause_profile';

/** The measured categories in the order they are shown, each with what it measures in plain words. */
export const METRIC_ROWS: Array<{ key: Category; label: string; explains: string }> = [
  { key: 'clipping', label: 'Clipping', explains: 'Samples at full scale, and runs of three or more in a row, which usually sound as distortion.' },
  { key: 'noise', label: 'Room noise', explains: 'The quietest half-second of the read: the room and the gear under the voice. Lower is quieter.' },
  { key: 'level_consistency', label: 'Level', explains: 'Loudness of the whole read against the items either side of it on its track.' },
  { key: 'duration', label: 'Length', explains: 'How long the read is, and its speaking rate over this part of the script.' },
  { key: 'pause_profile', label: 'Pauses', explains: 'Silences between the words of this part of the script, from the transcript.' },
];

/** A category's figure for one read, or why there is none. */
export function metricValue(metrics: TakeMetrics, key: Category): { text: string; unavailable: boolean } {
  const evidence: TakeMetricStatus = metrics[key];
  if (evidence.status !== 'measured') return { text: `Unavailable: ${evidence.reason ?? 'not measured'}`, unavailable: true };
  switch (key) {
    case 'clipping': {
      const { full_scale_samples: samples, clip_run_count: runs } = metrics.clipping;
      return { text: samples ? `${plural(samples, 'sample')} at full scale, ${plural(runs ?? 0, 'run')}` : 'None at full scale', unavailable: false };
    }
    case 'noise': {
      const floor = metrics.noise.noise_floor_dbfs;
      return { text: floor === null ? 'No quiet stretch to measure' : `${one(floor)} dBFS`, unavailable: false };
    }
    case 'level_consistency': {
      const { integrated_lufs: lufs, delta_lu: delta } = metrics.level_consistency;
      if (lufs === null || delta === null) return { text: 'Not measured', unavailable: true };
      const direction = Math.abs(delta) < 0.05 ? 'the same as' : delta > 0 ? `${one(delta)} LU louder than` : `${one(-delta)} LU quieter than`;
      return { text: `${one(lufs)} LUFS, ${direction} its neighbours`, unavailable: false };
    }
    case 'duration': {
      const { item_seconds: item, words_per_minute: rate } = metrics.duration;
      const length = item === null ? 'No length' : `${one(item)} s`;
      return { text: rate === null ? length : `${length}, ${Math.round(rate)} words a minute`, unavailable: false };
    }
    case 'pause_profile': {
      const { count = 0, longest_seconds: longest = 0 } = metrics.pause_profile;
      return { text: count === 0 ? 'No pauses' : `${plural(count, 'pause')}, longest ${one(longest)} s`, unavailable: false };
    }
  }
}
