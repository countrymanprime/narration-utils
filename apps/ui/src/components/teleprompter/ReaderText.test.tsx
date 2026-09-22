// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReaderText } from './ReaderText';
import type { ReaderRow } from './readerModel';

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
