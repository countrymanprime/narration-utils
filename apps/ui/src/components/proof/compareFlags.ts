import type { Discrepancy } from '../../types';
import type { WorkspaceToken } from '../../api/contracts/workspace';
import { FLAG_LABEL, type Flag, type FlagKind } from './flags';

/** Transcript Compare's discrepancy kinds as the chapter view's flag kinds. */
const KIND_FOR: Record<string, FlagKind> = { MISREAD: 'misread', SKIPPED: 'skip', EXTRA: 'extra' };

/** The check-derived kinds a discrepancy attaches to in place, rather than adding a second flag on the same words:
 * the recording check already flagged them, and the comparison is a second opinion on the same event. */
const ATTACHABLE: Partial<Record<FlagKind, readonly FlagKind[]>> = {
  misread: ['misread', 'partial', 'skip', 'not_recorded'],
  skip: ['misread', 'partial', 'skip', 'not_recorded'],
};

const normalise = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** The token a discrepancy sits on: in its paragraph (the manuscript's global paragraph index, mapped to the
 * chapter's paragraph id), the first word of what the script says, or the paragraph's first word when that is not
 * found (an EXTRA has no script words). `undefined` when the paragraph is not this chapter's or has no tokens. */
function anchorToken(row: Discrepancy, tokens: readonly WorkspaceToken[], paragraphIds: readonly { id: string; index: number }[]): number | undefined {
  const paragraphId = paragraphIds.find((entry) => entry.index === row.paragraph)?.id;
  if (!paragraphId) return undefined;
  const inParagraph = tokens.map((token, index) => ({ token, index })).filter(({ token }) => token.p === paragraphId);
  if (inParagraph.length === 0) return undefined;
  const firstWord = row.kind === 'EXTRA' ? '' : normalise(row.docText.split(/\s+/)[0] ?? '');
  const match = firstWord ? inParagraph.find(({ token }) => normalise(token.text) === firstWord) : undefined;
  return (match ?? inParagraph[0]).index;
}

/**
 * Folds a Transcript Compare run's discrepancies for this chapter into the chapter view's flags
 * (stage-navigation-and-page-replacement.prd.md Phase 5: the Proofing page's results become the chapter's misread
 * flags, with the inline diff in the flag detail). A misread or skip whose word the recording check already flagged
 * attaches to that flag (`discrepancy` is set on it, nothing is duplicated); every other discrepancy is its own flag,
 * placed on its word when it can be found in its paragraph and first otherwise. Flags come back in text order.
 */
export function overlayDiscrepancies(
  flags: readonly Flag[],
  rows: readonly Discrepancy[],
  tokens: readonly WorkspaceToken[],
  paragraphIds: readonly { id: string; index: number }[],
): Flag[] {
  if (rows.length === 0) return [...flags];
  const merged = flags.map((flag) => ({ ...flag }));
  const added: Flag[] = [];
  rows.forEach((row) => {
    const kind = KIND_FOR[row.kind] ?? 'misread';
    const anchor = anchorToken(row, tokens, paragraphIds);
    const attachable = ATTACHABLE[kind];
    const target =
      anchor !== undefined && attachable
        ? merged.find((flag) => !flag.discrepancy && attachable.includes(flag.kind) && flag.tokenStart <= anchor && flag.tokenEnd >= anchor)
        : undefined;
    if (target) {
      target.discrepancy = row;
      return;
    }
    const at = anchor ?? -1;
    added.push({
      id: `compare-${row.id}`,
      kind,
      label: FLAG_LABEL[kind],
      tokenStart: at,
      tokenEnd: at,
      seekTokenIndex: anchor !== undefined && tokens[anchor]?.start !== undefined ? anchor : undefined,
      heard: row.audioText,
      script: row.docText,
      analyzer: 'transcript-compare',
      discrepancy: row,
    });
  });
  return [...merged, ...added].sort((a, b) => a.tokenStart - b.tokenStart || a.tokenEnd - b.tokenEnd);
}
