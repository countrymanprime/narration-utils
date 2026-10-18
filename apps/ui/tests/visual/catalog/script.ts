// The `script` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured. The Studio Next Script page (SN-B77,
// swapped in by SN-B8): three columns at 1440, the rail a drawer below 1280 px and the chapter list a drawer below 1180 px.
import type { StateEntry } from '../lib/types';
import { POPUP_ANCHORED_AT_FIRST_WIDTH, RAIL_DEPENDS_ON_WIDTH } from './shared';

// A rail tab: the column beside the reader at 1440, the drawer over the text with its scrim below 1280 px.
const railTab = (state: string, description: string): StateEntry => ({ page: 'script', state, description, ...RAIL_DEPENDS_ON_WIDTH });

export const scriptStates: StateEntry[] = [
  {
    page: 'script',
    state: 'reader',
    description:
      'Script, the continuous reader on Chapter 1: the chapter list with its prep dots, the chapter card, the marks and speaker chips in the text, and the rail on its Words tab',
  },
  railTab('rail-words', 'Script, the rail on its Words tab with a word chosen: how to say it, its source and the web look-ups'),
  railTab('rail-story-bible', "Script, the rail on its Story Bible tab: the book's entries by kind, one opened"),
  railTab('rail-notes', "Script, the rail on its Notes tab: the chapter's notes, each with where it is"),
  railTab('rail-queries', "Script, the rail on its Queries tab: the chapter's questions for the author"),
  railTab('rail-bookmarks', 'Script, the rail on its Bookmarks tab (an icon tab), with a bookmark placed from the selection toolbar'),
  {
    page: 'script',
    state: 'chapter-list',
    description:
      'Script, Chapter 3 chosen from the chapter list: the column at 1440, the drawer from the left with its scrim below 1180 px (the header’s Chapters button)',
    // The driver opens the drawer only where the width shows its button, so each width loads afresh.
    reloadPerViewport: true,
  },
  { page: 'script', state: 'find', description: 'Script, Find open on "Alice": the bar over the reader with its count, the matches lit and the results list' },
  {
    page: 'script',
    state: 'selection-tools',
    description: 'Script, the selection toolbar over a selected word: Mark, the Story Bible kinds, Bookmark here, Record here and Look up',
    ...POPUP_ANCHORED_AT_FIRST_WIDTH,
  },
  {
    page: 'script',
    state: 'mark-composer',
    description: 'Script, the mark composer for a selected word: the mark’s type and its note',
    ...POPUP_ANCHORED_AT_FIRST_WIDTH,
  },
  { page: 'script', state: 'define-marks', description: 'Script, the Define how you mark up dialog: each mark type with its name, colour and line' },
  {
    page: 'script',
    state: 'text-settings',
    description: 'Script, the text settings popover: font, size, line spacing and column width',
    ...POPUP_ANCHORED_AT_FIRST_WIDTH,
  },
  {
    page: 'script',
    state: 'credits-cards',
    description:
      'Script, the Opening credits drawn as the mock draws a chapter above Chapter 1: the Credits card with My prep and its unresolved tokens, then the credits text',
  },
  {
    page: 'script',
    state: 'credits-setup-banner',
    description: 'Script, the credits-setup banner above the Opening credits and the card’s own Fill in (?mockCredits=setup, kept as built)',
  },
  {
    page: 'script',
    state: 'retail-sample',
    description:
      'Script, the retail sample picked on lines 1-3 of Chapter 3 (?mockCredits=extras): "Retail sample starts · about ..." beside the first line and "Retail sample ends" beside the last (kept as built)',
  },
  { page: 'script', state: 'reader-dark', description: 'Script, the reader in the Dark theme' },
  {
    page: 'script',
    state: 'invalid-payload',
    description:
      'Script, the inline error with Retry when the data it loads could not be read, beside the notice Home raised for the same data; navigation still works',
  },
  {
    page: 'script',
    state: 'no-manuscript',
    description:
      'Script with no manuscript imported (?mockNoManuscript=1), opened by its address: the page asks for the manuscript, with Import manuscript, and does not open the import or leave for Production by itself',
  },
];
