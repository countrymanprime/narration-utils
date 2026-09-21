// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManuscriptSelection } from '../../hooks/useTextSelection';
import { SelectionMenu } from './SelectionMenu';

afterEach(cleanup);

const selection: ManuscriptSelection = { text: 'the White Rabbit', rect: new DOMRect(100, 100, 80, 20) };

describe('SelectionMenu', () => {
  it('adds the selection to the Story Bible when pressed', () => {
    const addToStoryBible = vi.fn();
    render(<SelectionMenu selection={selection} addNote={vi.fn()} addToStoryBible={addToStoryBible} dismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Story Bible' }));
    expect(addToStoryBible).toHaveBeenCalledOnce();
  });

  it('says the entry is being created and ignores a second press (ADR 0075), and leaves Note off meanwhile', () => {
    const addToStoryBible = vi.fn();
    const addNote = vi.fn();
    render(<SelectionMenu selection={selection} addNote={addNote} addToStoryBible={addToStoryBible} addingToStoryBible dismiss={vi.fn()} />);
    const button = screen.getByRole('button', { name: '+ Story Bible' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
    expect(addToStoryBible).not.toHaveBeenCalled();
    expect(addNote).not.toHaveBeenCalled();
  });
});
