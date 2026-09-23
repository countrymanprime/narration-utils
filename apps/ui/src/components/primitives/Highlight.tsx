import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';

// `Cursor` is the Teleprompter's current word - a solid accent fill rather than a
// tint, so it reads as a position marker and never as an entity or note.
// `Misread`, `Extra`, `Skipped` and `Restart` are the read-aloud dialog's suspected flags (teleprompter-manuscript-integration.prd.md
// Phase 7): a decoration in the Transcript Compare colour of the same kind, never a tint, so they layer over an entity or note mark.
// `Search` is a manuscript search hit's matched term (reader search and controls PRD, R4) - never
// reached through highlightKind below (nothing maps a Story Bible category to it); callers pass it
// directly.
export type HighlightKind =
  'Character' | 'Place' | 'Organization' | 'Lore' | 'Item' | 'Event' | 'Review' | 'Note' | 'Search' | 'Cursor' | 'Misread' | 'Extra' | 'Skipped' | 'Restart';

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
  Search: '--search',
  Cursor: '--accent',
  Misread: '--danger',
  Extra: '--info',
  Skipped: '--warn',
  Restart: '--accent',
};

// The flag decorations. Misread and Skipped reuse Transcript Compare's colours for the same kinds (`KIND_STYLES`, the pure
// status colour as the 3:1 non-text mark), and skipped is the dotted underline the reader already draws under a skip-ahead,
// so the two coincide. An extra is zero-width in the text, so it is an insertion bar before the word it was heard before. A
// restart has no Transcript Compare kind; it takes the accent (the colour of the reading position it sends back).
const FLAG_DECORATION: Partial<Record<HighlightKind, string>> = {
  Misread: 'wavy',
  Skipped: 'dotted',
  Restart: 'dashed',
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
  Search: '--search-text',
};

// Tints mix with `transparent`, not a surface color, so the same highlight
// reads correctly on the reader's alternating row backgrounds. Vertical padding
// on an inline box paints without changing line layout, which is how the
// background fills the whole line height rather than just the glyph box.
function highlightStyle(kind: HighlightKind): CSSProperties {
  const token = `var(${TOKEN[kind]})`;
  // The negative margin cancels the mark's horizontal padding, so moving the cursor never changes where a line wraps.
  if (kind === 'Cursor') return { background: token, color: 'var(--accent-contrast)', margin: '0 -0.05em' };
  if (kind === 'Extra') return { background: 'transparent', boxShadow: `inset 0.14em 0 0 ${token}`, paddingLeft: '0.2em' };
  const decoration = FLAG_DECORATION[kind];
  if (decoration)
    return { background: 'transparent', textDecoration: `underline ${decoration} ${token}`, textDecorationThickness: '1.5px', textUnderlineOffset: '0.25em' };
  return {
    background: `color-mix(in srgb, ${token} 20%, transparent)`,
    color: TEXT_TOKEN[kind] ? `var(${TEXT_TOKEN[kind]})` : undefined,
    boxShadow: `inset 0 -1.5px 0 ${token}`,
  };
}

const BASE = 'ms-highlight rounded-[0.15rem] px-[0.05em] py-[var(--hl-pad-y,0.08em)] text-inherit [box-decoration-break:clone]';

type Props = {
  kind: HighlightKind;
  children: ReactNode;
  onActivate?: () => void;
  /** The control's accessible name, when its words alone would not say what it is (an extra-words flag is named by what it marks). */
  label?: string;
  /** More about the mark for a screen reader (what a flag heard), which the sighted reader gets from its hint. */
  description?: string;
};

export function Highlight({ kind, children, onActivate, label, description }: Props) {
  if (!onActivate)
    return (
      <mark className={BASE} style={highlightStyle(kind)} data-highlight={kind} aria-description={description}>
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
      aria-label={label}
      aria-description={description}
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
