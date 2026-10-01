// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadLastChapter, saveLastChapter } from './lastChapterStorage';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('lastChapterStorage', () => {
  it('remembers the chapter per project', () => {
    saveLastChapter('/a', 'chapter-2');
    saveLastChapter('/b', 'chapter-1');
    expect(loadLastChapter('/a')).toBe('chapter-2');
    expect(loadLastChapter('/b')).toBe('chapter-1');
  });

  it('reads as nothing when nothing is stored, and never stores an empty id', () => {
    expect(loadLastChapter('/a')).toBe('');
    saveLastChapter('/a', '');
    expect(loadLastChapter('/a')).toBe('');
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadLastChapter('/a')).toBe('');
    expect(() => saveLastChapter('/a', 'chapter-1')).not.toThrow();
  });
});
