// How the Review page words a finding. The wire values stay the source of truth (docs/architecture/findings-contract.md);
// everything here is display only, and an unknown value (a newer host, a later analyzer) shows as itself rather than
// failing.
import type { Finding, FindingReviewStatus, FindingSeverity, TakeComparisonEvidence } from '../../types';
import { readKindLabel, spanLabel, takeComparisonEvidence, takeReviewEvidence } from './takeReviewFormat';

/** The script sentences a comparison covers, counted from 1 as the narrator does. */
const comparedSpanLabel = (evidence: TakeComparisonEvidence): string =>
  spanLabel({ kind: '', matched_span_first: evidence.span.first_unit, matched_span_last: evidence.span.last_unit, members: [] });

const CATEGORY_LABELS: Record<string, string> = {
  transcript_discrepancy: 'Transcript difference',
  pronunciation: 'Pronunciation',
  entity: 'Story Bible entry',
  pickup: 'Pickup',
  duplicate_read: 'Duplicate read',
  take_comparison: 'Take comparison',
  character_continuity: 'Character continuity',
  pacing: 'Pacing',
  audio_quality: 'Audio quality',
  delivery_qc: 'Delivery check',
  silence_cleanup: 'Silence cleanup',
  level_consistency: 'Level consistency',
};

const ANALYZER_LABELS: Record<string, string> = {
  'transcript-compare': 'Proofing comparison',
  'story-bible': 'Story Bible',
  'take-review': 'Take review',
  'take-comparison': 'Take comparison',
};

export const STATUS_LABELS: Record<FindingReviewStatus, string> = {
  unreviewed: 'To review',
  accepted: 'Accepted',
  dismissed: 'Dismissed',
  deferred: 'Deferred',
};

const SEVERITY_LABELS: Record<FindingSeverity, string> = { error: 'Error', warning: 'Warning', info: 'Info' };

// Transcript Compare's evidence.kind (apps/desktop/internal/transcript/findings_adapter.go).
const KIND_LABELS: Record<string, string> = { MISREAD: 'Misread', SKIPPED: 'Skipped', EXTRA: 'Extra words' };

// The Story Bible adapter's evidence.condition (apps/desktop/internal/guide/findings_adapter.go).
const CONDITION_LABELS: Record<string, string> = {
  needs_review: 'The entry is marked "needs review"',
  low_confidence_pronunciation: 'Its pronunciation is uncertain',
};

/** A wire value with no label reads as words, not as an identifier: "audio_quality" becomes "Audio quality". */
const humanize = (value: string): string => {
  const words = value.replace(/[_-]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : value;
};

export const categoryLabel = (category: string): string => CATEGORY_LABELS[category] ?? humanize(category);
export const analyzerLabel = (analyzer: string): string => ANALYZER_LABELS[analyzer] ?? humanize(analyzer);
export const severityLabel = (severity: FindingSeverity): string => SEVERITY_LABELS[severity] ?? humanize(severity);

/** "90%", or "No score" when the analyzer has no numeric confidence (its reason says why). */
export const confidenceLabel = (confidence: number | null): string => (confidence === null ? 'No score' : `${Math.round(confidence * 100)}%`);

/** Project seconds as m:ss.s, the precision the analyzers report. */
export function formatTime(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

export const chapterLabel = (finding: Finding): string => finding.manuscript?.chapter_title || finding.manuscript?.chapter_id || 'No chapter';

/** One line that says what the finding is about, for the list: what was expected and what was heard, or the entry it names. */
export function findingSummary(finding: Finding): string {
  const reads = takeReviewEvidence(finding);
  if (reads) return `${readKindLabel(reads.kind)}: ${reads.members.length} reads of ${spanLabel(reads).toLowerCase()}`;
  const comparison = takeComparisonEvidence(finding);
  if (comparison) return `${comparison.members.length} reads of ${comparedSpanLabel(comparison).toLowerCase()}, side by side`;
  const expected = finding.manuscript?.expected;
  const recorded = finding.manuscript?.recorded;
  if (expected && recorded) return `“${expected}” read as “${recorded}”`;
  if (expected && finding.category === 'transcript_discrepancy') return `“${expected}” not heard`;
  if (recorded && finding.category === 'transcript_discrepancy') return `“${recorded}” heard, not in the script`;
  if (expected) return `“${expected}”`;
  if (recorded) return `“${recorded}”`;
  return categoryLabel(finding.category);
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** The analyzer-specific evidence the page knows how to word, as label and value pairs in reading order; unknown keys are left out. */
export function evidenceRows(finding: Finding): Array<{ label: string; value: string }> {
  const reads = takeReviewEvidence(finding);
  if (reads) {
    // A take-review group: its reads are listed on their own, under the evidence.
    return [
      { label: 'Kind', value: readKindLabel(reads.kind) },
      { label: 'In the script', value: spanLabel(reads) },
      { label: 'Reads', value: String(reads.members.length) },
    ];
  }
  const comparison = takeComparisonEvidence(finding);
  if (comparison) {
    // A take comparison: its reads are set side by side on their own, under the evidence.
    return [
      { label: 'In the script', value: comparedSpanLabel(comparison) },
      { label: 'Reads compared', value: `${comparison.compared} of ${comparison.members.length}` },
      { label: 'Transcribed with', value: `Whisper ${comparison.model}` },
    ];
  }
  const evidence = finding.evidence ?? {};
  const rows: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: string | undefined) => value && rows.push({ label, value });
  const kind = text(evidence.kind);
  add('Kind', kind && (KIND_LABELS[kind] ?? humanize(kind.toLowerCase())));
  const condition = text(evidence.condition);
  add('Why', condition && (CONDITION_LABELS[condition] ?? humanize(condition)));
  add('Pronunciation confidence', text(evidence.pronunciation_confidence));
  add('Script', text(evidence.script_context));
  add('Recording', text(evidence.audio_context));
  add('Excerpt', text(evidence.excerpt));
  if (typeof evidence.timing_gap_seconds === 'number') add('Pause at the boundary', `${evidence.timing_gap_seconds.toFixed(2)} s`);
  add('Existing REAPER marker', text(evidence.existing_marker_name));
  return rows;
}

/** When the decision was recorded, in the narrator's own locale; the raw text when it is not a date. */
export function formatDecidedAt(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
