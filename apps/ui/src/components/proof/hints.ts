/**
 * Pure helpers for the Proofing vocabulary hints, kept out of Transcript.tsx so the
 * matching and wording rules can be tested without rendering the page.
 */

/** Hints are one spelling per name, compared without regard to case: the host keeps the first spelling it sees. */
export const hasHint = (hints: readonly string[], term: string) => hints.some((hint) => hint.toLowerCase() === term.toLowerCase());

// A term this long already reads as a mistake, not a vocabulary hint (Phase 2, V5). TagInput's own `maxLength` caps a
// single typed term at the DOM level; this catches the other route a term can arrive by - a multi-term paste, which
// TagInput commits as one blob for this function to split.
const MAX_TERM_LENGTH = 64;

/**
 * Splits typed or pasted text into terms. The recognizer takes the hints as one
 * comma-joined string, so a term can never hold a comma; a list is split on commas
 * and line breaks, blanks are dropped, each term is capped at 64 characters, and a
 * repeated name (in any case) counts once.
 */
export function splitHintTerms(text: string): string[] {
  return text
    .split(/[,\r\n]+/)
    .map((term) => term.trim().slice(0, MAX_TERM_LENGTH))
    .filter(Boolean)
    .reduce<string[]>((terms, term) => (hasHint(terms, term) ? terms : [...terms, term]), []);
}

const plural = (count: number, singular: string, many = `${singular}s`) => `${count} ${count === 1 ? singular : many}`;

/**
 * What a "Suggest from manuscript" click did. `found` is every name the Story Bible
 * offered, `fresh` the ones not yet accepted, `added` the ones not already showing as
 * pending; each situation has its own wording so a click never looks like it did nothing.
 */
export function suggestionMessage(found: number, fresh: number, added: number): string {
  if (found === 0) return 'No names found in the Story Bible yet. Build it or add entries, then try again.';
  if (fresh === 0) return `No new suggestions: all ${plural(found, 'name')} found ${found === 1 ? 'is' : 'are'} already accepted.`;
  if (added === 0) return `${fresh === 1 ? 'The suggestion found is' : `The ${fresh} suggestions found are`} already shown. Click one to accept it.`;
  return `Found ${added} new ${added === 1 ? 'suggestion' : 'suggestions'}.`;
}
