import type { Finding } from '../../types';
import type { WorkspaceItem, WorkspaceToken } from '../../api/contracts/workspace';
import { FLAG_LABEL, type Flag, type FlagKind } from './flags';

/** The check-derived kinds a `transcript_discrepancy` or `duplicate_read` finding may attach to in place, rather than
 * spawning a second, redundant flag on the same words (edit-and-proof-workspace.prd.md Phase 4 architecture, "A
 * finding with an item GUID and a source range maps onto tokens ... same item, overlapping source time"): the check
 * already flagged the word or run from its own alignment (Phase 2); the finding is the same event, reviewable. */
const ATTACHABLE_KIND: Partial<Record<string, readonly FlagKind[]>> = {
  transcript_discrepancy: ['misread', 'partial', 'skip', 'not_recorded'],
  duplicate_read: ['extra'],
};

/** The flag kind a finding creates when nothing on the text already flags its words (no check-derived flag to attach
 * to): a category the Evidence table names for the text overlay. A category not listed here (take_comparison, and
 * anything without an item GUID and a source range) never becomes an inline flag - it stays reviewable on the Review
 * page only, exactly as before this phase. */
const STANDALONE_KIND: Partial<Record<string, FlagKind>> = {
  pickup: 'pickup',
  duplicate_read: 'extra',
  silence_cleanup: 'cleanup',
};

function itemIndexForGuid(items: readonly WorkspaceItem[], itemGuid: string): number | undefined {
  return items.find((candidate) => candidate.itemGuid === itemGuid)?.index;
}

/** The chapter tokens (in `tokens`' order) whose recorded source time overlaps [start, end] on item `itemIndex`, or
 * `undefined` when nothing in the alignment was heard there - the finding still exists, but there is nothing on the
 * text for it to sit on this run. */
function overlappingTokenRange(
  tokens: readonly WorkspaceToken[],
  itemIndex: number,
  start: number,
  end: number,
): { tokenStart: number; tokenEnd: number; seekTokenIndex: number } | undefined {
  let first: number | undefined;
  let last: number | undefined;
  tokens.forEach((token, index) => {
    if (token.item !== itemIndex || token.start === undefined || token.end === undefined) return;
    if (token.start > end || token.end < start) return;
    if (first === undefined) first = index;
    last = index;
  });
  if (first === undefined || last === undefined) return undefined;
  return { tokenStart: first, tokenEnd: last, seekTokenIndex: first };
}

/** Whether `flag` sits over the same words as [tokenStart, tokenEnd] (edges may fall inside one another, not just
 * match exactly - a run of three skipped words and a one-word finding inside it are the same event). */
function flagOverlaps(flag: Flag, tokenStart: number, tokenEnd: number): boolean {
  return flag.tokenStart <= tokenEnd && flag.tokenEnd >= tokenStart;
}

/**
 * Overlays the chapter's stored findings onto the check-derived flags (edit-and-proof-workspace.prd.md Phase 4):
 * a `transcript_discrepancy` or `duplicate_read` finding whose item and source-time range overlap an existing flag's
 * tokens attaches to it in place (the flag becomes reviewable: `findingId`, `analyzer`, `confidence` are set on the
 * same flag object, nothing is duplicated); every other finding with an item GUID and a source range, of a category
 * the text overlay knows (pickup, duplicate_read, silence_cleanup), becomes its own flag anchored on the tokens its
 * range covers. A finding with no `source.item_guid`, no `time_range`, an item the saved project no longer has, or a
 * range that overlaps nothing heard is left off the text; it stays reviewable on the Review page, unchanged.
 * `not_in_latest_run` findings are excluded - the workspace shows only what the current check can still place.
 */
export function overlayFindings(
  flags: readonly Flag[],
  findings: readonly Finding[],
  items: readonly WorkspaceItem[],
  tokens: readonly WorkspaceToken[],
): Flag[] {
  const merged = flags.map((flag) => ({ ...flag }));
  const added: Flag[] = [];

  findings.forEach((finding) => {
    if (finding.not_in_latest_run) return;
    const itemGuid = finding.source.item_guid;
    const range = finding.time_range;
    if (!itemGuid || !range) return;
    const start = range.source_start ?? range.start;
    const end = range.source_end ?? range.end;
    const itemIndex = itemIndexForGuid(items, itemGuid);
    if (itemIndex === undefined) return;
    const anchor = overlappingTokenRange(tokens, itemIndex, start, end);
    if (!anchor) return;

    const attachableKinds = ATTACHABLE_KIND[finding.category];
    const target = attachableKinds && merged.find((flag) => attachableKinds.includes(flag.kind) && flagOverlaps(flag, anchor.tokenStart, anchor.tokenEnd));
    if (target) {
      target.findingId = finding.id;
      target.analyzer = finding.analyzer;
      target.confidence = finding.confidence;
      target.evidenceVersion = finding.evidence_version;
      target.reviewStatus = finding.review.status;
      return;
    }

    const standaloneKind = STANDALONE_KIND[finding.category];
    if (!standaloneKind) return;
    added.push({
      id: `finding-${finding.id}`,
      kind: standaloneKind,
      label: FLAG_LABEL[standaloneKind],
      tokenStart: anchor.tokenStart,
      tokenEnd: anchor.tokenEnd,
      seekTokenIndex: anchor.seekTokenIndex,
      heard: finding.manuscript?.recorded,
      findingId: finding.id,
      analyzer: finding.analyzer,
      confidence: finding.confidence,
      evidenceVersion: finding.evidence_version,
      reviewStatus: finding.review.status,
    });
  });

  return [...merged, ...added].sort((a, b) => a.tokenStart - b.tokenStart || a.tokenEnd - b.tokenEnd);
}
