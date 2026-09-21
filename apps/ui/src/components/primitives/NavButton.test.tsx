// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { faHouse } from '@fortawesome/free-solid-svg-icons';
import { NavButton } from './NavButton';
import { TooltipProvider } from './Tooltip';

describe('NavButton', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // The palette guard reads tokens, not component source, so the colour decision of ADR 0059 is pinned here: --accent is
  // only 4.03:1 on the 10% accent tint of the current page in the light theme, --accent-strong is 5.67:1.
  it('draws the current page in --accent-strong on its tint and every other page in --text-muted', () => {
    render(
      <>
        <NavButton active icon={faHouse} onClick={() => {}}>
          Home
        </NavButton>
        <NavButton active={false} icon={faHouse} onClick={() => {}}>
          Proofing
        </NavButton>
      </>,
    );

    const current = screen.getByRole('button', { name: 'Home' });
    expect(current.className).toContain('text-[var(--accent-strong)]');
    expect(current.className).not.toContain('text-[var(--accent)]');
    expect(screen.getByRole('button', { name: 'Proofing' }).className).toContain('text-[var(--text-muted)]');
  });

  it('labels collapsed navigation and exposes its tooltip immediately on keyboard focus', () => {
    vi.useFakeTimers();
    render(
      <TooltipProvider>
        <NavButton active icon={faHouse} iconOnly onClick={() => {}}>
          Home
        </NavButton>
      </TooltipProvider>,
    );

    const button = screen.getByRole('button', { name: 'Home' });
    expect(button.getAttribute('aria-current')).toBe('page');
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip').textContent).toBe('Home');
  });
});
