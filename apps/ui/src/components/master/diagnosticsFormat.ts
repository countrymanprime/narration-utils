// How the Diagnostics tab words a diagnostics finding (diagnostics PRD Phase 6). Every figure comes from the finding's own
// evidence (internal/measure/diagnosticfindings.go), including the threshold that raised it, so what is shown is what the
// host measured against; a kind or key this page does not know is said to be undescribed rather than guessed at.
import type { DiagnosticsCleanupThresholds, DiagnosticsSourceKind, DiagnosticsThresholds, Finding } from '../../types';
import { formatTime } from '../proof/findingFormat';
import { formatLevel } from './deliveryFormat';

const UNDESCRIBED = 'Not described here';

const KIND_LABELS: Record<string, string> = {
  clipping: 'Clipping',
  level_shift: 'Level shift',
  room_tone_change: 'Room-tone change',
  long_pause: 'Long pause',
};

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const kindOf = (finding: Finding): string => (typeof finding.evidence?.kind === 'string' ? finding.evidence.kind : '');

/** A change with its sign, typographic minus included: "+8.3", "−5.8". */
const signed = (value: number): string => (value > 0 ? `+${formatLevel(value)}` : formatLevel(value));

const seconds = (value: number): string => `${value.toFixed(1)} s`;

const ceiling = (dbfs: number): string => (dbfs === 0 ? 'full scale (0.0 dBFS)' : `${formatLevel(dbfs)} dBFS`);

const clipThreshold = (dbfs: number, runSamples: number): string => `At or above ${ceiling(dbfs)}, in runs of ${runSamples} or more samples`;

/**
 * The clip-run rule of measure.Report and the diagnostics. Keep in sync with minClipRunSamples in
 * apps/desktop/internal/measure/clipping.go: the thresholds payload does not carry it, and a finding shows its own min_run_samples.
 */
const MIN_CLIP_RUN_SAMPLES = 3;

export function findingKindLabel(finding: Finding): string {
  const kind = kindOf(finding);
  if (KIND_LABELS[kind]) return KIND_LABELS[kind];
  const words = kind.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Finding';
}

function listChannels(channels: unknown): string | undefined {
  if (!Array.isArray(channels) || channels.length === 0 || !channels.every((channel) => typeof channel === 'number')) return undefined;
  if (channels.length === 1) return `channel ${channels[0]}`;
  return `channels ${channels.slice(0, -1).join(', ')} and ${channels[channels.length - 1]}`;
}

/** What was measured, with units: the level before and after a change, the length of a pause, the run that clipped. */
export function measuredText(finding: Finding): string {
  const evidence = finding.evidence ?? {};
  switch (kindOf(finding)) {
    case 'clipping': {
      const run = num(evidence.longest_run_samples);
      const channels = listChannels(evidence.channels);
      return run !== undefined && channels ? `Longest run ${run} samples, ${channels}` : UNDESCRIBED;
    }
    case 'level_shift': {
      const [before, after, delta] = [num(evidence.before_lufs), num(evidence.after_lufs), num(evidence.delta_lu)];
      return before !== undefined && after !== undefined && delta !== undefined
        ? `${formatLevel(before)} to ${formatLevel(after)} LUFS (${signed(delta)} LU)`
        : UNDESCRIBED;
    }
    case 'room_tone_change': {
      const [before, after, delta] = [num(evidence.before_dbfs), num(evidence.after_dbfs), num(evidence.delta_db)];
      return before !== undefined && after !== undefined && delta !== undefined
        ? `${formatLevel(before)} to ${formatLevel(after)} dBFS (${signed(delta)} dB)`
        : UNDESCRIBED;
    }
    case 'long_pause': {
      const length = num(evidence.duration_seconds);
      return length !== undefined ? `${seconds(length)} between words` : UNDESCRIBED;
    }
  }
  return UNDESCRIBED;
}

/** The threshold that raised the finding, as the finding recorded it. */
export function thresholdText(finding: Finding): string {
  const evidence = finding.evidence ?? {};
  switch (kindOf(finding)) {
    case 'clipping': {
      const [dbfs, run] = [num(evidence.ceiling_dbfs), num(evidence.min_run_samples)];
      return dbfs !== undefined && run !== undefined ? clipThreshold(dbfs, run) : UNDESCRIBED;
    }
    case 'level_shift': {
      const step = num(evidence.level_shift_lu);
      return step !== undefined ? `A change of ${formatLevel(step)} LU or more` : UNDESCRIBED;
    }
    case 'room_tone_change': {
      const step = num(evidence.room_tone_step_db);
      return step !== undefined ? `A change of ${formatLevel(step)} dB or more between silences` : UNDESCRIBED;
    }
    case 'long_pause': {
      const length = num(evidence.long_pause_seconds);
      return length !== undefined ? `${seconds(length)} or longer` : UNDESCRIBED;
    }
  }
  return UNDESCRIBED;
}

/** Where in the file, as m:ss.s; a range too short to show as two times is its start and its length. */
export function timeRangeText(finding: Finding): string {
  const range = finding.time_range;
  if (!range) return 'No time';
  const [start, end] = [formatTime(range.start), formatTime(range.end)];
  if (start !== end) return `${start} – ${end}`;
  return `${start} (${Math.round((range.end - range.start) * 1000)} ms)`;
}

export function sourceKindLabel(kind: DiagnosticsSourceKind): string {
  return kind === 'processed_render' ? 'Rendered chapter' : 'Raw recording';
}

/** Every threshold a check uses, in the order the analyzers run, for the panel that shows them before any finding. */
export function thresholdRows(thresholds: DiagnosticsThresholds): Array<{ label: string; value: string }> {
  return [
    { label: 'Clipping', value: clipThreshold(thresholds.clip_ceiling_dbfs, MIN_CLIP_RUN_SAMPLES) },
    { label: 'Silence', value: `Below ${formatLevel(thresholds.silence_floor_dbfs)} dBFS for ${seconds(thresholds.min_silence_seconds)} or longer` },
    { label: 'Level shift', value: `A change of ${formatLevel(thresholds.level_shift_lu)} LU or more` },
    { label: 'Room-tone change', value: `A change of ${formatLevel(thresholds.room_tone_step_db)} dB or more between silences` },
    { label: 'Long pause', value: `${seconds(thresholds.pauses.long_pause_seconds)} or longer, only from transcript timing` },
  ];
}

/** Every silence cleanup threshold a check uses (ADR 0238 decision 4), for the panel above the candidate list. */
export function cleanupThresholdRows(thresholds: DiagnosticsCleanupThresholds): Array<{ label: string; value: string }> {
  return [
    { label: 'Hold kept at each side', value: seconds(thresholds.pad_seconds) },
    { label: 'Breath length', value: `${seconds(thresholds.min_breath_seconds)} to ${seconds(thresholds.max_breath_seconds)}` },
    { label: 'Breath level', value: `${formatLevel(thresholds.breath_below_speech_db)} dB or more below the read's speech level` },
    { label: 'Click height', value: `${formatLevel(thresholds.click_above_silence_db)} dB or more above the silence around it` },
  ];
}

const CLEANUP_CLASS_LABELS: Record<string, string> = { silence: 'Silence', breath: 'Breath', click: 'Click' };

/** A cleanup candidate's class ("silence", "breath" or "click"), in words; an unknown class is said as it came. */
export function cleanupClassLabel(finding: Finding): string {
  const value = finding.evidence?.class;
  if (typeof value !== 'string') return 'Candidate';
  return CLEANUP_CLASS_LABELS[value] ?? value[0].toUpperCase() + value.slice(1);
}

/** The candidate's own level (or peak, for a click), with units; undescribed when the evidence lacks it. */
export function cleanupLevelText(finding: Finding): string {
  const level = num(finding.evidence?.level_dbfs);
  const peak = num(finding.evidence?.peak_dbfs);
  if (level === undefined && peak === undefined) return UNDESCRIBED;
  const parts = [level !== undefined ? `${formatLevel(level)} dBFS` : undefined, peak !== undefined ? `${formatLevel(peak)} dBFS peak` : undefined];
  return parts.filter((part): part is string => part !== undefined).join(', ');
}
