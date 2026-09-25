// The words of the recording check (docs/utilities/recording-coverage.md, ADR 0130): every reason the host can give
// for a check it refused or a result it cannot trust, in the narrator's terms, and the sentences a stored report is read
// out as. Pure functions, so the dialog only lays them out.
import type { CoverageJudgement, CoverageReason, CoverageRegion, CoverageRegionKind, CoverageReport, ManuscriptChapter } from '../../types';

/**
 * One plain sentence per reason. The host also sends its own message with a refusal, but that one is written for a log
 * (it can name an item GUID), so it is shown only as the detail under this sentence.
 */
export const COVERAGE_REASON_TEXT: Record<CoverageReason, string> = {
  no_project: 'Open a project first.',
  no_project_file: 'Choose the saved REAPER project file on the Tracks page first.',
  project_unreadable: 'The saved REAPER project file could not be read. Save it again in REAPER.',
  no_manuscript: 'Import a manuscript first.',
  chapter_not_found: 'This chapter is no longer in the manuscript.',
  not_narration: 'Only narration chapters are checked, not front matter or reference sections.',
  unmapped: 'Link this chapter to the REAPER track it is recorded on first.',
  multiple_tracks: 'This chapter is linked to more than one REAPER track. Keep one link on the Tracks page.',
  mapped_track_missing: 'The REAPER track this chapter is linked to is no longer in the saved project. Clear the link and link it again on the Tracks page.',
  no_items: 'The chapter’s track has no audio in the saved project.',
  unsupported_item: 'An item on the chapter’s track is not an audio file the check can read.',
  source_missing: 'An audio file on the chapter’s track is missing.',
  item_unreadable: 'An audio file on the chapter’s track could not be read.',
  busy: 'Another recording check is running. Wait for it to finish.',
  sidecar_missing: 'Set up the Transcript Compare tool in Settings first.',
  invalid_params: 'The recording check settings are not valid.',
  manuscript_changed: 'The chapter’s text changed since this check.',
  result_missing: 'The result of the last check could not be read. Check again.',
  item_added: 'Audio was added to the chapter’s track since this check.',
  item_removed: 'Audio was removed from the chapter’s track since this check.',
  item_trimmed: 'An item on the chapter’s track was trimmed since this check.',
  item_moved: 'An item on the chapter’s track was moved since this check.',
  item_muted: 'An item on the chapter’s track was muted or unmuted since this check.',
  take_switched: 'A different take was chosen on the chapter’s track since this check.',
  source_changed: 'An audio file on the chapter’s track changed since this check.',
  analyzer_changed: 'The recording check itself was updated since this check.',
  params_changed: 'The recording check settings changed since this check.',
  mapping_changed: 'The chapter was linked to a different track since this check.',
};

/**
 * The reasons a narrator answers by linking the chapter to a track, right there in the dialog (analysis evidence ledger, Phase 7). Only a
 * chapter with no link at all: a link to a missing track has to be cleared first, or a new one would make two, so that one goes to Tracks.
 */
export const LINK_REASONS: ReadonlySet<CoverageReason> = new Set(['unmapped']);

/** Where a reason that is not answered in the dialog is fixed, as a page the dialog can link to. */
export const REASON_PAGE: Partial<Record<CoverageReason, { path: string; label: string }>> = {
  no_project_file: { path: '/tracks', label: 'Open Tracks' },
  multiple_tracks: { path: '/tracks', label: 'Open Tracks' },
  mapped_track_missing: { path: '/tracks', label: 'Open Tracks' },
  sidecar_missing: { path: '/settings', label: 'Open Settings' },
};

export const REGION_LABEL: Record<CoverageRegionKind, string> = {
  head: 'Start not read',
  tail: 'End not read',
  skip: 'Skipped',
  short_read: 'Read short',
  different_text: 'Different text read',
};

export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** "0:07", "3:05", "1:02:09": a position in an audio file. */
export function formatAudioTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * The report's headline. With a judgement (recording-check-summary PRD Phase 2, ADR 0204) it leads with the host's
 * pass/fail, the same rule the stage signal uses, so the dialog and the stage engine never disagree: "Passes the
 * check" or "Not complete", with the judgement's own reason (the gap that fails first, or the present-word count) as
 * the detail. Without one - an older stored result, or a result missing entirely - it falls back to the plain word
 * count ADR 0130 originally specified.
 */
export function verdict(report: CoverageReport, judgement?: CoverageJudgement): { complete: boolean; headline: string; detail: string } {
  if (judgement) {
    const complete = judgement.state === 'met';
    return { complete, headline: complete ? 'Passes the check' : 'Not complete', detail: judgement.reason };
  }
  const complete = report.missingTokens === 0;
  return {
    complete,
    headline: complete ? 'All the text is recorded' : `${plural(report.missingTokens, 'word')} not recorded`,
    detail: `Text present: ${report.presentTokens.toLocaleString()} of ${plural(report.bodyTokens, 'word')}.`,
  };
}

/** RS2 A (recording-check-summary.prd.md): an unread start or end is unfinished recording, not a pickup - stated in the
 * summary as "Recorded to paragraph N of M" or "Start not read: paragraphs 1 to K", never listed with the interior
 * gaps (skip, short_read, different_text). undefined when the chapter has no head or tail region (every gap, if any,
 * is interior). A tail wins over a head if somehow both are present (a chapter this sparse needs the "unfinished"
 * framing regardless of which end is missing). */
export function recordedTo(
  report: CoverageReport,
  chapter: ManuscriptChapter,
): { kind: 'head' | 'tail'; paragraph: number; total: number; wordsLeft: number } | undefined {
  const total = report.paragraphs.length;
  const tail = report.regions.find((region) => region.kind === 'tail');
  if (tail) {
    const numbers = paragraphRefs(chapter, tail.paragraphIds).map((ref) => ref.number);
    return { kind: 'tail', paragraph: Math.max(0, Math.min(...numbers) - 1), total, wordsLeft: tail.tokenCount };
  }
  const head = report.regions.find((region) => region.kind === 'head');
  if (head) {
    const numbers = paragraphRefs(chapter, head.paragraphIds).map((ref) => ref.number);
    return { kind: 'head', paragraph: Math.max(...numbers), total, wordsLeft: head.tokenCount };
  }
  return undefined;
}

/** A paragraph's number within its chapter (1 is the chapter's first paragraph) and its index in the whole manuscript, for a link. */
type ParagraphRef = { number: number; index?: number };

export function paragraphRefs(chapter: ManuscriptChapter, ids: string[]): ParagraphRef[] {
  const order = chapter.paragraphIds ?? [];
  return ids.map((id, fallback) => {
    const position = order.findIndex((paragraph) => paragraph.id === id);
    return position < 0 ? { number: fallback + 1 } : { number: position + 1, index: order[position].index };
  });
}

/** "paragraph 12", "paragraphs 38 to 40", "paragraphs 3, 5 and 9". */
export function describeParagraphs(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  if (sorted.length === 0) return 'no paragraph';
  if (sorted.length === 1) return `paragraph ${sorted[0]}`;
  const consecutive = sorted.every((value, index) => index === 0 || value === sorted[index - 1] + 1);
  if (consecutive) return `paragraphs ${sorted[0]} to ${sorted[sorted.length - 1]}`;
  return `paragraphs ${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]}`;
}

/** "paragraphs 38 to 40: 14 words, from “the” to “end.”" */
export function describeRegion(region: CoverageRegion, refs: ParagraphRef[]): string {
  const words = region.tokenCount === 1 ? `“${region.firstWord}”` : `from “${region.firstWord}” to “${region.lastWord}”`;
  return `${describeParagraphs(refs.map((ref) => ref.number))}: ${plural(region.tokenCount, 'word')}, ${words}`;
}

/** Where the gap sits in the audio: "Item 2 of the track, at 3:05 in its audio file". */
export function describePosition(region: CoverageRegion): string | undefined {
  if (!region.position) return undefined;
  return `Item ${region.position.itemIndex + 1} of the track, at ${formatAudioTime(region.position.sourceTime)} in its audio file`;
}

/** "Checked 21 Sep 2026, 10:00" in the narrator's locale; the raw value when it is not a date. */
export function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
