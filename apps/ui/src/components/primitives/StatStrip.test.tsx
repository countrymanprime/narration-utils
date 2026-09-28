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

  it('draws one card with rules between tiles rather than a card per tile', () => {
    const { container } = render(<StatStrip items={ITEMS} />);
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('rounded-[var(--radius-card)]');
    expect(card.className).toContain('overflow-hidden');
    // Each tile draws only the rule on its left and top; the card clips the ones on its own edges.
    for (const li of container.querySelectorAll('li')) {
      expect(li.className).toContain('border-l');
      expect(li.className).toContain('border-t');
      expect(li.className).not.toContain('shadow');
      expect(li.className).not.toContain('rounded');
    }
  });

  // ADR 0645: the strip wraps into full rows as it narrows (every tile, half of them a row, two, one) instead of clipping.
  it('wraps into full rows by the width it has: all in a row, then half, then two, then one', () => {
    const six = Array.from({ length: 6 }, (_, index) => ({ key: `k${index}`, label: `Figure ${index}`, value: `${index}` }));
    const { container } = render(<StatStrip items={six} />);
    const list = container.querySelector('ul') as HTMLElement;
    expect(list.style.getPropertyValue('--strip-all')).toBe('6');
    expect(list.style.getPropertyValue('--strip-half')).toBe('3');
    expect(list.className).toContain('@min-[64rem]:[--strip-cols:var(--strip-all)]');
    expect(list.className).toContain('@min-[36rem]:[--strip-cols:var(--strip-half)]');
    expect(list.className).toContain('@min-[22rem]:[--strip-cols:2]');
  });
});
