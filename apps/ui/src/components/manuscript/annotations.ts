import type { GuideEntity, ManuscriptNote, ManuscriptParagraph, TextSpan } from '../../types';

// The character-offset annotations a paragraph carries: Story Bible entity mentions, note anchors and text formatting.
// The Manuscript reader (`ParagraphView`) composes all three; the read-aloud reader
// (teleprompter-manuscript-integration.prd.md Phase 5) maps the entity and note ones onto its words
// (`readerModel.marksOnWords`), so both readers find the same mentions and anchor a note the same way.
export type Annotation = {
  id: string;
  start: number;
  end: number;
  length: number;
  kind: 'entity' | 'note' | 'format';
  entity?: GuideEntity;
  note?: ManuscriptNote;
  style?: TextSpan['style'];
};
export type Piece = { text: string; annotations: Annotation[] };
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text formatting is always the innermost layer so interactive highlights
// (which own the click target) wrap it rather than the other way round.
const layerRank = (item: Annotation) => (item.kind === 'format' ? 1 : 0);

// One deterministic interval compositor powers every overlapping annotation:
// boundaries preserve all layers and shorter annotations become the inner,
// therefore visually and interactively topmost, layer.
// Offsets outside the text are clamped to it and an annotation that is then empty
// (or has a non-numeric offset) is dropped, so the pieces always rebuild the text:
// `String.slice` counts a negative index from the end, which would repeat characters.
export function composeAnnotationPieces(text: string, annotations: Annotation[]): Piece[] {
  const clamp = (offset: number) => Math.min(Math.max(offset, 0), text.length);
  const inside = annotations.map((item) => ({ item, start: clamp(item.start), end: clamp(item.end) })).filter(({ start, end }) => start < end);
  const points = Array.from(new Set([0, text.length, ...inside.flatMap(({ start, end }) => [start, end])])).sort((a, b) => a - b);
  return points
    .slice(0, -1)
    .map((start, index) => {
      const end = points[index + 1];
      return {
        text: text.slice(start, end),
        annotations: inside
          .filter((bounds) => bounds.start <= start && bounds.end >= end)
          .map((bounds) => bounds.item)
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
  // A negative stored start is clamped to the top of the text (String.slice would count it from the end).
  const from = start === undefined ? undefined : Math.max(start, 0);
  const stored = from !== undefined && end !== undefined && from < end && from < text.length ? { start: from, end: Math.min(end, text.length) } : undefined;
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

/** Every case-insensitive mention of each of the paragraph's entities, by its canonical name and each alias. */
export function entityAnnotations(paragraph: Pick<ManuscriptParagraph, 'text' | 'entityIds'>, entitiesById: Map<string, GuideEntity>): Annotation[] {
  const found: Annotation[] = [];
  paragraph.entityIds.forEach((id) => {
    const entity = entitiesById.get(id);
    if (!entity) return;
    [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)].filter(Boolean).forEach((term, termIndex) => {
      const re = new RegExp(escapeRegExp(term), 'gi');
      let match: RegExpExecArray | null;
      while ((match = re.exec(paragraph.text)))
        found.push({
          id: `entity-${entity.id}-${termIndex}-${match.index}`,
          start: match.index,
          end: match.index + match[0].length,
          length: match[0].length,
          kind: 'entity',
          entity,
        });
    });
  });
  return found;
}

/** The anchors of the notes on this paragraph (matched by `note.paragraph`), re-located when the stored range drifted. */
export function noteAnnotations(paragraph: Pick<ManuscriptParagraph, 'text' | 'index'>, notes: ManuscriptNote[]): Annotation[] {
  return notes.flatMap((note) => {
    if (note.paragraph !== paragraph.index) return [];
    const anchor = resolveNoteAnchor(note, paragraph.text);
    return anchor ? [{ id: `note-${note.id}`, ...anchor, length: anchor.end - anchor.start, kind: 'note' as const, note }] : [];
  });
}
