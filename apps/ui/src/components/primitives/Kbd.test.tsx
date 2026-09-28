// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Kbd } from './Kbd';

afterEach(cleanup);

describe('Kbd', () => {
  it('is an image named by its single key', () => {
    render(<Kbd keys={['R']} />);
    expect(screen.getByRole('img', { name: 'R' })).toBeTruthy();
  });

  it('is named by every key of a chord, joined by "+"', () => {
    render(<Kbd keys={['Ctrl', 'R']} />);
    const cap = screen.getByRole('img', { name: 'Ctrl + R' });
    expect(cap.getAttribute('aria-label')).toBe('Ctrl + R');
    expect(cap.textContent).toBe('Ctrl+R');
  });

  it('draws one <kbd> per key, in order', () => {
    render(<Kbd keys={['Ctrl', 'Shift', 'R']} />);
    const caps = screen.getAllByRole('img', { name: 'Ctrl + Shift + R' })[0].querySelectorAll('kbd');
    expect(Array.from(caps).map((cap) => cap.textContent)).toEqual(['Ctrl', 'Shift', 'R']);
  });

  it('uses the spoken label as the accessible name for a symbol key, instead of the glyph', () => {
    render(<Kbd keys={['Ctrl', '⌫']} label="Control plus Backspace" />);
    const cap = screen.getByRole('img', { name: 'Control plus Backspace' });
    expect(cap.getAttribute('aria-label')).toBe('Control plus Backspace');
    // The glyph is still what a sighted user sees; only the announced name changes.
    expect(cap.textContent).toBe('Ctrl+⌫');
  });

  it('never falls back to the raw glyph joined by "+" once a label is given', () => {
    render(<Kbd keys={['⌫']} label="Backspace" />);
    expect(screen.queryByRole('img', { name: '⌫' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Backspace' })).toBeTruthy();
  });

  it('draws the 18 px companion/settings cap by default', () => {
    render(<Kbd keys={['R']} />);
    const cap = screen.getByRole('img').querySelector('kbd');
    expect(cap?.className).toContain('h-[1.125rem]');
  });

  it('draws the 23 px booth cap when asked', () => {
    render(<Kbd keys={['R']} size="md" />);
    const cap = screen.getByRole('img').querySelector('kbd');
    expect(cap?.className).toContain('h-[1.4375rem]');
  });

  it('uses Plex Mono and a 2 px bottom edge deeper than its 1 px top/left/right border', () => {
    render(<Kbd keys={['R']} />);
    expect(screen.getByRole('img').className).toContain("font-['IBM_Plex_Mono',ui-monospace,monospace]");
    const cap = screen.getByRole('img').querySelector('kbd');
    expect(cap?.className).toContain('border-b-2');
    expect(cap?.className).toContain('border');
  });
});
