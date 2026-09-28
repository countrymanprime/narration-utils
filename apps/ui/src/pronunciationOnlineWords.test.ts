import { describe, expect, it } from 'vitest';
import { onlineBatchWords, onlineWord } from './pronunciationOnlineWords';

// The same cases as the Go host's TestCheckWordAcceptsANameAndRefusesEverythingElse (internal/pronunciationonline).
describe('onlineWord', () => {
  it('accepts a name and tidies its spaces', () => {
    for (const [raw, want] of [
      ['croquet', 'croquet'],
      ['  Mock   Turtle ', 'Mock Turtle'],
      ["O'Brien", "O'Brien"],
      ['O\u2019Brien', 'O\u2019Brien'],
      ['café', 'café'],
      ['Jean-Luc', 'Jean-Luc'],
      ['St. John', 'St. John'],
      ['Henry VIII', 'Henry VIII'],
      ['Nguyễn', 'Nguyễn'],
      ['R2-D2', 'R2-D2'],
      ["Dr. Jekyll's Maid", "Dr. Jekyll's Maid"],
    ]) {
      expect(onlineWord(raw as string)).toBe(want);
    }
  });

  it('refuses a passage, a path, a file name, an id and a line break', () => {
    for (const raw of [
      '',
      '   ',
      'The Mock Turtle sighed deeply',
      'chapter-01.docx/../x',
      'C:\\Books\\alice.docx',
      'alice.docx?id=42',
      'wren\nsparrow',
      'proj_7f3a',
      'who?',
      'a,b',
      '42',
      'a'.repeat(65),
    ]) {
      expect(onlineWord(raw)).toBeUndefined();
    }
  });
});

describe('onlineBatchWords', () => {
  it('counts each word once, case-insensitively, and counts what it leaves out', () => {
    expect(onlineBatchWords(['Wren', 'wren', 'Alice', 'a whole long sentence here'])).toEqual({ words: ['Wren', 'Alice'], leftOut: 1 });
  });
});
