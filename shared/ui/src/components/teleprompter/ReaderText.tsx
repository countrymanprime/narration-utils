import { memo, useEffect, useRef } from 'react';
import { Highlight } from '../primitives/Highlight';
import type { ReaderRow } from './readerModel';

type SkippedRange = [number, number];
type TrackedRow = ReaderRow & { words: string[]; gaps: string[] };

const isTracked = (row: ReaderRow): row is TrackedRow => row.words !== null && row.gaps !== null;
// The row is `whitespace-pre-line`, so a line break in the source text is kept as one and any other gap is a single space.
const separator = (gap: string): string => (gap.includes('\n') ? '\n' : ' ');
const prefersReducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// The rows above and below the cursor keep the same props on every step, so
// memo lets React skip all of them: only the row being read re-renders.
const TrackedWords = memo(function TrackedWords({ row, local, skipped }: { row: TrackedRow; local: number; skipped: SkippedRange[] }) {
  return (
    <>
      {row.words.map((word, index) => {
        const position = row.start + index;
        const spoken = index < local;
        const missed = skipped.some(([from, to]) => position >= from && position < to);
        return (
          <span
            key={index}
            data-word={position}
            data-skipped={missed || undefined}
            style={{
              color: spoken && !missed ? 'var(--text-faint)' : undefined,
              textDecoration: missed ? 'underline dotted var(--warn)' : undefined,
              textUnderlineOffset: missed ? '0.25em' : undefined,
            }}
          >
            {index === local ? (
              <span data-current-word>
                <Highlight kind="Cursor">{word}</Highlight>
              </span>
            ) : (
              word
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

export function ReaderText({ rows, cursor, skipped, follow }: { rows: ReaderRow[]; cursor: number; skipped: SkippedRange[]; follow: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow) scrollCursorIntoView(container.current);
  }, [cursor, follow]);

  return (
    <div ref={container} className="space-y-5 text-[1.35rem] leading-[2.1rem]" aria-label="Chapter text" role="region">
      {rows.map((row) => {
        const content = isTracked(row) ? (
          <TrackedWords row={row} local={Math.max(-1, Math.min(cursor - row.start, row.words.length))} skipped={skipped} />
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
