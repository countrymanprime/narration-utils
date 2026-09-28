// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatStrip } from './StatStrip';

afterEach(cleanup);

const ITEMS = [
  { key: 'finished', label: 'Finished audio', value: '1:52 / 3:08', progress: 0.61 },
  { key: 'logged', label: 'Work time logged', value: '11:20' },
  { key: 'pickups', label: 'Open pickups', value: '9', tone: 'warning' as const },
];

describe('StatStrip', () => {
  it('renders one labelled list holding every tile', () => {
    render(<StatStrip items={ITEMS} />);
    const list = screen.getByRole('list', { name: 'Figures' });
    expect(list.children).toHaveLength(3);
    expect(screen.getByText('Finished audio')).toBeTruthy();
    expect(screen.getByText('Open pickups')).toBeTruthy();
  });

  it('takes a custom accessible label', () => {
    render(<StatStrip items={ITEMS} label="Production figures" />);
    expect(screen.getByRole('list', { name: 'Production figures' })).toBeTruthy();
  });

  it('passes each item straight through to a StatTile, tone and all', () => {
    render(<StatStrip items={ITEMS} />);
    expect(screen.getByText('9').style.color).toBe('var(--warn-text)');
  });

  it('draws one card with dividers between tiles rather than a card per tile', () => {
    const { container } = render(<StatStrip items={ITEMS} />);
    const list = container.querySelector('ul') as HTMLElement;
    expect(list.className).toContain('divide-y');
    expect(list.className).toContain('sm:divide-x');
    // No tile carries its own border or shadow; the strip alone is the card surface.
    for (const li of container.querySelectorAll('li')) {
      expect(li.className).not.toContain('border');
      expect(li.className).not.toContain('shadow');
    }
  });
});
