// The `storybible` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL } from './shared';

export const storybibleStates: StateEntry[] = [
  // Story Bible
  {
    page: 'storybible',
    state: 'rebuild-running',
    description:
      'Story Bible, a rebuild still running: its dialog says the step cannot be cancelled but can go on in the background (ADR 0076, ?mockRebuildRunning=1)',
  },
  {
    page: 'storybible',
    state: 'entry-saving',
    description: 'Story Bible, an entry being saved: the Save button is busy and the other actions are off (ADR 0075, ?mockHoldEdits=1)',
  },
  {
    page: 'storybible',
    state: 'language-model-confirm',
    description:
      'Story Bible, the first-use question before the language model is downloaded: what it is, its sizes and where it goes, with Download, Build with rules-only and Cancel (?mockAssets=missing)',
  },
  {
    page: 'storybible',
    state: 'language-model-progress',
    description: 'Story Bible, the language model download with real bytes, 39 percent and Cancel (?mockAssets=downloading)',
  },
  {
    page: 'storybible',
    state: 'voice-download-confirm',
    description: 'Story Bible, the first-use question before the local preview voice is downloaded: what it is, its size, publisher and licence',
  },
  {
    page: 'storybible',
    state: 'voice-download-progress',
    description: 'Story Bible, the voice download with real bytes, 39 percent and Cancel (?mockAssets=downloading)',
  },
  {
    page: 'storybible',
    state: 'voice-download-failed',
    description: 'Story Bible, the voice download after it failed: the reason as an alert and Close (?mockAssets=download-fails)',
  },
  { page: 'storybible', state: 'category-all', description: 'Story Bible, All category tab' },
  { page: 'storybible', state: 'category-character', description: 'Story Bible, Character category tab' },
  { page: 'storybible', state: 'category-place', description: 'Story Bible, Place/Location category tab' },
  { page: 'storybible', state: 'category-organization', description: 'Story Bible, Organization category tab' },
  { page: 'storybible', state: 'category-needs-review', description: 'Story Bible, Needs Review category tab', ...KEEPS_DESKTOP_SCROLL },
  {
    page: 'storybible',
    state: 'entity-selected',
    description: 'Story Bible, an entity selected (detail panel open)',
    sameAs: { of: 'storybible/category-all', reason: 'Story Bible opens on All with the first entity already selected.' },
  },
  { page: 'storybible', state: 'alias-typeahead', description: 'Story Bible, alias-typeahead dropdown open' },
  { page: 'storybible', state: 'delete-confirm', description: 'Story Bible, delete confirm dialog open' },
  { page: 'storybible', state: 'entry-locked', description: 'Story Bible, a locked entry' },
  {
    page: 'storybible',
    state: 'entry-unlocked',
    description: 'Story Bible, an unlocked entry (read-only until Edit)',
    sameAs: { of: 'storybible/entity-selected', reason: 'The fixture entity a fresh selection lands on is unlocked, so selecting it is this state.' },
  },
  { page: 'storybible', state: 'entry-editing', description: 'Story Bible, an unlocked entry in edit mode (Save and Cancel shown)' },
  {
    page: 'storybible',
    state: 'entry-properties-editing',
    description: 'Story Bible, an entry in edit mode with its properties table: a new row with a value and no name, and the message that says so',
    ...KEEPS_DESKTOP_SCROLL,
  },
  { page: 'storybible', state: 'entry-needs-review', description: 'Story Bible, a Needs Review entry with review-colored evidence highlights' },
  {
    page: 'storybible',
    state: 'entry-pronunciation-missing',
    description: 'Story Bible, an entry with no pronunciation in edit mode: Play disabled with a reason, and Generate offered',
  },
  {
    page: 'storybible',
    state: 'entry-pronunciation-work',
    description:
      "Story Bible, an entry in edit mode after the narrator used their own pronunciation and marked it Query sent with a note: the status badge, the note, the dictionary's answer kept beside it and the switch back (prep-depth P1)",
  },
  {
    page: 'storybible',
    state: 'entry-pronunciation-online',
    description:
      "Story Bible, an entry's pronunciation details after Look up online: Merriam-Webster's respelling with Use this, on the narrator's own key (prep-depth P9)",
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'storybible',
    state: 'pronunciation-queries',
    description:
      'Story Bible, the Pronunciation queries slide-over: every name not yet author confirmed in reading order, the first marked sent, with the filter, the open/sent count, Export CSV and Mark sent / Mark answered (prep-depth P3)',
  },
  {
    page: 'storybible',
    state: 'pronunciation-queries-online-confirm',
    description:
      'Story Bible, the notice before a batch online lookup: how many names it sends to Merriam-Webster, one at a time, and that nothing else leaves (prep-depth P9, Q11)',
  },

  {
    page: 'storybible',
    state: 'invalid-payload',
    description: 'Story Bible, the inline error with Retry when the entities could not be read; navigation still works (ADR 0069)',
  },

  // Character bible (character-continuity-review.prd.md Phase 6, non-acoustic part only; D87 on #509 benches
  // every acoustic-drift binding, so there is no findings, drift comparison or audition here).
  {
    page: 'storybible',
    state: 'character-voice-references',
    description:
      'Story Bible, a Character entry: Reference clips (an approved reference, one flagged changed since approval, approve-a-region picker) and Dialogue cues (an unattributed cue with its speaker correction control) (character-continuity-review P6)',
  },
  {
    page: 'storybible',
    state: 'voice-data-panel',
    description:
      'Story Bible, the Voice data slide-over from the toolbar: approving a reference for plain Narration (Q9) and the Remove voice data action (Q7)',
  },
  {
    page: 'storybible',
    state: 'remove-voice-data-confirm',
    description: 'Story Bible, the Voice data slide-over with the Remove voice data confirm dialog open (Q7, destructive, project-wide)',
  },
];
