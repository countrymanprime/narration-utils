// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrepMarkupSpan } from '../../types';
import { MarkupDialog } from './MarkupDialog';

afterEach(cleanup);

const existing: PrepMarkupSpan = {
  id: 'm1',
  chapterId: 'c-1',
  paragraphId: 'p-1',
  paragraph: 0,
  start: 0,
  end: 5,
  anchorText: 'Alice',
  kind: 'stress',
  value: '',
  createdAt: '2026-09-27T12:00:00Z',
  stale: false,
};

function renderDialog(props: Partial<Parameters<typeof MarkupDialog>[0]> = {}) {
  const confirm = vi.fn();
  const remove = vi.fn();
  const cancel = vi.fn();
  render(
    <MarkupDialog anchorText="Alice was" characters={['Alice', 'White Rabbit']} existing={[]} confirm={confirm} remove={remove} cancel={cancel} {...props} />,
  );
  return { confirm, remove, cancel };
}

describe('MarkupDialog', () => {
  it('places a stress mark by default', async () => {
    const { confirm } = renderDialog();
    expect(screen.getByText('Mark up: “Alice was”')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add mark' }));
    expect(confirm).toHaveBeenCalledWith('stress', '');
  });

  it('places a breath or a pause after the words', async () => {
    const { confirm } = renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: /Pause/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add mark' }));
    expect(confirm).toHaveBeenLastCalledWith('pause', 'long');
    await userEvent.click(screen.getByRole('radio', { name: /Breath/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add mark' }));
    expect(confirm).toHaveBeenLastCalledWith('pause', 'short');
  });

  it('tags a speaker by name, and needs one', async () => {
    const { confirm } = renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: /Speaker/ }));
    const add = screen.getByRole('button', { name: 'Add mark' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    // A Story Bible character is one press away; any other name can be typed.
    await userEvent.click(screen.getByRole('button', { name: 'White Rabbit' }));
    expect((screen.getByLabelText('Speaker name') as HTMLInputElement).value).toBe('White Rabbit');
    fireEvent.change(screen.getByLabelText('Speaker name'), { target: { value: '  The Queen ' } });
    await userEvent.click(add);
    expect(confirm).toHaveBeenCalledWith('character_tag', 'The Queen');
  });

  it('lists the marks already on these words, each with its own Remove', async () => {
    const { remove } = renderDialog({ existing: [existing, { ...existing, id: 'm2', kind: 'character_tag', value: 'Alice' }] });
    expect(screen.getByText('Already on these words')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove the Alice tag on “Alice”' }));
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }));
  });

  it('cancels', async () => {
    const { cancel, confirm } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });
});
