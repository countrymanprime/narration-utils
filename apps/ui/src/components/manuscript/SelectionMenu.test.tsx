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

  it('offers Look up only when it is given one, and looks the word up when pressed', () => {
    const lookUp = vi.fn();
    const { rerender } = render(<SelectionMenu selection={selection} addNote={vi.fn()} addToStoryBible={vi.fn()} dismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Look up' })).toBeNull();
    rerender(<SelectionMenu selection={selection} addNote={vi.fn()} addToStoryBible={vi.fn()} lookUp={lookUp} dismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(lookUp).toHaveBeenCalledOnce();
  });

  it('says the lookup is running, ignores a second press and leaves the other actions off meanwhile (ADR 0075)', () => {
    const lookUp = vi.fn();
    const addNote = vi.fn();
    const addToStoryBible = vi.fn();
    render(<SelectionMenu selection={selection} addNote={addNote} addToStoryBible={addToStoryBible} lookUp={lookUp} lookingUp dismiss={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Look up' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Story Bible' }));
    expect(lookUp).not.toHaveBeenCalled();
    expect(addNote).not.toHaveBeenCalled();
    expect(addToStoryBible).not.toHaveBeenCalled();
  });

  it('leaves Look up off while the Story Bible entry is being created', () => {
    const lookUp = vi.fn();
    render(<SelectionMenu selection={selection} addNote={vi.fn()} addToStoryBible={vi.fn()} addingToStoryBible lookUp={lookUp} dismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(lookUp).not.toHaveBeenCalled();
  });
});
