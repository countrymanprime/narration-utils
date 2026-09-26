// The words of a chapter's stage suggestion (docs/prds/chapter-stage-recommendations.prd.md Phase 5, ADR 0160 and 0161): what each
// verdict says in the breakdown row, what each unknown cause means and what resolves it, and the summary the estimate card shows.
// Pure functions, so StageSuggestion, StageEvidence and StageSummary only lay them out.
import { STATUS_LABELS } from '../../chapterStatus';
import type { ChapterStatus, StageChapterRecommendation, StageSignal, StageSignalState, StageUnknownCause } from '../../types';
import { COVERAGE_REASON_TEXT } from '../home/recordingCheckText';

export const stageLabel = (stage: ChapterStatus) => STATUS_LABELS[stage];

/**
 * How a cause is resolved. `check`: the chapter's recording check dialog, which also links a track and offers the Whisper model;
 * `tracks`: the Tracks page; `wait`: nothing to do but let the running check end; `check-now`: read the evidence again.
 */
export type StageCauseAction = 'check' | 'tracks' | 'wait' | 'check-now';

/** Each cause in a few words (the row) and what to do about it (the evidence view). */
export const CAUSE_TEXT: Record<StageUnknownCause, { short: string; action: string; resolve: StageCauseAction }> = {
  never_analyzed: { short: 'not checked yet', action: 'Run a recording check of this chapter.', resolve: 'check' },
  stale: { short: 'changed since the last check', action: 'Check the recording again; only the changed items are transcribed.', resolve: 'check' },
  incomplete_run: { short: 'the last check did not finish', action: 'Run the recording check again, to the end.', resolve: 'check' },
  analysis_running: { short: 'a check is running', action: 'Wait for the check to end; the suggestion is read again then.', resolve: 'wait' },
  unmapped_track: { short: 'no track linked', action: 'Link the track in the recording check, or on the Tracks page.', resolve: 'check' },
  unconfirmed_mapping: { short: 'track link not confirmed', action: 'Confirm the matching track in the recording check.', resolve: 'check' },
  multiple_tracks: { short: 'more than one track linked', action: 'Keep one track link on the Tracks page.', resolve: 'tracks' },
  measurement_unavailable: { short: 'cannot be checked here', action: 'The recording check says what it needs first.', resolve: 'check' },
  project_unreadable: { short: 'project file not readable', action: 'Choose or save the REAPER project file, then check now.', resolve: 'tracks' },
  provider_error: { short: 'the evidence could not be read', action: 'Check now to read it again.', resolve: 'check-now' },
};

/** The same causes, worded for the editing check instead of the recording check (editing-readiness-analysis.prd.md
 * Phase 7): the two signal providers share one cause vocabulary (apps/desktop/internal/editing/signals.go reuses
 * `stages.UnknownCause`), so a bare `CAUSE_TEXT` lookup would send an editing signal's "Open recording check" -
 * wrong dialog entirely. `causeText` picks this table instead whenever the signal's id is one of editing's three. */
const EDITING_CAUSE_TEXT: Partial<Record<StageUnknownCause, { short: string; action: string; resolve: StageCauseAction }>> = {
  never_analyzed: { short: 'not checked yet', action: 'Run an editing check of this chapter.', resolve: 'check' },
  stale: { short: 'changed since the last check', action: 'Check editing again; only the changed items are re-decoded.', resolve: 'check' },
  incomplete_run: { short: 'the last check did not finish', action: 'Run the editing check again, to the end.', resolve: 'check' },
  analysis_running: { short: 'a check is running', action: 'Wait for the check to end; the suggestion is read again then.', resolve: 'wait' },
  unmapped_track: { short: 'no track linked', action: 'Link the track in the editing check, or on the Tracks page.', resolve: 'check' },
  unconfirmed_mapping: { short: 'track link not confirmed', action: 'Confirm the matching track in the editing check.', resolve: 'check' },
  multiple_tracks: { short: 'more than one track linked', action: 'Keep one track link on the Tracks page.', resolve: 'tracks' },
  measurement_unavailable: { short: 'cannot be checked here', action: 'The editing check says what it needs first.', resolve: 'check' },
  project_unreadable: { short: 'project file not readable', action: 'Choose or save the REAPER project file, then check now.', resolve: 'tracks' },
  provider_error: { short: 'the evidence could not be read', action: 'Check now to read it again.', resolve: 'check-now' },
};

/** True for the three signal ids the editing-readiness PRD's Phase 6 registers (apps/desktop/internal/editing/signals.go). */
export const isEditingSignal = (signalId: string): boolean => signalId.startsWith('editing.');

/** A signal's cause, worded for whichever check produced it: `stageText.ts`'s `CAUSE_TEXT` is shared by every
 * provider, but "Open recording check" is the wrong sentence, and the wrong dialog, for an editing signal. */
export function causeText(signal: Pick<StageSignal, 'id' | 'cause'>): { short: string; action: string; resolve: StageCauseAction } | undefined {
  if (!signal.cause) return undefined;
  return (isEditingSignal(signal.id) ? EDITING_CAUSE_TEXT[signal.cause] : undefined) ?? CAUSE_TEXT[signal.cause];
}

/** A signal's id as a sentence of what was checked; an id this build does not know is shown as it is. */
const SIGNAL_NAMES: Record<string, string> = {
  'recording.text_present': 'Every paragraph of the chapter’s text is in the recording, in order',
};

export const signalName = (signal: StageSignal) => SIGNAL_NAMES[signal.id] ?? signal.id;

export const SIGNAL_STATE_LABEL: Record<StageSignalState, string> = { met: 'Met', not_met: 'Not met', unknown: 'Can’t tell yet' };

/** The row's one line for a chapter's current verdict, or undefined when the row says nothing (not evaluated). */
export function verdictLine(recommendation: StageChapterRecommendation): string | undefined {
  const target = recommendation.target ? stageLabel(recommendation.target) : '';
  switch (recommendation.verdict) {
    case 'recommended':
      return `Suggested: ${target}`;
    case 'dismissed':
      return `Suggestion dismissed (${target})`;
    case 'not_ready':
      return `Not ready for ${target}`;
    case 'unknown': {
      const cause = recommendation.causes[0];
      return cause ? `Can’t tell yet: ${CAUSE_TEXT[cause].short}` : 'Can’t tell yet';
    }
    case 'none':
      return undefined;
  }
}

/** The headline of the evidence view: the verdict in a sentence. */
export function verdictSentence(recommendation: StageChapterRecommendation): string {
  const target = recommendation.target ? stageLabel(recommendation.target) : '';
  const from = stageLabel(recommendation.from);
  switch (recommendation.verdict) {
    case 'recommended':
      return `Every required check is met, so this chapter looks ready to move from ${from} to ${target}. Nothing changes until you confirm.`;
    case 'dismissed':
      return `You dismissed the suggestion to move this chapter to ${target}. It comes back only when the evidence changes.`;
    case 'not_ready':
      return `A required check is not met, so this chapter is not ready to move from ${from} to ${target}.`;
    case 'unknown':
      return `There is not enough evidence to tell whether this chapter is ready for ${target}. Missing evidence never counts as done.`;
    case 'none':
      return recommendation.noneReason === 'no_required_signals'
        ? `No check for the ${from} stage exists yet, so there is no suggestion for this chapter.`
        : `Chapters in ${from} get no suggestion.`;
  }
}

/** A stale signal's evidence lists the host's reason codes; the recording check's plain sentences say them better. */
export function evidenceValue(kind: string, value: string): string {
  if (kind !== 'stale') return value;
  return value
    .split(/,\s*/)
    .map((code) => COVERAGE_REASON_TEXT[code as keyof typeof COVERAGE_REASON_TEXT] ?? code)
    .join(' ');
}

/** What the estimate card's chips count: chapters that can be confirmed, and chapters whose confirmed evidence changed. */
export function summarize(recommendations: StageChapterRecommendation[]): { suggested: number; changed: number } {
  return {
    suggested: recommendations.filter((item) => item.verdict === 'recommended').length,
    changed: recommendations.filter((item) => item.contradiction).length,
  };
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const AGE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** How old a time is, from `now`: "3 days ago", "just now". Empty when the time cannot be read. */
export function formatAge(value: string, now: number): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '';
  const elapsed = Math.max(0, now - time);
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of AGE_UNITS) {
    if (elapsed >= size) return format.format(-Math.floor(elapsed / size), unit);
  }
  return 'just now';
}
