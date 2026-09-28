import type { WorkspaceItem, WorkspaceToken } from '../../api/contracts/workspace';

/** One item's tokens that carry a source time (`read`/`misread`; a region kind like `skip` has none), sorted by
 * `start`, for a binary search instead of a linear scan over a chapter's thousands of tokens on every frame. */
type TimedToken = { tokenIndex: number; start: number; end: number };

export type TokenIndex = ReadonlyMap<number, readonly TimedToken[]>;

/** Groups every token that carries a time by its item index (edit-and-proof-workspace.prd.md Phase 2, "Token at
 * time"), so the highlight can look up only the current item's tokens instead of scanning the whole chapter. Build
 * once per alignment result (it never changes while the chapter's tokens don't) and reuse across frames. */
export function buildTokenIndex(tokens: readonly WorkspaceToken[]): TokenIndex {
  const byItem = new Map<number, TimedToken[]>();
  tokens.forEach((token, tokenIndex) => {
    if (token.item === undefined || token.start === undefined || token.end === undefined) return;
    const list = byItem.get(token.item);
    const entry = { tokenIndex, start: token.start, end: token.end };
    if (list) list.push(entry);
    else byItem.set(token.item, [entry]);
  });
  byItem.forEach((list) => list.sort((a, b) => a.start - b.start));
  return byItem;
}

function itemIndexForGuid(items: readonly WorkspaceItem[], itemGuid: string): number | undefined {
  return items.find((candidate) => candidate.itemGuid === itemGuid)?.index;
}

/** The token index whose interval contains `sourceTime` in the item named by `itemGuid`, or the nearest token before
 * it (during a pause between words, or before the alignment's first token for the item) - never a token in a
 * different item. Undefined when the item has no timed tokens at or before this point. */
export function currentTokenIndex(
  tokenIndex: TokenIndex,
  items: readonly WorkspaceItem[],
  itemGuid: string | undefined,
  sourceTime: number,
): number | undefined {
  if (itemGuid === undefined) return undefined;
  const item = itemIndexForGuid(items, itemGuid);
  if (item === undefined) return undefined;
  const timed = tokenIndex.get(item);
  if (!timed || timed.length === 0) return undefined;

  // Binary search for the last entry whose start is <= sourceTime.
  let low = 0;
  let high = timed.length - 1;
  let candidate = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (timed[mid].start <= sourceTime) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (candidate === -1) return undefined;
  return timed[candidate].tokenIndex;
}

/** Where a click on `token` should seek the app player to: the item that read it and the pre-roll before its start
 * (EP5), clamped to the item's own played range. Undefined for a token with no recorded time (a skip, a head/tail
 * boundary) - there is nothing to play from. */
export function seekTargetForToken(
  token: WorkspaceToken,
  items: readonly WorkspaceItem[],
  preRollSeconds: number,
): { itemGuid: string; sourceTime: number } | undefined {
  if (token.item === undefined || token.start === undefined) return undefined;
  const item = items.find((candidate) => candidate.index === token.item);
  if (!item || !item.live) return undefined;
  const floor = item.sourceStart ?? 0;
  return { itemGuid: item.itemGuid, sourceTime: Math.max(floor, token.start - preRollSeconds) };
}
