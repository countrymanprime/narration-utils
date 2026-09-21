import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';

// `Cursor` is the Teleprompter's current word - a solid accent fill rather than a
// tint, so it reads as a position marker and never as an entity or note.
export type HighlightKind = 'Character' | 'Place' | 'Organization' | 'Lore' | 'Item' | 'Event' | 'Review' | 'Note' | 'Cursor';

// Story Bible categories arrive under several spellings ("Needs Review",
// "Location", the transient "Draft"). Every highlight funnels through this one
// mapping so an unfamiliar category degrades to the review color instead of the
// browser's default yellow <mark> (ADR-0016).
export function highlightKind(category: string): HighlightKind {
  switch (category) {
    case 'Character':
    case 'Place':
    case 'Organization':
    case 'Lore':
    case 'Item':
    case 'Event':
    case 'Note':
      return category;
    case 'Location':
      return 'Place';
    default:
      return 'Review';
  }
}

const TOKEN: Record<HighlightKind, string> = {
  Character: '--character',
  Place: '--place',
  Organization: '--org',
  Lore: '--lore',
  Item: '--item',
  Event: '--event',
  Review: '--review',
  Note: '--note',
  Cursor: '--accent',
};

// The text of an entity is the kind colour mixed toward --text (ADR 0059), which reaches 4.5:1 on the tint where the pure
// colour did not; the tint and the underline stay the pure colour. A note keeps the text colour (ADR 0016).
const TEXT_TOKEN: Partial<Record<HighlightKind, string>> = {
  Character: '--character-text',
  Place: '--place-text',
  Organization: '--org-text',
  Lore: '--lore-text',
  Item: '--item-text',
  Event: '--event-text',
  Review: '--review-text',
};

// Tints mix with `transparent`, not a surface color, so the same highlight
// reads correctly on the reader's alternating row backgrounds. Vertical padding
// on an inline box paints without changing line layout, which is how the
// background fills the whole line height rather than just the glyph box.
function highlightStyle(kind: HighlightKind): CSSProperties {
  const token = `var(${TOKEN[kind]})`;
  // The negative margin cancels the mark's horizontal padding, so moving the cursor never changes where a line wraps.
  if (kind === 'Cursor') return { background: token, color: 'var(--accent-contrast)', margin: '0 -0.05em' };
  return {
    background: `color-mix(in srgb, ${token} 20%, transparent)`,
    color: TEXT_TOKEN[kind] ? `var(${TEXT_TOKEN[kind]})` : undefined,
    boxShadow: `inset 0 -1.5px 0 ${token}`,
  };
}

const BASE = 'ms-highlight rounded-[0.15rem] px-[0.05em] py-[var(--hl-pad-y,0.08em)] text-inherit [box-decoration-break:clone]';

export function Highlight({ kind, children, onActivate }: { kind: HighlightKind; children: ReactNode; onActivate?: () => void }) {
  if (!onActivate)
    return (
      <mark className={BASE} style={highlightStyle(kind)} data-highlight={kind}>
        {children}
      </mark>
    );
  const activate = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    onActivate();
  };
  return (
    <mark
      role="button"
      tabIndex={0}
      data-highlight={kind}
      className={`${BASE} cursor-pointer`}
      style={highlightStyle(kind)}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        activate(event);
      }}
    >
      {children}
    </mark>
  );
}
