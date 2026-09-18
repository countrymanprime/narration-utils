// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapterNav } from './ChapterNav';
import type { ManuscriptChapter } from '../../types';

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
});
