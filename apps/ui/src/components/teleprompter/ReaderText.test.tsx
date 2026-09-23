// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderText } from './ReaderText';
import type { ReaderMark, ReaderRow } from './readerModel';
import type { GuideEntity, ManuscriptNote } from '../../types';

afterEach(cleanup);

const row = (overrides: Partial<ReaderRow> = {}): ReaderRow => ({
  key: 'p1',
  kind: 'paragraph',
  start: 0,
  words: ['Alice', 'was', 'beginning', 'to', 'get', 'tired'],
  gaps: [' ', ' ', ' ', ' ', ' ', ''],
  text: 'Alice was beginning to get tired',
  ...overrides,
});

describe('ReaderText word-click seek (teleprompter-manuscript-integration.prd.md Phase 4)', () => {
  it('renders no clickable words when onSeek is not given (no session, or a session not yet active)', () => {
    render(<ReaderText rows={[row()]} cursor={2} skipped={[]} follow={false} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('makes every word but the current one a button labelled by direction, and calls onSeek with its script index on click', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<ReaderText rows={[row()]} cursor={2} skipped={[]} follow={false} onSeek={onSeek} />);

    // index 2 ("beginning") is the current word: not clickable, and not offered a seek direction.
    expect(screen.queryByRole('button', { name: /beginning/ })).toBeNull();

    const ahead = screen.getByRole('button', { name: /Start here.*get/ });
    const behind = screen.getByRole('button', { name: /Go back to here.*was/ });

    await user.click(ahead);
    expect(onSeek).toHaveBeenCalledWith(4);

    await user.click(behind);
    expect(onSeek).toHaveBeenCalledWith(1);
  });

  it('is keyboard operable: Enter activates a focused word', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<ReaderText rows={[row()]} cursor={2} skipped={[]} follow={false} onSeek={onSeek} />);

    const target = screen.getByRole('button', { name: /Start here.*tired/ });
    target.focus();
    await user.keyboard('{Enter}');

    expect(onSeek).toHaveBeenCalledWith(5);
  });

  it('never offers a seek for an untracked row (word count disagrees with the sidecar span)', () => {
    const onSeek = vi.fn();
    render(<ReaderText rows={[row({ words: null, gaps: null })]} cursor={0} skipped={[]} follow={false} onSeek={onSeek} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

const alice = { id: 'e1', canonical_name: 'Alice', category: 'Character' } as GuideEntity;
const note = { id: 'n1', text: 'Slow down.', paragraph: 0 } as ManuscriptNote;
const entityMark = (from: number, to: number): ReaderMark => ({ id: `entity-${from}`, from, to, value: { kind: 'entity', entity: alice } });
const noteMark = (from: number, to: number): ReaderMark => ({ id: `note-${from}`, from, to, value: { kind: 'note', note } });

describe('ReaderText story bible and note marks (teleprompter-manuscript-integration.prd.md Phase 5)', () => {
  it('draws an entity in its Story Bible category colour and a note as a note, through Highlight', () => {
    const marks = new Map([['p1', [entityMark(0, 1), noteMark(3, 5)]]]);
    const { container } = render(<ReaderText rows={[row()]} cursor={0} skipped={[]} follow={false} marks={marks} />);

    const character = container.querySelector('[data-highlight="Character"]');
    const noted = container.querySelector('[data-highlight="Note"]');
    expect(character?.textContent).toBe('Alice');
    // A mark over several words covers the gaps between them but not the one after its last word.
    expect(noted?.textContent).toBe('to get');
  });

  it('keeps every word and gap of the row in order, marked or not', () => {
    const marks = new Map([['p1', [entityMark(0, 1), noteMark(3, 5)]]]);
    const { container } = render(<ReaderText rows={[row()]} cursor={0} skipped={[]} follow={false} marks={marks} />);
    expect(container.querySelector('p')?.textContent?.trimEnd()).toBe('Alice was beginning to get tired');
  });

  it('opens a mark on click or Enter and never seeks, even while a session is running', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    const onOpenMark = vi.fn();
    const marks = new Map([['p1', [noteMark(3, 5)]]]);
    const { container } = render(<ReaderText rows={[row()]} cursor={1} skipped={[]} follow={false} onSeek={onSeek} marks={marks} onOpenMark={onOpenMark} />);

    // Found by its kind: jsdom's name computation drops the gap between the two word spans (a browser reads "to get").
    const mark = container.querySelector<HTMLElement>('[data-highlight="Note"][role="button"]')!;
    await user.click(mark);
    mark.focus();
    await user.keyboard('{Enter}');

    expect(onOpenMark).toHaveBeenCalledTimes(2);
    expect(onOpenMark).toHaveBeenCalledWith(marks.get('p1')![0]);
    expect(onSeek).not.toHaveBeenCalled();
    // The words under a mark are the mark's, not seek buttons of their own; the words outside still seek.
    expect(screen.queryByRole('button', { name: /here.*"to"/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Start here.*tired/ })).toBeTruthy();
  });

  it('makes only the innermost of overlapping marks a control, so no button sits inside another', async () => {
    const user = userEvent.setup();
    const onOpenMark = vi.fn();
    const outer = noteMark(0, 6);
    const inner = entityMark(0, 1);
    const { container } = render(
      <ReaderText rows={[row()]} cursor={0} skipped={[]} follow={false} marks={new Map([['p1', [outer, inner]]])} onOpenMark={onOpenMark} />,
    );

    const buttons = [...container.querySelectorAll<HTMLElement>('[role="button"]')];
    expect(buttons.some((button) => button.querySelector('[role="button"]'))).toBe(false);
    expect(buttons.map((button) => button.dataset.highlight)).toEqual(['Character', 'Note']);

    await user.click(buttons[0]);
    await user.click(buttons[1]);
    expect(onOpenMark.mock.calls).toEqual([[inner], [outer]]);
  });
  it('keeps the gap inside a mark that runs on into an inner one, so its tint is unbroken', () => {
    const whole = entityMark(0, 2);
    const alias = { ...entityMark(1, 2), id: 'alias' };
    const { container } = render(<ReaderText rows={[row()]} cursor={0} skipped={[]} follow={false} marks={new Map([['p1', [whole, alias]]])} />);

    const [first, second] = [...container.querySelectorAll<HTMLElement>('[data-marked]')];
    expect(first.textContent).toBe('Alice ');
    expect(second.textContent).toBe('was ');
    expect(second.querySelectorAll('[data-highlight="Character"]')).toHaveLength(2);
  });
  it('keeps the gap inside a note that carries on past a name, and outside the name', () => {
    const { container } = render(
      <ReaderText rows={[row()]} cursor={0} skipped={[]} follow={false} marks={new Map([['p1', [noteMark(0, 3), entityMark(1, 2)]]])} />,
    );

    const name = container.querySelector<HTMLElement>('[data-highlight="Character"]')!;
    expect(name.textContent).toBe('was');
    expect(name.parentElement?.dataset.highlight).toBe('Note');
    expect(name.parentElement?.textContent).toBe('was ');
    expect(container.querySelector('p')?.textContent?.trimEnd()).toBe('Alice was beginning to get tired');
  });
  it('still dims, fills and numbers the words under a mark', () => {
    const marks = new Map([['p1', [entityMark(0, 3)]]]);
    const { container } = render(<ReaderText rows={[row()]} cursor={1} skipped={[]} follow={false} marks={marks} />);

    expect(container.querySelector('[data-word="1"] [data-highlight="Cursor"]')?.textContent).toBe('was');
    expect((container.querySelector('[data-word="0"]') as HTMLElement).style.color).toBe('var(--text-muted)');
  });

  it('marks a row the tracker does not follow too, without word numbers or a cursor', () => {
    const marks = new Map([['p1', [entityMark(0, 1)]]]);
    const { container } = render(<ReaderText rows={[row({ words: null, gaps: null })]} cursor={0} skipped={[]} follow={false} marks={marks} />);

    expect(container.querySelector('[data-highlight="Character"]')?.textContent).toBe('Alice');
    expect(container.querySelector('[data-word]')).toBeNull();
    expect(container.querySelector('[data-highlight="Cursor"]')).toBeNull();
    expect(container.querySelector('p')?.textContent?.trimEnd()).toBe('Alice was beginning to get tired');
  });

  it('does not scroll when a mark is opened', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const marks = new Map([['p1', [noteMark(3, 5)]]]);
    const { container, rerender } = render(<ReaderText rows={[row()]} cursor={1} skipped={[]} follow marks={marks} onOpenMark={vi.fn()} />);
    scrollIntoView.mockClear();

    await user.click(container.querySelector<HTMLElement>('[data-highlight="Note"]')!);
    rerender(<ReaderText rows={[row()]} cursor={1} skipped={[]} follow marks={marks} onOpenMark={vi.fn()} />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
