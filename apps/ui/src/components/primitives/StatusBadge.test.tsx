// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Badge, Dot, StatusBadge, badgeClass, type StatusTone } from './StatusBadge';

afterEach(cleanup);

// Every tone Q6 recommends (studio-ui-primitives.prd.md), each with its own fill/text pair. Colour resolution (light,
// dark and booth) is the atlas's job (StatusBadge.stories.tsx) and paletteContrast.test.ts's; this test only pins which
// token each tone reaches for, so a future edit that silently drops a tone or repoints one fails here first.
const TONE_TOKENS: Record<StatusTone, { fill: string; text: string; line: string }> = {
  neutral: { fill: 'var(--surface-2)', text: 'var(--text-muted)', line: 'var(--border)' },
  info: { fill: 'var(--info-soft)', text: 'var(--info-text)', line: 'var(--info)' },
  progress: { fill: 'var(--accent-soft)', text: 'var(--accent-strong)', line: 'var(--accent)' },
  accent: { fill: 'var(--accent-soft)', text: 'var(--accent-strong)', line: 'var(--accent)' },
  success: { fill: 'var(--ok-soft)', text: 'var(--ok-text)', line: 'var(--ok)' },
  warning: { fill: 'var(--warn-soft)', text: 'var(--warn-text)', line: 'var(--warn)' },
  danger: { fill: 'var(--danger-soft)', text: 'var(--danger-text)', line: 'var(--danger)' },
  org: { fill: 'var(--org-soft)', text: 'var(--org-text)', line: 'var(--org)' },
  experimental: { fill: 'var(--badge-experimental-fill)', text: 'var(--experimental-text)', line: 'var(--experimental)' },
};

describe('StatusBadge', () => {
  describe.each(Object.entries(TONE_TOKENS))('tone=%s', (tone, { fill, text, line }) => {
    it("draws the chip in its tone's fill and text tokens", () => {
      render(<StatusBadge tone={tone as StatusTone} label="On track" />);
      const chip = screen.getByText('On track');
      expect(chip.style.background).toBe(fill);
      expect(chip.style.color).toBe(text);
    });

    it("draws the outline look hollow, in the tone's line and text", () => {
      render(<StatusBadge tone={tone as StatusTone} label="Changed" look="outline" />);
      const chip = screen.getByText('Changed');
      expect(chip.style.background).toBe('transparent');
      expect(chip.style.borderColor).toBe(line);
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

  // ADR 0600: the three shapes the benchmark mocks draw. jsdom has no layout, so the sizes are pinned by class here and
  // measured by the atlas (StatusBadge.stories.tsx's MeasuredShapes).
  it("is a 22 px, fully rounded pill in the label's own case by default", () => {
    render(<StatusBadge tone="danger" label="Pickup" />);
    const chip = screen.getByText('Pickup');
    expect(chip.className).toContain('min-h-[1.375rem]');
    expect(chip.className).toContain('rounded-full');
    expect(chip.className).not.toContain('uppercase');
  });

  it('draws the tag shape at 16 px, on the tag radius, in capitals', () => {
    render(<StatusBadge tone="danger" label="Misread" shape="tag" />);
    const tag = screen.getByText('Misread');
    expect(tag.className).toContain('min-h-4');
    expect(tag.className).toContain('rounded-[var(--radius-tag)]');
    expect(tag.className).toContain('uppercase');
  });

  // ADR 0645: the Production board's cell (mock 01), a fixed-width 20 px block on the tag radius, its label centred.
  it("draws the board cell at 20 px and at least 58 px wide, centred, on the tag radius, in the label's own case", () => {
    render(<StatusBadge tone="danger" label="3 open" shape="cell" />);
    const cell = screen.getByText('3 open');
    expect(cell.className).toContain('h-5');
    expect(cell.className).toContain('min-w-[3.625rem]');
    expect(cell.className).toContain('justify-center');
    expect(cell.className).toContain('rounded-[var(--radius-tag)]');
    expect(cell.className).not.toContain('uppercase');
  });

  it('draws the booth tag at 26 px', () => {
    expect(badgeClass('booth')).toContain('min-h-[1.625rem]');
  });

  it('is a button when it opens something, and says so by role', async () => {
    const open = vi.fn();
    render(<StatusBadge tone="accent" label="2 chapters have a suggestion" onClick={open} />);
    await userEvent.click(screen.getByRole('button', { name: '2 chapters have a suggestion' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('is not a button without an onClick', () => {
    render(<StatusBadge tone="neutral" label="Muted" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Badge', () => {
  it("draws a caller's own colours (an entity kind) in THE badge's shape", () => {
    render(<Badge label="Place" colors={{ fill: 'var(--place-soft)', text: 'var(--place-text)', line: 'var(--place)' }} />);
    const badge = screen.getByText('Place');
    expect(badge.style.background).toBe('var(--place-soft)');
    expect(badge.className).toBe(badgeClass('pill'));
  });
});

describe('Dot', () => {
  it('is decoration without a label', () => {
    const { container } = render(<Dot color="var(--character)" />);
    const dot = container.firstElementChild as HTMLElement;
    expect(dot.getAttribute('aria-hidden')).toBe('true');
    expect(dot.style.background).toBe('var(--character)');
  });

  it('is a named mark with a label', () => {
    render(<Dot color="var(--ok)" label="Linked" />);
    expect(screen.getByRole('img', { name: 'Linked' })).toBeTruthy();
  });
});
