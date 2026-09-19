import { useMemo, type ReactNode } from 'react';
import type { GuideEntity, ManuscriptNote, ManuscriptParagraph, TextSpan } from '../../types';
import { Highlight, highlightKind } from '../primitives/Highlight';

type Annotation = {
  id: string;
  start: number;
  end: number;
  length: number;
  kind: 'entity' | 'note' | 'format';
  entity?: GuideEntity;
  note?: ManuscriptNote;
  style?: TextSpan['style'];
};
type Piece = { text: string; annotations: Annotation[] };
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text formatting is always the innermost layer so interactive highlights
// (which own the click target) wrap it rather than the other way round.
const layerRank = (item: Annotation) => (item.kind === 'format' ? 1 : 0);

// One deterministic interval compositor powers every overlapping annotation:
// boundaries preserve all layers and shorter annotations become the inner,
// therefore visually and interactively topmost, layer.
export function composeAnnotationPieces(text: string, annotations: Annotation[]): Piece[] {
  const points = Array.from(new Set([0, text.length, ...annotations.flatMap((item) => [item.start, item.end])])).sort((a, b) => a - b);
  return points
    .slice(0, -1)
    .map((start, index) => {
      const end = points[index + 1];
      return {
        text: text.slice(start, end),
        annotations: annotations
          .filter((item) => item.start <= start && item.end >= end)
          .sort((a, b) => layerRank(a) - layerRank(b) || b.length - a.length || a.id.localeCompare(b.id)),
      };
    })
    .filter((piece) => piece.text);
}

// A note stores where its anchor text sat when it was created. If that range no
// longer holds the anchor text (an older, misaligned anchor, or text that
// changed) re-locate the text nearest the stored position rather than
// highlighting the wrong words. If the text cannot be found the stored range is
// kept as-is, so a note never silently disappears.
export function resolveNoteAnchor(note: ManuscriptNote, text: string): { start: number; end: number } | undefined {
  const { anchorStart: start, anchorEnd: end, anchorText } = note;
  const stored = start !== undefined && end !== undefined && start < end && start < text.length ? { start, end: Math.min(end, text.length) } : undefined;
  if (stored && (!anchorText || text.slice(stored.start, stored.end) === anchorText)) return stored;
  return (anchorText ? relocate(text, anchorText, start ?? 0) : undefined) ?? stored;
}

function relocate(text: string, anchorText: string, near: number): { start: number; end: number } | undefined {
  let best: number | undefined;
  for (let at = text.indexOf(anchorText); at !== -1; at = text.indexOf(anchorText, at + 1)) {
    if (best === undefined || Math.abs(at - near) < Math.abs(best - near)) best = at;
  }
  return best === undefined ? undefined : { start: best, end: best + anchorText.length };
}

const FORMAT_TAG = { bold: 'strong', italic: 'em', underline: 'u' } as const;
const JUMP_TARGET_CLASS = 'animate-[jump-target-pulse_1.6s_ease] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] shadow-[inset_3px_0_0_var(--accent)]';

export function ParagraphView({
  paragraphs,
  entities,
  notes,
  textClass,
  lineNumberPadding,
  jumpTarget,
  openEntity,
  openNote,
}: {
  paragraphs: ManuscriptParagraph[];
  entities: GuideEntity[];
  notes: ManuscriptNote[];
  textClass: string;
  lineNumberPadding: string;
  jumpTarget?: number;
  openEntity: (entity: GuideEntity) => void;
  openNote: (note: ManuscriptNote) => void;
}) {
  const entitiesById = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
  if (!paragraphs.length)
    return (
      <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
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
  openEntity: (entity: GuideEntity) => void;
  openNote: (note: ManuscriptNote) => void;
}) {
  const paragraphNotes = useMemo(() => notes.filter((note) => note.paragraph === paragraph.index), [notes, paragraph.index]);
  const annotations = useMemo(() => {
    const next: Annotation[] = [];
    paragraph.entityIds.forEach((id) => {
      const entity = entitiesById.get(id);
      if (!entity) return;
      [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)].filter(Boolean).forEach((term, termIndex) => {
        const re = new RegExp(escapeRegExp(term), 'gi');
        let match: RegExpExecArray | null;
        while ((match = re.exec(paragraph.text)))
          next.push({
            id: `entity-${entity.id}-${termIndex}-${match.index}`,
            start: match.index,
            end: match.index + match[0].length,
            length: match[0].length,
            kind: 'entity',
            entity,
          });
      });
    });
    paragraphNotes.forEach((note) => {
      const anchor = resolveNoteAnchor(note, paragraph.text);
      if (anchor) next.push({ id: `note-${note.id}`, ...anchor, length: anchor.end - anchor.start, kind: 'note', note });
    });
    (paragraph.spans ?? []).forEach((span, index) => {
      if (span.end > span.start && span.end <= paragraph.text.length)
        next.push({ id: `format-${span.style}-${index}`, start: span.start, end: span.end, length: span.end - span.start, kind: 'format', style: span.style });
    });
    return next;
  }, [paragraph, paragraphNotes, entitiesById]);
  const gutterClass = [
    'relative flex items-start justify-center border-r border-[var(--border)]',
    "bg-[var(--surface-2)] px-1.5 font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.625rem] leading-3",
    'text-[var(--text-faint)]',
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
  return (
    <div
      className={`grid min-h-8 grid-cols-[3.5rem_minmax(0,1fr)] border-b border-[var(--border)] last:border-b-0 ${isJumpTarget ? JUMP_TARGET_CLASS : 'even:bg-[var(--row-alt)]'}`}
      data-paragraph={paragraph.index}
      data-source-line={paragraph.sourceLine}
      data-jump-target={isJumpTarget || undefined}
    >
      <div className={gutterClass}>
        <span
          className="source-line-number relative z-[3] pt-[0.1rem]"
          style={{ pointerEvents: 'none', textShadow: '0 0 3px var(--surface-2), 0 0 3px var(--surface-2)' }}
        >
          {chapterParagraphIndex + 1}
        </span>
      </div>
      <div className="min-w-0 px-4 py-1">
        <p data-paragraph-text className={`${textClass} whitespace-pre-line`}>
          {composeAnnotationPieces(paragraph.text, annotations).map(renderPiece)}
        </p>
      </div>
    </div>
  );
}
