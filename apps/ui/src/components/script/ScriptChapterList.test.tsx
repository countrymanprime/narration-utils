// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManuscriptChapter } from '../../types';
import { ScriptChapterList } from './ScriptChapterList';

afterEach(cleanup);

const chapter = (id: string, title: string, index: number, extra: Partial<ManuscriptChapter> = {}): ManuscriptChapter => ({
  id,
  title,
  index,
  wordCount: 1000,
  status: 'not_started',
  ...extra,
});

const CHAPTERS = [
  chapter('contents', 'Contents', 0, { contentKind: 'reference' }),
  chapter('c1', 'Chapter 1 — Down the Rabbit-Hole', 1),
  chapter('c2', 'Chapter 2 — The Pool of Tears', 2),
];

describe('ScriptChapterList (stage navigation Phase 3, mock 02)', () => {
  it('lists the chapters the reader shows, never reference material, and marks the one being read', () => {
    render(<ScriptChapterList chapters={CHAPTERS} activeId="c2" toConfirm={new Map()} select={vi.fn()} />);
    const list = screen.getByRole('navigation', { name: 'Chapters' });
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['1 · Down the Rabbit-Hole', '2 · The Pool of Tears']);
    expect(
      within(list)
        .getByRole('button', { name: /The Pool of Tears/ })
        .getAttribute('aria-current'),
    ).toBe('true');
    expect(
      within(list)
        .getByRole('button', { name: /Rabbit-Hole/ })
        .getAttribute('aria-current'),
    ).toBeNull();
  });

  it("draws a numbered chapter compactly as 'N · Title' (mock 02) and keeps the full name as the hover title", () => {
    render(<ScriptChapterList chapters={CHAPTERS} activeId="c1" toConfirm={new Map()} select={vi.fn()} />);
    const button = screen.getByRole('button', { name: /Rabbit-Hole/ });
    expect(button.textContent).toBe('1 · Down the Rabbit-Hole');
    expect(button.getAttribute('title')).toBe('Chapter 1 — Down the Rabbit-Hole');
  });

  it('leaves a chapter that is not numbered as it is named', () => {
    const chapters = [chapter('p', 'Prologue — Before', 1), chapter('e', 'Epilogue', 2)];
    render(<ScriptChapterList chapters={chapters} toConfirm={new Map()} select={vi.fn()} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Prologue — Before', 'Epilogue']);
  });

  it('opens a chapter in the reader when it is pressed', () => {
    const select = vi.fn();
    render(<ScriptChapterList chapters={CHAPTERS} activeId="c1" toConfirm={new Map()} select={select} />);
    fireEvent.click(screen.getByRole('button', { name: /The Pool of Tears/ }));
    expect(select).toHaveBeenCalledWith('c2');
  });

  it("shows a chapter's prep status as the names in it the author has not confirmed, and nothing for a chapter with none", () => {
    render(<ScriptChapterList chapters={CHAPTERS} activeId="c1" toConfirm={new Map([['c1', 3]])} select={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Rabbit-Hole/ }).textContent).toBe('1 · Down the Rabbit-Hole');
    expect(screen.getByText('3 to confirm')).toBeTruthy();
    // The count sits beside the chapter's button, not inside its name, and a chapter with nothing open shows no badge.
    expect(screen.getAllByText(/to confirm/)).toHaveLength(1);
  });
});
