import { Fragment, memo, useCallback, useMemo, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import {
  boothUnits,
  readingParagraphs,
  unitWords,
  type BoothUnit,
  type ParagraphNote,
  type ReadingParagraph,
  type UnitWords,
  type WordDecoration,
} from './boothUnits';
import { positionOf, unitAtPosition, type ReadingPosition } from './readingPosition';
import { SpeakerChip } from './SpeakerChip';
import { useBrowseView, type BrowseView } from './useBrowseView';

/** The Booth text sizes: 24 to 72 px in steps of 4. */
export const TEXT_SIZE = { min: 24, max: 72, step: 4 } as const;
export const textSizePx = (size: number): number => Math.min(TEXT_SIZE.max, Math.max(TEXT_SIZE.min, Math.round(size / TEXT_SIZE.step) * TEXT_SIZE.step));

type PickupLine = { paragraphId: string; done: boolean };

type Props = {
  paragraphs: readonly ReadingParagraph[];
  /** Where the narrator is. Left out: the first word. */
  position?: ReadingPosition;
  /** The view has been moved off the reading position by the wheel or the page keys. */
  browse: boolean;
  onBrowse: (on: boolean) => void;
  /** A click on a word. The view also snaps back from browsing. */
  onSeek: (paragraphId: string, word: number) => void;
  /** A click on a note under a paragraph, by the note's id. */
  onNote?: (id: string) => void;
  /** A click on empty space: not on a sentence, a note or a speaker chip. */
  onBackground?: () => void;
  /** Who can speak a quoted phrase, narrator excluded; the picker offers these. */
  speakers: readonly string[];
  /** The speaker's entity colour token (`--speaker-2`), by name. */
  speakerColour?: (speaker: string) => string | undefined;
  onSetSpeaker: (phraseKey: string, speaker: string) => void;
  /** Story Bible tints and marked-word underlines, and the notes drawn under a paragraph. */
  decorations?: readonly WordDecoration[];
  notes?: readonly ParagraphNote[];
  /** Paragraphs a suspected skip or restart points at, and the sentence a take starts from (punch). */
  pickupLines?: readonly PickupLine[];
  punchAt?: number | null;
  /** Px; the page slice owns the preference. Clamped to 24 to 72 in steps of 4. */
  size: number;
  /** A CSS font-family for the text. */
  font?: string;
  viewRef?: Ref<BrowseView>;
  /** Drawn inside the text column, which is `relative` and moves with the text: the bookmark ribbons (`BookmarkRibbons`). */
  margin?: ReactNode;
};

type Mode = 'done' | 'cur' | 'next';

type UnitProps = {
  unit: BoothUnit;
  index: number;
  mode: Mode;
  wcur: number;
  words: UnitWords;
  paragraph: ReadingParagraph;
  from: boolean;
  speakers: readonly string[];
  colour?: string;
  onSeek: (paragraphId: string, word: number) => void;
  onSetSpeaker: (phraseKey: string, speaker: string) => void;
  seekWord: (unit: BoothUnit, word: number) => number;
};

// Only what has been read is dimmed: the sentence being read and every sentence not yet read keep the full text colour (the mock's --bup is --ink).
const MODE_TONE: Record<Mode, string> = { done: 'text-[var(--text-muted)]', cur: 'text-[var(--text)]', next: 'text-[var(--text)]' };

// One sentence. A click on a word seeks to it; a click between words seeks to the sentence's first word.
const UnitView = memo(function UnitView({ unit, index, mode, wcur, words, paragraph, from, speakers, colour, onSeek, onSetSpeaker, seekWord }: UnitProps) {
  return (
    <>
      {unit.quoted && !unit.cont ? (
        <SpeakerChip phraseKey={unit.key} speaker={unit.speaker} confirmed={unit.confirmed} colour={colour} speakers={speakers} onSetSpeaker={onSetSpeaker} />
      ) : null}
      <span
        data-unit={index}
        data-state={mode}
        className={`cursor-pointer rounded-md transition-colors ${MODE_TONE[mode]} ${from ? 'bg-[var(--accent-soft)]' : ''}`}
        onClick={(event) => {
          const word = (event.target as HTMLElement).closest<HTMLElement>('[data-word]');
          onSeek(paragraph.id, seekWord(unit, word ? Number(word.dataset.word) : 0));
        }}
      >
        {words.lead}
        {words.words.map((token) => {
          const now = mode === 'cur' && token.index === wcur;
          const said = mode === 'cur' && token.index < wcur;
          const tint = token.entity ? `border-b-2 border-[var(--ek)] bg-[color-mix(in_srgb,var(--ek)_16%,transparent)]` : '';
          const mark = token.mark ? 'border-b-[3px] border-[var(--mcb)]' : '';
          return (
            <Fragment key={token.index}>
              <span
                data-word={token.index}
                data-current={now ? '' : undefined}
                aria-current={now ? 'true' : undefined}
                aria-description={now ? 'Current word' : undefined}
                title={token.mark?.title}
                style={
                  {
                    ...(token.entity ? { '--ek': `var(${token.entity.colour})` } : {}),
                    ...(token.mark ? { '--mcb': `var(${token.mark.colour})` } : {}),
                  } as CSSProperties
                }
                className={`relative rounded-[0.12em] transition-colors ${tint} ${mark} ${said ? 'text-[var(--text-muted)]' : ''} ${
                  now
                    ? 'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_0_0.08em_var(--accent)] before:absolute before:top-[-0.3em] before:left-1/2 before:-translate-x-1/2 before:border-x-[0.18em] before:border-t-[0.2em] before:border-x-transparent before:border-t-[var(--accent)] before:content-[""]'
                    : ''
                }`}
              >
                {token.text}
              </span>
              {token.gap}
            </Fragment>
          );
        })}
      </span>{' '}
    </>
  );
});

// The Booth's teleprompter text (the Studio Next mock's Teleprompter): the sentence being read and the ones not yet read are lit, only the ones read are dimmed, the
// word being read is marked (an accent tint with a caret), and the line stays 40% down the box. The wheel and Page keys
// move the view by pixels and leave the reading position alone (DQ-17). Everything it shows arrives as props; it stores nothing.
/** About how tall a paragraph is in ems: lines of about 45 characters at a line height of 1.5, and a line at least. */
function estimatedEm(text: string): number {
  return Math.max(1, Math.ceil(text.length / 45)) * 1.5;
}

export function BoothText({
  paragraphs: given,
  position,
  browse,
  onBrowse,
  onSeek,
  onNote,
  onBackground,
  speakers,
  speakerColour,
  onSetSpeaker,
  decorations,
  notes = [],
  pickupLines = [],
  punchAt = null,
  size,
  font,
  viewRef,
  margin,
}: Props) {
  const paragraphs = useMemo(() => readingParagraphs(given), [given]);
  const units = useMemo(() => boothUnits(paragraphs), [paragraphs]);
  const words = useMemo(() => units.map((unit) => unitWords(paragraphs[unit.paragraphIndex], unit, decorations)), [units, paragraphs, decorations]);
  const at = (position && unitAtPosition(paragraphs, units, position)) ?? { cur: 0, wcur: 0 };
  // The sentences of each paragraph, grouped once: a paragraph looking for its own among all of them each render is paragraphs × sentences.
  const unitsOf = useMemo(() => {
    const byParagraph: BoothUnit[][] = paragraphs.map(() => []);
    for (const unit of units) byParagraph[unit.paragraphIndex]?.push(unit);
    return byParagraph;
  }, [paragraphs, units]);
  const readingParagraph = units[at.cur]?.paragraphIndex ?? -1;

  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const { onWheel } = useBrowseView({ box, text, cur: at.cur, wcur: at.wcur, browse, onBrowse, viewRef });

  // Every sentence is a memoised view: a step moves the reading position and must re-render the two sentences it touches, not every word of the
  // chapter. So what each sentence is given stays the same between renders: the callbacks read the latest props through a ref, and the list of
  // speakers is the same array until a name in it changes.
  const latest = useRef({ paragraphs, units, onBrowse, onSeek, onSetSpeaker });
  latest.current = { paragraphs, units, onBrowse, onSeek, onSetSpeaker };
  const seekWord = useCallback(
    (unit: BoothUnit, word: number): number =>
      positionOf(latest.current.paragraphs, latest.current.units, { cur: latest.current.units.indexOf(unit), wcur: word })?.word ?? 0,
    [],
  );
  const seek = useCallback((paragraphId: string, word: number) => {
    latest.current.onBrowse(false);
    latest.current.onSeek(paragraphId, word);
  }, []);
  const setSpeaker = useCallback((phraseKey: string, speaker: string) => latest.current.onSetSpeaker(phraseKey, speaker), []);
  const speakersKey = speakers.join('\u0000');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the names are the key: a new array with the same names is the same list
  const speakerList = useMemo(() => speakers, [speakersKey]);

  let index = -1;
  return (
    <div
      ref={box}
      onWheel={onWheel}
      onClick={(event) => {
        if (!(event.target as Element).closest('[data-unit],[data-note],button')) onBackground?.();
      }}
      data-booth-text
      className="relative h-full overflow-hidden px-7"
    >
      <div
        ref={text}
        style={{ fontSize: `${textSizePx(size)}px`, fontFamily: font, '--tsize': `${textSizePx(size)}px` } as CSSProperties}
        className="relative mx-auto max-w-[26em] py-[30vh] leading-[1.5] [overflow-wrap:anywhere] transition-transform duration-300"
      >
        {paragraphs.map((paragraph, paragraphIndex) => {
          const pickup = pickupLines.find((line) => line.paragraphId === paragraph.id);
          return (
            <p
              key={paragraph.id}
              dir="auto"
              data-paragraph={paragraph.id}
              // The browser skips painting and hit-testing a paragraph that is far from the view until it comes near (`content-visibility`), holding its place at
              // an estimated height: a 100,000-word chapter is 300,000 nodes, and a step used to repaint them all. The paragraph being read is drawn in
              // full, since its caret and glow reach past the paragraph's box, which a skipped paragraph would clip.
              style={{ '--est': `${estimatedEm(paragraph.text)}em` } as CSSProperties}
              data-pickup={pickup ? (pickup.done ? 'done' : 'open') : undefined}
              className={`mb-[0.9em] [contain-intrinsic-size:auto_var(--est)] ${paragraphIndex === readingParagraph ? '[content-visibility:visible]' : '[content-visibility:auto]'} ${pickup ? `-ml-5 border-l-4 pl-4 ${pickup.done ? 'border-[var(--ok)]' : 'border-[var(--accent)]'}` : ''}`}
            >
              {unitsOf[paragraphIndex].map((unit) => {
                index++;
                const own = index;
                return (
                  <UnitView
                    key={unit.key}
                    unit={unit}
                    index={own}
                    mode={own === at.cur ? 'cur' : own < at.cur ? 'done' : 'next'}
                    wcur={own === at.cur ? at.wcur : -1}
                    words={words[own]}
                    paragraph={paragraph}
                    from={own === punchAt}
                    speakers={speakerList}
                    colour={speakerColour?.(unit.speaker)}
                    onSeek={seek}
                    onSetSpeaker={setSpeaker}
                    seekWord={seekWord}
                  />
                );
              })}
              {notes
                .filter((note) => note.paragraphId === paragraph.id)
                .map((note) => (
                  // native-control-ok: a note set in the running text at its size, which Button's padded chrome would break
                  <button
                    type="button"
                    key={note.id}
                    data-note={note.id}
                    onClick={() => onNote?.(note.id)}
                    className="mt-2 block w-fit cursor-pointer rounded-md bg-[var(--accent-soft)] px-[0.8em] py-[0.4em] text-left text-[0.42em] font-medium text-[var(--accent-strong)]"
                  >
                    {note.name}: {note.text}
                  </button>
                ))}
            </p>
          );
        })}
        {margin}
      </div>
    </div>
  );
}
