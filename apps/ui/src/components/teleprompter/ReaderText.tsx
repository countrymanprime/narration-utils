import { memo, useEffect, useRef } from 'react';
import { Highlight } from '../primitives/Highlight';
import type { ReaderRow } from './readerModel';

type SkippedRange = [number, number];
type TrackedRow = ReaderRow & { words: string[]; gaps: string[] };

const isTracked = (row: ReaderRow): row is TrackedRow => row.words !== null && row.gaps !== null;
// The row is `whitespace-pre-line`, so a line break in the source text is kept as one and any other gap is a single space.
const separator = (gap: string): string => (gap.includes('\n') ? '\n' : ' ');
const prefersReducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Whether the word at `index` sits ahead of or behind the highlight ("Start here" moves the tracker forward without
// restarting; "Go back to here" is the one-word-back case `nextCursor`/the seek's `jump: 'restart'` exist for). `local`
// alone (not the row's absolute `start` or the session's raw `cursor`) is enough to tell, because `local` is `cursor -
// row.start` clamped to the row's own word range: clamped-low means the whole row is ahead, clamped-high means the whole
// row is behind, and inside the range an index comparison against `local` is exactly a position-vs-cursor comparison.
// This matters for perf, not just convenience: passing the raw `cursor` into this memoized component would re-render
// every row on every paced step (see the comment below), not just the one being read.
const seekDirection = (index: number, local: number): 'Start here' | 'Go back to here' => (index > local ? 'Start here' : 'Go back to here');

// The rows above and below the cursor keep the same props on every step, so
// memo lets React skip all of them: only the row being read re-renders.
// `onSeek` must be a stable function reference (or undefined) across renders - a fresh closure every render would defeat
// that memoization for every row, not just the active one (teleprompter-manuscript-integration.prd.md Phase 4).
const TrackedWords = memo(function TrackedWords({
  row,
  local,
  skipped,
  onSeek,
}: {
  row: TrackedRow;
  local: number;
  skipped: SkippedRange[];
  /** Click-to-seek (Phase 4), reachable only while a session is running (`useTeleprompterSession.seek` rejects otherwise). Absent: words are plain text, as before this phase. */
  onSeek?: (word: number) => void;
}) {
  return (
    <>
      {row.words.map((word, index) => {
        const position = row.start + index;
        const spoken = index < local;
        const missed = skipped.some(([from, to]) => position >= from && position < to);
        const isCurrent = index === local;
        const wordNode = isCurrent ? (
          <span data-current-word>
            <Highlight kind="Cursor">{word}</Highlight>
          </span>
        ) : (
          word
        );
        return (
          <span
            key={index}
            data-word={position}
            data-skipped={missed || undefined}
            style={{
              color: spoken && !missed ? 'var(--text-muted)' : undefined,
              textDecoration: missed ? 'underline dotted var(--warn)' : undefined,
              textUnderlineOffset: missed ? '0.25em' : undefined,
            }}
          >
            {onSeek && !isCurrent ? (
              <button
                type="button"
                aria-label={`${seekDirection(index, local)}: "${word}"`}
                onClick={() => onSeek(position)}
                className="cursor-pointer rounded-[0.1rem] border-0 bg-transparent p-0 hover:bg-[var(--surface-2)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
                style={{ font: 'inherit', color: 'inherit', textAlign: 'inherit' }}
              >
                {wordNode}
              </button>
            ) : (
              wordNode
            )}
            {separator(row.gaps[index])}
          </span>
        );
      })}
    </>
  );
});

function scrollCursorIntoView(container: HTMLElement | null) {
  const word = container?.querySelector<HTMLElement>('[data-current-word]');
  if (!word || typeof word.scrollIntoView !== 'function') return;
  const { top, bottom } = word.getBoundingClientRect();
  const height = window.innerHeight;
  if (top > height * 0.25 && bottom < height * 0.7) return;
  word.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

export function ReaderText({
  rows,
  cursor,
  skipped,
  follow,
  onSeek,
}: {
  rows: ReaderRow[];
  cursor: number;
  skipped: SkippedRange[];
  follow: boolean;
  /** Click-to-seek (teleprompter-manuscript-integration.prd.md Phase 4). Pass a stable reference (see `TrackedWords`); omit to render plain, unclickable text (no session, or one not yet active). */
  onSeek?: (word: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow) scrollCursorIntoView(container.current);
  }, [cursor, follow]);

  return (
    <div ref={container} className="space-y-5 text-[1.35rem] leading-[2.1rem]" aria-label="Chapter text" role="region">
      {rows.map((row) => {
        const content = isTracked(row) ? (
          <TrackedWords row={row} local={Math.max(-1, Math.min(cursor - row.start, row.words.length))} skipped={skipped} onSeek={onSeek} />
        ) : (
          row.text
        );
        return row.kind === 'title' ? (
          <h2 key={row.key} className="font-['Barlow_Condensed',sans-serif] text-[1.7rem] leading-tight font-semibold tracking-[0.02em] uppercase">
            {content}
          </h2>
        ) : (
          <p key={row.key} className="whitespace-pre-line">
            {content}
          </p>
        );
      })}
    </div>
  );
}
