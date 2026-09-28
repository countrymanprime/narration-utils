import { useMemo, type ReactNode } from 'react';
import type { GuideEntity, ManuscriptNote, ManuscriptParagraph, PrepMarkupSpan } from '../../types';
import { Highlight, highlightKind } from '../primitives/Highlight';
import { SpeakerTag } from '../primitives/SpeakerTag';
import { composeAnnotationPieces, entityAnnotations, markupAnnotations, noteAnnotations, type Annotation, type Piece } from './annotations';
import type { DialogueCue } from './dialogueCues';
import { speakerLabelForParagraph } from './dialogueCues';
import { MarkupMark, StaleMarkupNotice } from './MarkupMark';
import type { RetailSampleRange } from './retailSampleRange';

const FORMAT_TAG = { bold: 'strong', italic: 'em', underline: 'u' } as const;
const NO_MARKUP: PrepMarkupSpan[] = [];
const JUMP_TARGET_CLASS = 'animate-[jump-target-pulse_1.6s_ease] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] shadow-[inset_3px_0_0_var(--accent)]';

export function ParagraphView({
  paragraphs,
  entities,
  notes,
  markup = NO_MARKUP,
  removeMarkup,
  textClass,
  lineNumberPadding,
  jumpTarget,
  retailSample,
  dialogueCues,
  openEntity,
  openNote,
}: {
  paragraphs: ManuscriptParagraph[];
  entities: GuideEntity[];
  notes: ManuscriptNote[];
  /** The chapter's script markup (prep-depth.prd.md Phase 5): fresh spans are drawn on their line, stale ones listed beside it. */
  markup?: PrepMarkupSpan[];
  /** Removes one mark; left out, a stale mark is still said but offers no Remove. */
  removeMarkup?: (span: PrepMarkupSpan) => void;
  textClass: string;
  lineNumberPadding: string;
  jumpTarget?: number;
  /** The retail sample's paragraphs (Phase 5, C10): their rows are marked, with a label where it starts and ends. */
  retailSample?: RetailSampleRange;
  /** Speaker attribution (prep-depth.prd.md Phase 4): a dialogue line whose cue resolves to a known entity gets a
   * speaker chip; `unknown` and no-cue paragraphs render exactly as before. */
  dialogueCues?: DialogueCue[];
  openEntity: (entity: GuideEntity) => void;
  openNote: (note: ManuscriptNote) => void;
}) {
  const entitiesById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
  // A mark whose line is gone has no row to sit beside: it is listed above the chapter instead.
  const gone = useMemo(() => markup.filter((span) => span.paragraph === null), [markup]);
  if (!paragraphs.length)
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No highlighted entities parsed in this chapter yet.
      </p>
    );
  return (
    <div className="relative bg-[var(--surface)]">
      {gone.length > 0 && (
        <div className="border-b border-[var(--border)] px-4 py-2">
          <StaleMarkupNotice spans={gone} gone remove={removeMarkup} />
        </div>
      )}
      {paragraphs.map((paragraph, chapterParagraphIndex) => (
        <ParagraphRow
          key={paragraph.index}
          paragraph={paragraph}
          chapterParagraphIndex={chapterParagraphIndex}
          entitiesById={entitiesById}
          notes={notes}
          markup={markup}
          removeMarkup={removeMarkup}
          textClass={textClass}
          lineNumberPadding={lineNumberPadding}
          isJumpTarget={jumpTarget === paragraph.index}
          retailSample={retailSample}
          dialogueCues={dialogueCues}
          openEntity={openEntity}
          openNote={openNote}
        />
      ))}
    </div>
  );
}

function ParagraphRow({
  paragraph,
  chapterParagraphIndex,
  entitiesById,
  notes,
  markup,
  removeMarkup,
  textClass,
  lineNumberPadding,
  isJumpTarget,
  retailSample,
  dialogueCues,
  openEntity,
  openNote,
}: {
  paragraph: ManuscriptParagraph;
  chapterParagraphIndex: number;
  entitiesById: Map<string, GuideEntity>;
  notes: ManuscriptNote[];
  markup: PrepMarkupSpan[];
  removeMarkup?: (span: PrepMarkupSpan) => void;
  textClass: string;
  lineNumberPadding: string;
  isJumpTarget: boolean;
  retailSample?: RetailSampleRange;
  dialogueCues?: DialogueCue[];
  openEntity: (entity: GuideEntity) => void;
  openNote: (note: ManuscriptNote) => void;
}) {
  const paragraphNotes = useMemo(() => notes.filter((note) => note.paragraph === paragraph.index), [notes, paragraph.index]);
  const speakerLabel = useMemo(
    () => (dialogueCues?.length ? speakerLabelForParagraph(paragraph, dialogueCues, entitiesById) : undefined),
    [paragraph, dialogueCues, entitiesById],
  );
  const lineMarkup = useMemo(() => markup.filter((span) => span.paragraphId === paragraph.id), [markup, paragraph.id]);
  const staleMarkup = useMemo(() => lineMarkup.filter((span) => span.stale), [lineMarkup]);
  const annotations = useMemo(() => {
    const next: Annotation[] = [
      ...entityAnnotations(paragraph, entitiesById),
      ...noteAnnotations(paragraph, paragraphNotes),
      ...markupAnnotations(paragraph, lineMarkup),
    ];
    (paragraph.spans ?? []).forEach((span, index) => {
      if (span.end > span.start && span.end <= paragraph.text.length)
        next.push({ id: `format-${span.style}-${index}`, start: span.start, end: span.end, length: span.end - span.start, kind: 'format', style: span.style });
    });
    return next;
  }, [paragraph, paragraphNotes, entitiesById, lineMarkup]);
  const gutterClass = [
    'relative flex items-start justify-center border-r border-[var(--border)]',
    "bg-[var(--surface-2)] px-1.5 font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.625rem] leading-3",
    'text-[var(--text-muted)]',
    lineNumberPadding,
  ].join(' ');
  // The pieces rebuild the text exactly (composeAnnotationPieces), so each one's offsets are the running sum of the lengths
  // before it: how a mark split into several pieces knows which piece starts it and which ends it.
  const renderPiece = (piece: Piece, pieceIndex: number, start: number) => {
    // An entity mention inside a note's anchor (or two overlapping entities) share a piece and would otherwise nest
    // one interactive mark inside another (axe nested-interactive), which is invalid for a screen reader regardless
    // of which one visually wins. Only the innermost - the one composeAnnotationPieces already made interactively
    // topmost - keeps the click/keyboard activation here; the outer one is still a real tab stop on its other,
    // non-overlapping pieces of the same line, so nothing loses reachability.
    let interactiveClaimed = false;
    return piece.annotations
      .slice()
      .reverse()
      .reduce<ReactNode>((child, item) => {
        const key = `${item.id}-${pieceIndex}`;
        if (item.kind === 'markup')
          return (
            <MarkupMark key={key} span={item.markup!} first={start === item.start} last={start + piece.text.length === item.end}>
              {child}
            </MarkupMark>
          );
        if (item.kind === 'format') {
          const Tag = FORMAT_TAG[item.style!];
          return <Tag key={key}>{child}</Tag>;
        }
        const claimsActivation = !interactiveClaimed;
        interactiveClaimed = true;
        if (item.kind === 'note')
          return (
            <Highlight key={key} kind="Note" onActivate={claimsActivation ? () => openNote(item.note!) : undefined}>
              {child}
            </Highlight>
          );
        return (
          <Highlight key={key} kind={highlightKind(item.entity!.category)} onActivate={claimsActivation ? () => openEntity(item.entity!) : undefined}>
            {child}
          </Highlight>
        );
      }, piece.text);
  };
  const inSample = retailSample !== undefined && paragraph.index >= retailSample.start && paragraph.index <= retailSample.end;
  const sampleLabel =
    inSample && paragraph.index === retailSample.start
      ? `Retail sample starts · about ${retailSample.length}`
      : inSample && paragraph.index === retailSample.end
        ? 'Last line of the retail sample'
        : undefined;
  return (
    <div
      className={`grid min-h-8 grid-cols-[3.5rem_minmax(0,1fr)] border-b border-[var(--border)] last:border-b-0 ${isJumpTarget ? JUMP_TARGET_CLASS : 'even:bg-[var(--row-alt)]'}`}
      data-paragraph={paragraph.index}
      data-source-line={paragraph.sourceLine}
      data-jump-target={isJumpTarget || undefined}
      data-retail-sample={inSample || undefined}
    >
      <div className={gutterClass}>
        <span
          className="source-line-number relative z-[3] pt-[0.1rem]"
          style={{ pointerEvents: 'none', textShadow: '0 0 3px var(--surface-2), 0 0 3px var(--surface-2)' }}
        >
          {chapterParagraphIndex + 1}
        </span>
      </div>
      <div className={`min-w-0 px-4 py-1 ${inSample ? 'shadow-[inset_3px_0_0_var(--info)]' : ''}`}>
        {sampleLabel && (
          <div className="text-xs font-medium" style={{ color: 'var(--info-text)' }}>
            {sampleLabel}
          </div>
        )}
        {speakerLabel && (
          <div className="mb-0.5">
            {/* speakerId is the resolved canonical name, not the entity id speakerLabelForParagraph already
                discarded (dialogueCues.ts): the Booth's "Voices in scene" tags key off the same canonical name
                (BoothView.tsx), so a speaker's colour still matches across both places. */}
            <SpeakerTag label={speakerLabel} speakerId={speakerLabel} />
          </div>
        )}
        <p data-paragraph-text className={`${textClass} whitespace-pre-line`}>
          {
            composeAnnotationPieces(paragraph.text, annotations).reduce<{ nodes: ReactNode[]; at: number }>(
              ({ nodes, at }, piece, index) => ({ nodes: [...nodes, renderPiece(piece, index, at)], at: at + piece.text.length }),
              { nodes: [], at: 0 },
            ).nodes
          }
        </p>
        <StaleMarkupNotice spans={staleMarkup} remove={removeMarkup} />
      </div>
    </div>
  );
}
