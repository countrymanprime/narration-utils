import type { PassageTake, WorkspaceParagraph, WorkspaceToken } from '../../api/contracts/workspace';
import type { TakeComparisonMember } from '../../api/contracts/takeReview';
import type { AuditionSource } from './AuditionDialog';

/** How many words of a paragraph name the passage in the panel. */
const EXCERPT_WORDS = 8;

/**
 * The passage the Takes panel asks about (edit-and-proof-workspace.prd.md Phase 6): the whole paragraph of the word at
 * the playhead, as the first and last of that paragraph's tokens (a paragraph's tokens are next to each other in the
 * chapter's alignment). With nothing playing it is the paragraph of the first heard word. A heading word has no
 * paragraph, and so no passage.
 */
export function paragraphPassage(
  tokens: readonly WorkspaceToken[],
  index: number | undefined,
): { firstToken: number; lastToken: number; paragraphId: string } | undefined {
  const at = index === undefined ? tokens.find((token) => token.item !== undefined) : tokens[index];
  const paragraphId = at?.p;
  if (at === undefined || paragraphId === undefined) return undefined;
  let firstToken = at.i;
  let lastToken = at.i;
  for (let i = at.i - 1; i >= 0 && tokens[i].p === paragraphId; i -= 1) firstToken = tokens[i].i;
  for (let i = at.i + 1; i < tokens.length && tokens[i].p === paragraphId; i += 1) lastToken = tokens[i].i;
  return { firstToken, lastToken, paragraphId };
}

/** A passage named by its paragraphs (1-based, as the narrator counts them) and the start of their text. */
export function passageLabel(paragraphs: readonly WorkspaceParagraph[], firstParagraph: number, lastParagraph: number): { title: string; excerpt: string } {
  const title = firstParagraph === lastParagraph ? `Paragraph ${firstParagraph + 1}` : `Paragraphs ${firstParagraph + 1} to ${lastParagraph + 1}`;
  const words = (paragraphs[firstParagraph]?.text ?? '').split(/\s+/).filter(Boolean);
  const excerpt = words.slice(0, EXCERPT_WORDS).join(' ') + (words.length > EXCERPT_WORDS ? '…' : '');
  return { title, excerpt };
}

/**
 * What the A/B plays of a take: its whole played range, or, once a comparison timed the passage's words in it, from the
 * first to the last timed word, so the narrator hears the passage and not the rest of the item.
 */
export function auditionRangeOf(take: PassageTake, member: TakeComparisonMember | undefined): AuditionSource {
  const whole = { source_file: take.sourceFile, source_start: take.sourceStart, source_length: take.sourceLength };
  const timed = (member?.words ?? []).filter((word) => word.start !== null && word.end !== null);
  if (timed.length === 0) return whole;
  const start = Math.min(...timed.map((word) => word.start ?? 0));
  const end = Math.max(...timed.map((word) => word.end ?? 0));
  return end > start ? { source_file: take.sourceFile, source_start: start, source_length: end - start } : whole;
}
