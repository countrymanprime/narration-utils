import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBookmark as faBookmarkSolid } from '@fortawesome/free-solid-svg-icons';
import { faBookmark as faBookmarkRegular } from '@fortawesome/free-regular-svg-icons';
import type { ReactNode } from 'react';
import type { GuideEntity, ManuscriptNote, ManuscriptParagraph, ReaderBookmark } from '../../types';
import { categoryCssName } from '../../state';
import { TooltipTarget } from '../primitives/Tooltip';

type Annotation = { id: string; start: number; end: number; length: number; kind: 'entity' | 'note'; entity?: GuideEntity; note?: ManuscriptNote };
type Piece = { text: string; annotations: Annotation[] };
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
        annotations: annotations.filter((item) => item.start <= start && item.end >= end).sort((a, b) => b.length - a.length || a.id.localeCompare(b.id)),
      };
    })
    .filter((piece) => piece.text);
}

export function ParagraphView({
  paragraphs,
  entities,
  notes,
  bookmarks,
  textClass,
  lineNumberPadding,
  openEntity,
  openNote,
  toggleBookmark,
}: {
  paragraphs: ManuscriptParagraph[];
  entities: GuideEntity[];
  notes: ManuscriptNote[];
  bookmarks: ReaderBookmark[];
  textClass: string;
  lineNumberPadding: string;
  openEntity: (entity: GuideEntity) => void;
  openNote: (note: ManuscriptNote) => void;
  toggleBookmark: (paragraph: ManuscriptParagraph) => void;
}) {
  if (!paragraphs.length)
    return (
      <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
        No highlighted entities parsed in this chapter yet.
      </p>
    );
  return (
    <div className="chapter-card-body">
      {paragraphs.map((paragraph, chapterParagraphIndex) => {
        const paragraphNotes = notes.filter((note) => note.paragraph === paragraph.index);
        const bookmark = bookmarks.find((item) => item.kind === 'line' && item.paragraph === paragraph.index);
        const gutterClass = [
          'ms-gutter !flex !items-start !justify-center border-r border-[var(--border)]',
          'bg-[var(--surface-2)] !px-1.5 font-mono text-[0.625rem] leading-3',
          'text-[var(--text-faint)]',
          lineNumberPadding,
        ].join(' ');
        const annotations: Annotation[] = [];
        paragraph.entityIds.forEach((id) => {
          const entity = entities.find((item) => item.id === id);
          if (!entity) return;
          [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)].filter(Boolean).forEach((term, termIndex) => {
            const re = new RegExp(escapeRegExp(term), 'gi');
            let match: RegExpExecArray | null;
            while ((match = re.exec(paragraph.text)))
              annotations.push({
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
          if (note.anchorStart !== undefined && note.anchorEnd !== undefined)
            annotations.push({
              id: `note-${note.id}`,
              start: note.anchorStart,
              end: note.anchorEnd,
              length: note.anchorEnd - note.anchorStart,
              kind: 'note',
              note,
            });
        });
        const renderPiece = (piece: Piece, pieceIndex: number) =>
          piece.annotations
            .slice()
            .reverse()
            .reduce<ReactNode>(
              (child, item) =>
                item.kind === 'note' ? (
                  <span
                    key={`${item.id}-${pieceIndex}`}
                    role="button"
                    tabIndex={0}
                    className="note-overlay"
                    onClick={(event) => {
                      event.stopPropagation();
                      openNote(item.note!);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        openNote(item.note!);
                      }
                    }}
                  >
                    {child}
                  </span>
                ) : (
                  <mark
                    key={`${item.id}-${pieceIndex}`}
                    role="button"
                    tabIndex={0}
                    className={`ms-highlight hl-${categoryCssName(item.entity!.category)}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openEntity(item.entity!);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        openEntity(item.entity!);
                      }
                    }}
                  >
                    {child}
                  </mark>
                ),
              piece.text,
            );
        return (
          <div
            key={paragraph.index}
            className="ms-line !grid min-h-8 !grid-cols-[3.5rem_minmax(0,1fr)_2.35rem]"
            data-paragraph={paragraph.index}
            data-source-line={paragraph.sourceLine}
          >
            <div className={gutterClass}>
              <span className="source-line-number">{chapterParagraphIndex + 1}</span>
            </div>
            <div className="ms-content min-w-0 !px-4 !py-1">
              <p className={textClass}>{composeAnnotationPieces(paragraph.text, annotations).map(renderPiece)}</p>
            </div>
            <div className="ms-marker-gutter !flex !items-start !justify-center border-l border-[var(--border)] bg-[var(--surface-2)] !px-1.5 !pt-1 text-[var(--text-faint)]">
              <TooltipTarget text={bookmark ? 'Remove line bookmark' : 'Bookmark this line'}>
                <button
                  aria-label={bookmark ? 'Remove line bookmark' : 'Bookmark this line'}
                  className={`paragraph-bookmark ${bookmark ? 'active' : ''}`}
                  onClick={() => toggleBookmark(paragraph)}
                >
                  <FontAwesomeIcon className="bookmark-outline" icon={faBookmarkRegular} />
                  <FontAwesomeIcon className="bookmark-fill" icon={faBookmarkSolid} />
                </button>
              </TooltipTarget>
            </div>
          </div>
        );
      })}
    </div>
  );
}
