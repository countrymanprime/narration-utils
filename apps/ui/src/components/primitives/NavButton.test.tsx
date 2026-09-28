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

  // The palette guard reads tokens, not component source, so the colour decision of ADR 0059 is pinned here: the current
  // page is mock 01's --accent-soft fill (ADR 0635), and its label --accent-strong, the pair paletteContrast.test.ts checks.
  it('draws the current page in --accent-strong on --accent-soft and every other page in --text-muted', () => {
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
    expect(current.className).toContain('bg-[var(--accent-soft)]');
    expect(screen.getByRole('button', { name: 'Proofing' }).className).toContain('text-[var(--text-muted)]');
  });

  // Mock 01's item (ADR 0635): 34 px on the rail's 37 px pitch, Barlow Condensed 13 px tracked 0.11 em, radius 7.
  it('is the measured item', () => {
    render(
      <NavButton active={false} icon={faHouse} onClick={() => {}}>
        Production
      </NavButton>,
    );
    const item = screen.getByRole('button', { name: 'Production' });
    for (const token of ['h-[2.125rem]', 'text-[0.8125rem]', 'tracking-[0.11em]', 'rounded-[0.4375rem]']) expect(item.className).toContain(token);
  });

  it("draws a count at the item's end and says it in the name, and draws none for zero or none", () => {
    render(
      <>
        <NavButton active={false} icon={faHouse} onClick={() => {}} count={14}>
          Proof
        </NavButton>
        <NavButton active={false} icon={faHouse} onClick={() => {}} count={0}>
          Pickups
        </NavButton>
        <NavButton active={false} icon={faHouse} onClick={() => {}}>
          Script
        </NavButton>
      </>,
    );
    const proof = screen.getByRole('button', { name: 'Proof, 14' });
    expect(proof.textContent).toBe('Proof14');
    expect(screen.getByRole('button', { name: 'Pickups' }).textContent).toBe('Pickups');
    expect(screen.getByRole('button', { name: 'Script' }).getAttribute('aria-label')).toBeNull();
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
