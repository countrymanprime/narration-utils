import { useMemo, type ReactNode } from 'react';
import type { GuideEntity, ManuscriptNote, ManuscriptParagraph } from '../../types';
import { Highlight, highlightKind } from '../primitives/Highlight';
import { composeAnnotationPieces, entityAnnotations, noteAnnotations, type Annotation, type Piece } from './annotations';
import type { RetailSampleRange } from './retailSampleRange';

const FORMAT_TAG = { bold: 'strong', italic: 'em', underline: 'u' } as const;
const JUMP_TARGET_CLASS = 'animate-[jump-target-pulse_1.6s_ease] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] shadow-[inset_3px_0_0_var(--accent)]';

export function ParagraphView({
  paragraphs,
  entities,
  notes,
  textClass,
  lineNumberPadding,
  jumpTarget,
  retailSample,
  openEntity,
  openNote,
}: {
  paragraphs: ManuscriptParagraph[];
  entities: GuideEntity[];
  notes: ManuscriptNote[];
  textClass: string;
  lineNumberPadding: string;
  jumpTarget?: number;
  /** The retail sample's paragraphs (Phase 5, C10): their rows are marked, with a label where it starts and ends. */
  retailSample?: RetailSampleRange;
  openEntity: (entity: GuideEntity) => void;
  openNote: (note: ManuscriptNote) => void;
}) {
  const entitiesById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
  if (!paragraphs.length)
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        No highlighted entities parsed in this chapter yet.
      </p>
    );
  return (
    <div className="relative bg-[var(--surface)]">
      {paragraphs.map((paragraph, chapterParagraphIndex) => (
        <ParagraphRow
          key={paragraph.index}
          paragraph={paragraph}
          chapterParagraphIndex={chapterParagraphIndex}
          entitiesById={entitiesById}
          notes={notes}
          textClass={textClass}
          lineNumberPadding={lineNumberPadding}
          isJumpTarget={jumpTarget === paragraph.index}
          retailSample={retailSample}
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
  textClass,
  lineNumberPadding,
  isJumpTarget,
  retailSample,
  openEntity,
  openNote,
}: {
  paragraph: ManuscriptParagraph;
  chapterParagraphIndex: number;
  entitiesById: Map<string, GuideEntity>;
  notes: ManuscriptNote[];
  textClass: string;
  lineNumberPadding: string;
  isJumpTarget: boolean;
  retailSample?: RetailSampleRange;
  openEntity: (entity: GuideEntity) => void;
  openNote: (note: ManuscriptNote) => void;
}) {
  const paragraphNotes = useMemo(() => notes.filter((note) => note.paragraph === paragraph.index), [notes, paragraph.index]);
  const annotations = useMemo(() => {
    const next: Annotation[] = [...entityAnnotations(paragraph, entitiesById), ...noteAnnotations(paragraph, paragraphNotes)];
    (paragraph.spans ?? []).forEach((span, index) => {
      if (span.end > span.start && span.end <= paragraph.text.length)
        next.push({ id: `format-${span.style}-${index}`, start: span.start, end: span.end, length: span.end - span.start, kind: 'format', style: span.style });
    });
    return next;
  }, [paragraph, paragraphNotes, entitiesById]);
  const gutterClass = [
    'relative flex items-start justify-center border-r border-[var(--border)]',
    "bg-[var(--surface-2)] px-1.5 font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.625rem] leading-3",
    'text-[var(--text-muted)]',
    lineNumberPadding,
  ].join(' ');
  const renderPiece = (piece: Piece, pieceIndex: number) =>
    piece.annotations
      .slice()
      .reverse()
      .reduce<ReactNode>((child, item) => {
        const key = `${item.id}-${pieceIndex}`;
        if (item.kind === 'format') {
          const Tag = FORMAT_TAG[item.style!];
          return <Tag key={key}>{child}</Tag>;
        }
        if (item.kind === 'note')
          return (
            <Highlight key={key} kind="Note" onActivate={() => openNote(item.note!)}>
              {child}
            </Highlight>
          );
        return (
          <Highlight key={key} kind={highlightKind(item.entity!.category)} onActivate={() => openEntity(item.entity!)}>
            {child}
          </Highlight>
        );
      }, piece.text);
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
        <p data-paragraph-text className={`${textClass} whitespace-pre-line`}>
          {composeAnnotationPieces(paragraph.text, annotations).map(renderPiece)}
        </p>
      </div>
    </div>
  );
}
