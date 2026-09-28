// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Listbox, listboxOptionId } from './Listbox';

afterEach(cleanup);

const OPTIONS = [
  { id: 'alice', label: 'Alice', description: 'Character · 12 occurrences' },
  { id: 'rabbit', label: 'White Rabbit', description: 'Character · 4 occurrences' },
];

describe('Listbox', () => {
  it('is a named listbox of options, with ids a combobox can point at', () => {
    render(<Listbox id="matches" label="Matching entries" options={OPTIONS} activeIndex={1} onPick={vi.fn()} />);
    const list = screen.getByRole('listbox', { name: 'Matching entries' });
    const options = within(list).getAllByRole('option');
    expect(options.map((option) => option.id)).toEqual([listboxOptionId('matches', 'alice'), listboxOptionId('matches', 'rabbit')]);
    // Without a chosen value, the active row is the selected one (the combobox's highlight).
    expect(options.map((option) => option.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    // Focus stays in the combobox's text box: the options are not Tab stops.
    for (const option of options) expect(option.tabIndex).toBe(-1);
  });

  it('marks the chosen value with a check and picks one on a press', async () => {
    const onPick = vi.fn();
    render(<Listbox id="mics" label="Microphone" options={OPTIONS} selectedId="alice" onPick={onPick} />);
    const [alice, rabbit] = screen.getAllByRole('option');
    expect(alice.getAttribute('aria-selected')).toBe('true');
    expect(alice.querySelector('svg[data-icon="check"]')).not.toBeNull();
    expect(rabbit.querySelector('svg[data-icon="check"]')).toBeNull();
    await userEvent.click(rabbit);
    expect(onPick).toHaveBeenCalledWith('rabbit');
  });

  it('shows the empty message instead of an empty listbox, and keeps the footer outside the listbox role', () => {
    render(<Listbox id="matches" label="Matching entries" options={[]} onPick={vi.fn()} empty="No matches." footer={<button>Add alias</button>} />);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByText('No matches.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add alias' }).closest('[role="listbox"]')).toBeNull();
  });
});
