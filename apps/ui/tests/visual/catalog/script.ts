// The `script` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL, POPUP_ANCHORED_AT_FIRST_WIDTH, RAIL_DEPENDS_ON_WIDTH } from './shared';

export const scriptStates: StateEntry[] = [
  // Script (stage-navigation-and-page-replacement.prd.md Phase 3, which replaced the Manuscript page)
  { page: 'script', state: 'reader-text-small', description: 'Script, small text size' },
  { page: 'script', state: 'reader-text-medium', description: 'Script, medium text size' },
  { page: 'script', state: 'reader-text-large', description: 'Script, large text size' },
  { page: 'script', state: 'chapters-overlay-open', description: 'Script, chapters & search overlay open' },
  {
    page: 'script',
    state: 'chapters-overlay-searching',
    description:
      'Script, a query typed into Chapters & Search before the debounce settles - matching chapter titles show at once and a "Searching…" hint replaces "No matches" (R1, R2)',
  },
  {
    page: 'script',
    state: 'chapters-overlay-search',
    description:
      'Script, settled search results in Chapters & Search - a line hit reads "[icon] Line n: ...windowed text..." with the matched term highlighted (R3, R4)',
  },
  { page: 'script', state: 'detail-sidebar-note', description: 'Script, detail sidebar open on a note' },
  { page: 'script', state: 'detail-sidebar-entity', description: 'Script, detail sidebar open on an entity' },
  {
    page: 'script',
    state: 'selection-popup',
    description: 'Script, text-selection action popup open on one word: + Note, + Story Bible and Look up (Look up is offered for one word only)',
    ...POPUP_ANCHORED_AT_FIRST_WIDTH,
  },
  {
    page: 'script',
    state: 'word-lookup-definition',
    description:
      'Script, the Look up panel for "bank" - each part of speech with numbered definitions, examples and synonyms, and the CC BY 4.0 credit of the dictionary (ADR 0097)',
  },
  {
    page: 'script',
    state: 'word-lookup-not-found',
    description: 'Script, the Look up panel for a word the dictionary does not have ("Alice"), said plainly, with the credit',
  },
  {
    page: 'script',
    state: 'word-lookup-not-installed',
    description:
      'Script, Look up with the dictionary not installed - the first-use question with its size, where it is kept and its licence; nothing downloads until Download dictionary',
  },
  {
    page: 'script',
    state: 'word-lookup-damaged',
    description: 'Script, Look up with a dictionary whose index fails its check - asked as a repair (Download again), in plain language',
  },
  {
    page: 'script',
    state: 'overlapping-highlights',
    description: 'Script, entity highlight overlapping a note',
    sameAs: { of: 'script/reader-text-medium', reason: 'Medium is the default reader size and the overlap is visible in the default view.' },
  },
  { page: 'script', state: 'sticky-header-scrolled', description: 'Script, scrolled with sticky chapter header', ...KEEPS_DESKTOP_SCROLL },
  { page: 'script', state: 'chapter-collapsed', description: 'Script, a chapter card collapsed' },
  {
    page: 'script',
    state: 'chapter-header-columns',
    description:
      'Script, mixed chapter rows (?mockManuscript=mixed): a Front Matter row with no Record in Booth and 3-, 4- and 5-digit word counts - the stats and the buttons in two aligned columns, a chevron last (manuscript-chapter-header-alignment.prd.md, manuscript-credits-card-parity.prd.md)',
  },
  { page: 'script', state: 'add-note-dialog', description: 'Script, Add Note dialog open after selecting text' },
  {
    page: 'script',
    state: 'script-markup',
    description:
      'Script, script markup on Chapter 3 (prep-depth PRD Phase 5): stress underlines, a breath and a pause after words, Mouse and Lory speaker chips, a "Text changed here" notice beside a line whose marked words changed, and a mark whose line is gone listed above the chapter',
  },
  {
    page: 'script',
    state: 'markup-dialog',
    description:
      'Script, the Mark up dialog for a selection that already carries a stress mark: Speaker chosen, the Story Bible characters one press away, and the mark already there with its Remove',
  },
  { page: 'script', state: 'formatted-text-and-line-breaks', description: 'Script, paragraphs with preserved bold/italic/underline and a line break' },
  { page: 'script', state: 'chapter-bookmarked', description: 'Script, a chapter bookmarked (blue bookmark icon)' },
  { page: 'script', state: 'go-to-line-highlight', description: 'Script, arrived via Story Bible "Go to line" with the target line highlighted' },
  { page: 'script', state: 'reader-dark', description: 'Script, reader in the Dark theme (readable active controls, opaque sticky header)' },
  {
    page: 'script',
    state: 'credits-entries',
    description:
      'Script, the Opening credits pseudo-entry expanded before Chapter 1 with an unresolved-token chip (audiobook-credits-templates.prd.md Phase 3)',
  },
  {
    page: 'script',
    state: 'credits-entries-fill-in',
    description:
      'Script, the credits-setup banner above the Opening credits card and its own "Fill in" button beside the unresolved-token line (credits-token-setup-and-front-matter-detection.prd.md Phase 3, ?mockCredits=setup, mockups/credits-token-setup-and-front-matter-detection/03-manuscript-banner-and-fill-in.webp)',
  },
  {
    page: 'script',
    state: 'retail-sample',
    description:
      'Script, the retail sample picked on lines 1-3 of Chapter 3 (?mockCredits=extras, audiobook-credits-templates.prd.md Phase 5): a "Retail sample" tag on the chapter header, the sampled lines marked with a left rule, "Retail sample starts · about ..." above the first and "Retail sample ends" above the last',
  },

  {
    page: 'script',
    state: 'speaker-attribution-single-speaker',
    description:
      'Script, Chapter 3, a dialogue line whose recorded demo cue (prep-depth.prd.md Phase 4, Q1 fixture-then-real) is tagged directly to a known character - a speaker chip reading "Alice" beside the line (docs/prds/mockups/prep-depth/02-prep-script-concept.webp)',
  },
  {
    page: 'script',
    state: 'speaker-attribution-ambiguous',
    description:
      'Script, Chapter 3, a dialogue line whose recorded demo cue resolves only through scene continuation (speaker_source: "continuation", no direct tag) - the chip still names the resolved speaker, "Alice", the same as a direct tag',
  },
  {
    page: 'script',
    state: 'speaker-attribution-unknown',
    description:
      'Script, Chapter 3, a dialogue line spoken by a character with no Story Bible entry (the Mouse) - the recorded demo cue has no resolved speaker, so no chip and no placeholder name (Success Metrics: "unknown renders as unattributed, never a fabricated name")',
  },
  // Mock 02's rail (stage-navigation-and-page-replacement.prd.md Phase 3, ADR 0392): a column from `2xl` (the wide width), a panel
  // opened from the band's Prep rail button below it. The driver picks by what the width shows, so each width loads afresh.
  {
    page: 'script',
    state: 'prep-rail-characters',
    description:
      "Script, the rail's Characters tab (mock 02): the Story Bible's characters with their first description line; a name opens its summary. A column beside the reader at the wide width, the Prep panel below it",
    ...RAIL_DEPENDS_ON_WIDTH,
  },
  {
    page: 'script',
    state: 'prep-rail-queries',
    description:
      "Script, the rail's Queries tab (mock 02): every name the author has not confirmed, with where it is first heard and its status (one marked Query sent), and Manage queries for the Story Bible's queries panel; the chapter list counts each chapter's names still to confirm",
    ...RAIL_DEPENDS_ON_WIDTH,
  },
  {
    page: 'script',
    state: 'invalid-payload',
    description:
      'Script, the inline error with Retry when the data it loads could not be read, beside the notice Home raised for the same data; navigation still works (ADR 0069, 0075)',
  },
];
