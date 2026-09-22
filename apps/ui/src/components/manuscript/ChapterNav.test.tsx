// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterNav } from './ChapterNav';
import type { ManuscriptChapter, ReaderBookmark, SearchHit } from '../../types';

afterEach(cleanup);

const chapter = (overrides: Partial<ManuscriptChapter>): ManuscriptChapter => ({
  id: overrides.id ?? 'c1',
  title: overrides.title ?? 'Chapter',
  index: overrides.index ?? 0,
  wordCount: overrides.wordCount ?? 100,
  status: overrides.status ?? 'not_started',
  ...overrides,
});

describe('ChapterNav', () => {
  it('excludes reference-material chapters from the nav list, but keeps narration and front matter', () => {
    const chapters = [
      chapter({ id: 'front', title: 'Front Matter', contentKind: 'opening' }),
      chapter({ id: 'c1', title: 'Chapter One', contentKind: 'narration' }),
      chapter({ id: 'contents', title: 'Contents', contentKind: 'reference' }),
      chapter({ id: 'characters', title: 'Characters', contentKind: 'reference' }),
    ];
    render(
      <ChapterNav chapters={chapters} bookmarks={[]} searchQuery="" searchResults={[]} lineNumbers={new Map()} select={vi.fn()} removeBookmark={vi.fn()} />,
    );
    expect(screen.getByText('Front Matter')).toBeTruthy();
    expect(screen.getByText('Chapter One')).toBeTruthy();
    expect(screen.queryByText('Contents')).toBeNull();
    expect(screen.queryByText('Characters')).toBeNull();
  });

  it('numbers a search hit from paragraphIds even when its chapter was never loaded (R5)', () => {
    const chapters = [
      chapter({
        id: 'c1',
        title: 'Chapter One',
        paragraphIds: [
          { id: 'p10', index: 10 },
          { id: 'p11', index: 11 },
          { id: 'p12', index: 12 },
        ],
      }),
    ];
    const hits: SearchHit[] = [{ chapter: 'Chapter One', chapterId: 'c1', paragraph: 12, excerpt: 'found it' }];
    render(
      <ChapterNav
        chapters={chapters}
        bookmarks={[]}
        searchQuery="found"
        searchResults={hits}
        lineNumbers={new Map()}
        select={vi.fn()}
        removeBookmark={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Search result in Chapter One, line 3' })).toBeTruthy();
  });

  it('shows "No matches" when every hit falls in a hidden reference chapter, instead of a blank panel', () => {
    const chapters = [chapter({ id: 'contents', title: 'Contents', contentKind: 'reference' })];
    const hits: SearchHit[] = [{ chapter: 'Contents', chapterId: 'contents', paragraph: 0, excerpt: 'Chapter One .... 1' }];
    render(
      <ChapterNav
        chapters={chapters}
        bookmarks={[]}
        searchQuery="chapter"
        searchResults={hits}
        lineNumbers={new Map()}
        select={vi.fn()}
        removeBookmark={vi.fn()}
      />,
    );
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('colours the chapter-row bookmark badge and a line bookmark row on the same --bookmark token (R9)', () => {
    const chapters = [chapter({ id: 'c1', title: 'Chapter One' })];
    const bookmarks: ReaderBookmark[] = [
      { id: 'b1', kind: 'chapter', chapter: 'Chapter One', chapterId: 'c1', createdAt: '' },
      { id: 'b2', kind: 'line', chapter: 'Chapter One', chapterId: 'c1', paragraph: 5, createdAt: '' },
    ];
    render(
      <ChapterNav
        chapters={chapters}
        bookmarks={bookmarks}
        searchQuery=""
        searchResults={[]}
        lineNumbers={new Map()}
        select={vi.fn()}
        removeBookmark={vi.fn()}
      />,
    );
    const icons = document.querySelectorAll('.text-\\[var\\(--bookmark\\)\\]');
    expect(icons.length).toBe(2);
  });
});
