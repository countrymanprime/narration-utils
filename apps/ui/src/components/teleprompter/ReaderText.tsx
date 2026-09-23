import { Fragment, memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Highlight, highlightKind, type HighlightKind } from '../primitives/Highlight';
import { TooltipTarget } from '../primitives/Tooltip';
import { flagHint } from './readerFlags';
import { segmentWords, splitWords, type ReaderMark, type ReaderMarkTarget, type ReaderRow, type WordSegment } from './readerModel';
import type { TeleprompterFlagKind } from '../../types';

type SkippedRange = [number, number];

const NO_MARKS: ReaderMark[] = [];
const NO_SKIPPED: SkippedRange[] = [];
// The row is `whitespace-pre-line`, so a line break in the source text is kept as one and any other gap is a single space.
const separator = (gap: string): string => (gap.includes('\n') ? '\n' : ' ');
const prefersReducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Every mark goes through `Highlight` (ADR 0016/0017): an entity in its Story Bible category colour, a note in the note
// colour, exactly as the Manuscript reader draws them, and a suspected flag (Phase 7) in the flag kind of the same name.
const FLAG_HIGHLIGHT: Record<TeleprompterFlagKind, HighlightKind> = { misread: 'Misread', extra: 'Extra', skipped: 'Skipped', restart: 'Restart' };
function markHighlight(target: ReaderMarkTarget): HighlightKind {
  if (target.kind === 'flag') return FLAG_HIGHLIGHT[target.flag.kind];
  return target.kind === 'note' ? 'Note' : highlightKind(target.entity.category);
}

// Whether the word at `index` sits ahead of or behind the highlight ("Start here" moves the tracker forward without
// restarting; "Go back to here" is the one-word-back case `nextCursor`/the seek's `jump: 'restart'` exist for). `local`
// alone (not the row's absolute `start` or the session's raw `cursor`) is enough to tell, because `local` is `cursor -
// row.start` clamped to the row's own word range: clamped-low means the whole row is ahead, clamped-high means the whole
// row is behind, and inside the range an index comparison against `local` is exactly a position-vs-cursor comparison.
// This matters for perf, not just convenience: passing the raw `cursor` into this memoized component would re-render
// every row on every paced step (see the comment below), not just the one being read.
const seekDirection = (index: number, local: number): 'Start here' | 'Go back to here' => (index > local ? 'Start here' : 'Go back to here');

type RowWordsProps = {
  words: string[];
  gaps: string[];
  /** Index of the row's first word in the chapter's word list; null for a row the tracker does not follow (no `data-word`, no cursor, no seek). */
  start: number | null;
  local: number;
  skipped: SkippedRange[];
  /** Click-to-seek (Phase 4), reachable only while a session is running (`useTeleprompterSession.seek` rejects otherwise). Absent: words are plain text. */
  onSeek?: (word: number) => void;
  /** This row's story bible and note marks (Phase 5) and flag marks (Phase 7); a stable array per row so memo still skips the rows not being read. */
  marks: ReaderMark[];
  /** Opens a mark's entry in the side rail. Absent: marks are drawn but not interactive. It never seeks or scrolls the reader. */
  onOpenMark?: (mark: ReaderMark) => void;
};

// One word, dimmed once read, underlined when skipped, filled when current. `seekable` is false inside a mark: a mark is
// one button that opens the rail (Phase 5), so the words under it are never also seek buttons (no nested controls, and a
// mark click can never move the tracker). `withGap` keeps the gap after the word inside its span, as before marks existed;
// the last word of a marked segment leaves its gap to `renderMarkedSegment`.
function renderWord(row: RowWordsProps, index: number, seekable: boolean, withGap: boolean): ReactNode {
  const { words, gaps, start, local, skipped, onSeek } = row;
  const word = words[index];
  const position = start === null ? null : start + index;
  const spoken = index < local;
  const missed = position !== null && skipped.some(([from, to]) => position >= from && position < to);
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
      data-word={position ?? undefined}
      data-skipped={missed || undefined}
      style={{
        color: spoken && !missed ? 'var(--text-muted)' : undefined,
        textDecoration: missed ? 'underline dotted var(--warn)' : undefined,
        textUnderlineOffset: missed ? '0.25em' : undefined,
      }}
    >
      {seekable && onSeek && position !== null && !isCurrent ? (
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
      {withGap && separator(gaps[index])}
    </span>
  );
}

// A run of words under one or more marks. Only the innermost (shortest) mark is the control; the marks around it are drawn
// but not buttons, so overlapping marks never nest one button in another (the Manuscript reader's open #155). An outer mark
// is still a control on its own words outside the overlap, and every entry is also listed in the rail (ADR 0116).
// The gap after the last word sits inside the marks that carry on into the next segment and outside the ones that end here,
// so a tint runs on unbroken ("White Rabbit" around its alias "Rabbit", a note around a name) and stops where its mark
// stops. Layers are outermost first and nest, so the ones carrying on are a leading run of them.
function renderMarkedSegment(
  row: RowWordsProps,
  { from, to, marks: layers }: WordSegment<ReaderMarkTarget>,
  next: WordSegment<ReaderMarkTarget> | undefined,
): ReactNode {
  const { gaps, onOpenMark } = row;
  const firstEnding = next === undefined ? 0 : layers.findIndex((mark) => !next.marks.includes(mark));
  const carried = firstEnding === -1 ? layers.length : firstEnding;
  const innermost = layers.length - 1;
  const wrap = (child: ReactNode, mark: ReaderMark, layer: number): ReactNode => {
    const control = Boolean(onOpenMark) && layer === innermost;
    const hint = mark.value.kind === 'flag' ? flagHint(mark.value.flag) : undefined;
    const highlight = (
      <Highlight key={mark.id} kind={markHighlight(mark.value)} description={hint} onActivate={control ? () => onOpenMark?.(mark) : undefined}>
        {child}
      </Highlight>
    );
    // A flag that is the control also shows what was heard as a hint (ADR 0049), flowing with the line it sits in.
    if (!hint || !control) return highlight;
    return (
      <TooltipTarget key={mark.id} text={hint} inline>
        {highlight}
      </TooltipTarget>
    );
  };
  const words = Array.from({ length: to - from }, (_, offset) => renderWord(row, from + offset, false, from + offset < to - 1));
  const gap = separator(gaps[to - 1]);
  const ending = layers.slice(carried).reduceRight<ReactNode>((child, mark, offset) => wrap(child, mark, carried + offset), words);
  const whole =
    carried === 0 ? [ending, gap] : layers.slice(0, carried).reduceRight<ReactNode>((child, mark, layer) => wrap(child, mark, layer), [ending, gap]);
  return (
    <span key={`mark-${from}`} data-marked>
      {whole}
    </span>
  );
}

// The rows above and below the cursor keep the same props on every step, so
// memo lets React skip all of them: only the row being read re-renders.
// `onSeek` and `onOpenMark` must be stable function references (or undefined) across renders - a fresh closure every
// render would defeat that memoization for every row, not just the active one (teleprompter-manuscript-integration.prd.md
// Phase 4).
const RowWords = memo(function RowWords(row: RowWordsProps) {
  const { words, marks } = row;
  const segments = useMemo(() => segmentWords(words.length, marks), [words.length, marks]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.marks.length ? (
          renderMarkedSegment(row, segment, segments[index + 1])
        ) : (
          <Fragment key={`plain-${segment.from}`}>
            {Array.from({ length: segment.to - segment.from }, (_, offset) => renderWord(row, segment.from + offset, true, true))}
          </Fragment>
        ),
      )}
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

function RowContent({
  row,
  cursor,
  skipped,
  onSeek,
  marks,
  onOpenMark,
}: {
  row: ReaderRow;
  cursor: number;
  skipped: SkippedRange[];
  onSeek?: (word: number) => void;
  marks: ReaderMark[];
  onOpenMark?: (mark: ReaderMark) => void;
}) {
  if (row.words !== null && row.gaps !== null)
    return (
      <RowWords
        words={row.words}
        gaps={row.gaps}
        start={row.start}
        local={Math.max(-1, Math.min(cursor - row.start, row.words.length))}
        skipped={skipped}
        onSeek={onSeek}
        marks={marks}
        onOpenMark={onOpenMark}
      />
    );
  // A row the tracker does not follow (before a session, or one whose words disagree with the sidecar's) is plain text,
  // unless it carries marks: then its words are split here so the marks can be drawn, with no cursor, dimming or seek.
  if (!marks.length) return <>{row.text}</>;
  return <UntrackedMarkedRow text={row.text} marks={marks} onOpenMark={onOpenMark} />;
}

function UntrackedMarkedRow({ text, marks, onOpenMark }: { text: string; marks: ReaderMark[]; onOpenMark?: (mark: ReaderMark) => void }) {
  const { words, gaps } = useMemo(() => splitWords(text), [text]);
  return <RowWords words={words} gaps={gaps} start={null} local={-1} skipped={NO_SKIPPED} marks={marks} onOpenMark={onOpenMark} />;
}

export function ReaderText({
  rows,
  cursor,
  skipped,
  follow,
  onSeek,
  marks,
  onOpenMark,
}: {
  rows: ReaderRow[];
  cursor: number;
  skipped: SkippedRange[];
  follow: boolean;
  /** Click-to-seek (teleprompter-manuscript-integration.prd.md Phase 4). Pass a stable reference (see `RowWords`); omit to render plain, unclickable text (no session, or one not yet active). */
  onSeek?: (word: number) => void;
  /** Story bible and note marks by row key (`readerMarks`, Phase 5), with any flag marks (`readerFlags.withMarks`, Phase 7). Keep the map's identity stable while its content is. */
  marks?: Map<string, ReaderMark[]>;
  /** Opens a mark's entry (Phase 5); a stable reference, like `onSeek`. It must not move the cursor or scroll the reader. */
  onOpenMark?: (mark: ReaderMark) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // Follows the cursor only: opening a mark changes neither `cursor` nor `follow`, so it never scrolls the text.
  useEffect(() => {
    if (follow) scrollCursorIntoView(container.current);
  }, [cursor, follow]);

  return (
    <div ref={container} className="space-y-5 text-[1.35rem] leading-[2.1rem]" aria-label="Chapter text" role="region">
      {rows.map((row) => {
        const content = (
          <RowContent row={row} cursor={cursor} skipped={skipped} onSeek={onSeek} marks={marks?.get(row.key) ?? NO_MARKS} onOpenMark={onOpenMark} />
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
