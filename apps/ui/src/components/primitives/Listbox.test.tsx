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

  describe('group headings', () => {
    const GROUPED = [
      { id: 'a', label: 'Alpha', group: 'Script' },
      { id: 'b', label: 'Beta', group: 'Script' },
      { id: 'c', label: 'Gamma', group: 'Commands' },
    ];

    it('listbox-draws-a-heading-at-each-new-group: once per run, never between two options of one group', () => {
      render(<Listbox id="g" label="Hits" options={GROUPED} onPick={vi.fn()} />);
      const list = screen.getByRole('listbox');
      const kids = Array.from(list.children).map((el) => `${el.getAttribute('role')}:${el.textContent}`);
      expect(kids).toEqual(['presentation:Script', 'option:Alpha', 'option:Beta', 'presentation:Commands', 'option:Gamma']);
    });

    it('listbox-headings-do-not-break-the-combobox-contract: ids, active descendant and option indexes ignore headings', () => {
      render(<Listbox id="g" label="Hits" options={GROUPED} activeIndex={2} onPick={vi.fn()} />);
      const options = screen.getAllByRole('option');
      expect(options.map((o) => o.id)).toEqual(['a', 'b', 'c'].map((id) => listboxOptionId('g', id)));
      expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
      expect(screen.queryByRole('option', { name: 'Script' })).toBeNull();
    });

    it('listbox-without-groups-is-unchanged: no heading rows', () => {
      render(<Listbox id="g" label="Hits" options={OPTIONS} onPick={vi.fn()} />);
      expect(screen.getByRole('listbox').querySelectorAll('[role="presentation"]')).toHaveLength(0);
    });

    it('draws a trailing note at the right of the row', () => {
      render(<Listbox id="g" label="Hits" options={[{ id: 'a', label: 'Alpha', trailing: '3 ›' }]} onPick={vi.fn()} />);
      expect(within(screen.getByRole('option')).getByText('3 ›')).toBeTruthy();
    });
  });

  it('marks a disabled option aria-disabled and keeps it in the list', () => {
    render(
      <Listbox
        id="l"
        label="Pages"
        options={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B', disabled: true, description: 'Why' },
        ]}
        onPick={() => {}}
      />,
    );
    expect(screen.getByRole('option', { name: /^B/ }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('option', { name: /^A/ }).getAttribute('aria-disabled')).toBeNull();
  });
});
