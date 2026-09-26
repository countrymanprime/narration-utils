// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge, type StatusTone } from './StatusBadge';

afterEach(cleanup);

// Every tone Q6 recommends (studio-ui-primitives.prd.md), each with its own fill/text pair. Colour resolution (light,
// dark and booth) is the atlas's job (StatusBadge.stories.tsx) and paletteContrast.test.ts's; this test only pins which
// token each tone reaches for, so a future edit that silently drops a tone or repoints one fails here first.
const TONE_TOKENS: Record<StatusTone, { fill: string; text: string }> = {
  neutral: { fill: 'var(--surface-2)', text: 'var(--text-muted)' },
  info: { fill: 'var(--badge-info-fill)', text: 'var(--info-text)' },
  progress: { fill: 'var(--accent-soft)', text: 'var(--accent-strong)' },
  success: { fill: 'var(--badge-ok-fill)', text: 'var(--ok-text)' },
  warning: { fill: 'var(--badge-warn-fill)', text: 'var(--warn-text)' },
  danger: { fill: 'var(--badge-danger-fill)', text: 'var(--danger-text)' },
  experimental: { fill: 'var(--badge-experimental-fill)', text: 'var(--experimental-text)' },
};

describe('StatusBadge', () => {
  describe.each(Object.entries(TONE_TOKENS))('tone=%s', (tone, { fill, text }) => {
    it("draws the chip in its tone's fill and text tokens", () => {
      render(<StatusBadge tone={tone as StatusTone} label="On track" />);
      const chip = screen.getByText('On track');
      expect(chip.style.background).toBe(fill);
      expect(chip.style.color).toBe(text);
    });

    it("draws the dot in the tone's text token, named for a screen reader, with no visible text", () => {
      render(<StatusBadge tone={tone as StatusTone} label="On track" variant="dot" />);
      const dot = screen.getByRole('img', { name: 'On track' });
      expect(dot.style.background).toBe(text);
      expect(dot.textContent).toBe('');
    });
  });

  it('defaults to the chip variant', () => {
    render(<StatusBadge tone="neutral" label="Not started" />);
    expect(screen.getByText('Not started')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders an optional icon as decorative, alongside the label', () => {
    render(<StatusBadge tone="danger" label="REC · P&R" icon={<svg data-testid="badge-icon" />} />);
    const chip = screen.getByText('REC · P&R', { exact: false });
    const icon = screen.getByTestId('badge-icon');
    expect(icon.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(chip).toBeTruthy();
  });

  it('the dot variant ignores an icon: no room for one in a dense list', () => {
    render(<StatusBadge tone="success" label="Pickup" icon={<svg data-testid="badge-icon" />} variant="dot" />);
    expect(screen.queryByTestId('badge-icon')).toBeNull();
  });
});
