import { describe, expect, it } from 'vitest';
import { hasHint, splitHintTerms, suggestionMessage } from './hints';

describe('hasHint', () => {
  it('matches a name in any case', () => {
    expect(hasHint(['Alice'], 'alice')).toBe(true);
    expect(hasHint(['Alice'], 'Alicia')).toBe(false);
  });
});

describe('splitHintTerms', () => {
  it('splits on commas and line breaks, trims, drops blanks and repeats', () => {
    expect(splitHintTerms(' Juno,  Zeph , ,juno\nHatter\r\nMarch Hare ')).toEqual(['Juno', 'Zeph', 'Hatter', 'March Hare']);
    expect(splitHintTerms(' , ')).toEqual([]);
  });
});

describe('suggestionMessage', () => {
  it('has distinct wording for nothing found, all accepted, all already shown, and new suggestions', () => {
    const messages = [suggestionMessage(0, 0, 0), suggestionMessage(3, 0, 0), suggestionMessage(3, 2, 0), suggestionMessage(3, 2, 2)];
    expect(new Set(messages).size).toBe(4);
  });

  it('agrees in number', () => {
    expect(suggestionMessage(1, 0, 0)).toBe('No new suggestions: all 1 name found is already accepted.');
    expect(suggestionMessage(2, 1, 0)).toBe('The suggestion found is already shown. Click one to accept it.');
    expect(suggestionMessage(2, 1, 1)).toBe('Found 1 new suggestion.');
    expect(suggestionMessage(5, 4, 4)).toBe('Found 4 new suggestions.');
  });
});
