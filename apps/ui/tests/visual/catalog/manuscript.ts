// The `manuscript` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL, POPUP_ANCHORED_AT_FIRST_WIDTH } from './shared';

export const manuscriptStates: StateEntry[] = [
  // Manuscript
  { page: 'manuscript', state: 'reader-text-small', description: 'Manuscript, small text size' },
  { page: 'manuscript', state: 'reader-text-medium', description: 'Manuscript, medium text size' },
  { page: 'manuscript', state: 'reader-text-large', description: 'Manuscript, large text size' },
  { page: 'manuscript', state: 'chapters-overlay-open', description: 'Manuscript, chapters & search overlay open' },
  {
    page: 'manuscript',
    state: 'chapters-overlay-searching',
    description:
      'Manuscript, a query typed into Chapters & Search before the debounce settles - matching chapter titles show at once and a "Searching…" hint replaces "No matches" (R1, R2)',
  },
  {
    page: 'manuscript',
    state: 'chapters-overlay-search',
    description:
      'Manuscript, settled search results in Chapters & Search - a line hit reads "[icon] Line n: ...windowed text..." with the matched term highlighted (R3, R4)',
  },
  { page: 'manuscript', state: 'detail-sidebar-note', description: 'Manuscript, detail sidebar open on a note' },
  { page: 'manuscript', state: 'detail-sidebar-entity', description: 'Manuscript, detail sidebar open on an entity' },
  {
    page: 'manuscript',
    state: 'selection-popup',
    description: 'Manuscript, text-selection action popup open on one word: + Note, + Story Bible and Look up (Look up is offered for one word only)',
    ...POPUP_ANCHORED_AT_FIRST_WIDTH,
  },
  {
    page: 'manuscript',
    state: 'word-lookup-definition',
    description:
      'Manuscript, the Look up panel for "bank" - each part of speech with numbered definitions, examples and synonyms, and the CC BY 4.0 credit of the dictionary (ADR 0097)',
  },
  {
    page: 'manuscript',
    state: 'word-lookup-not-found',
    description: 'Manuscript, the Look up panel for a word the dictionary does not have ("Alice"), said plainly, with the credit',
  },
  {
    page: 'manuscript',
    state: 'word-lookup-not-installed',
    description:
      'Manuscript, Look up with the dictionary not installed - the first-use question with its size, where it is kept and its licence; nothing downloads until Download dictionary',
  },
  {
    page: 'manuscript',
    state: 'word-lookup-damaged',
    description: 'Manuscript, Look up with a dictionary whose index fails its check - asked as a repair (Download again), in plain language',
  },
  {
    page: 'manuscript',
    state: 'overlapping-highlights',
    description: 'Manuscript, entity highlight overlapping a note',
    sameAs: { of: 'manuscript/reader-text-medium', reason: 'Medium is the default reader size and the overlap is visible in the default view.' },
  },
  { page: 'manuscript', state: 'sticky-header-scrolled', description: 'Manuscript, scrolled with sticky chapter header', ...KEEPS_DESKTOP_SCROLL },
  { page: 'manuscript', state: 'chapter-collapsed', description: 'Manuscript, a chapter card collapsed' },
  {
    page: 'manuscript',
    state: 'chapter-header-columns',
    description:
      'Manuscript, mixed chapter rows (?mockManuscript=mixed): a Front Matter row with no Record in Booth and 3-, 4- and 5-digit word counts - the stats and the buttons in two aligned columns, a chevron last (manuscript-chapter-header-alignment.prd.md, manuscript-credits-card-parity.prd.md)',
  },
  { page: 'manuscript', state: 'add-note-dialog', description: 'Manuscript, Add Note dialog open after selecting text' },
  {
    page: 'manuscript',
    state: 'script-markup',
    description:
      'Manuscript, script markup on Chapter 3 (prep-depth PRD Phase 5): stress underlines, a breath and a pause after words, Mouse and Lory speaker chips, a "Text changed here" notice beside a line whose marked words changed, and a mark whose line is gone listed above the chapter',
  },
  {
    page: 'manuscript',
    state: 'markup-dialog',
    description:
      'Manuscript, the Mark up dialog for a selection that already carries a stress mark: Speaker chosen, the Story Bible characters one press away, and the mark already there with its Remove',
  },
  { page: 'manuscript', state: 'formatted-text-and-line-breaks', description: 'Manuscript, paragraphs with preserved bold/italic/underline and a line break' },
  { page: 'manuscript', state: 'chapter-bookmarked', description: 'Manuscript, a chapter bookmarked (blue bookmark icon)' },
  { page: 'manuscript', state: 'go-to-line-highlight', description: 'Manuscript, arrived via Story Bible "Go to line" with the target line highlighted' },
  { page: 'manuscript', state: 'reader-dark', description: 'Manuscript, reader in the Dark theme (readable active controls, opaque sticky header)' },
  {
    page: 'manuscript',
    state: 'credits-entries',
    description:
      'Manuscript, the Opening credits pseudo-entry expanded before Chapter 1 with an unresolved-token chip (audiobook-credits-templates.prd.md Phase 3)',
  },
  {
    page: 'manuscript',
    state: 'credits-entries-fill-in',
    description:
      'Manuscript, the credits-setup banner above the Opening credits card and its own "Fill in" button beside the unresolved-token line (credits-token-setup-and-front-matter-detection.prd.md Phase 3, ?mockCredits=setup, mockups/credits-token-setup-and-front-matter-detection/03-manuscript-banner-and-fill-in.webp)',
  },
  {
    page: 'manuscript',
    state: 'retail-sample',
    description:
      'Manuscript, the retail sample picked on lines 1-3 of Chapter 3 (?mockCredits=extras, audiobook-credits-templates.prd.md Phase 5): a "Retail sample" tag on the chapter header, the sampled lines marked with a left rule, "Retail sample starts · about ..." above the first and "Retail sample ends" above the last',
  },

  {
    page: 'manuscript',
    state: 'invalid-payload',
    description:
      'Manuscript, the inline error with Retry when the data it loads could not be read, beside the notice Home raised for the same data; navigation still works (ADR 0069, 0075)',
  },
];
