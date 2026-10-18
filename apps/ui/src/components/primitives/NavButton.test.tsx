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

  // The palette guard reads tokens, not component source, so the colour decision of docs/design/colour-and-contrast.md is pinned here: the current
  // page is mock 01's --accent-soft fill, and its label --accent-strong, the pair paletteContrast.test.ts checks.
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

  // Mock 01's item: 34 px on the rail's 37 px pitch, Barlow Condensed 13 px tracked 0.11 em, radius 7.
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

  describe('off (aria-disabled)', () => {
    const REASON = 'Import a manuscript to unlock this page.';
    const renderOff = (props: { active?: boolean; iconOnly?: boolean; onClick?: () => void } = {}) =>
      render(
        <TooltipProvider>
          <NavButton
            active={props.active ?? false}
            icon={faHouse}
            onClick={props.onClick ?? (() => {})}
            iconOnly={props.iconOnly}
            disabled
            disabledReason={REASON}
          >
            Proof
          </NavButton>
        </TooltipProvider>,
      );

    it('is a real, focusable button that keeps its own name and carries the reason as its description', () => {
      renderOff();
      const button = screen.getByRole('button', { name: 'Proof' });
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect((button as HTMLButtonElement).disabled).toBe(false);
      button.focus();
      expect(document.activeElement).toBe(button);
      expect(button.getAttribute('aria-describedby')).toBeTruthy();
      expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(REASON);
    });

    it('is not wrapped in a second tab stop that renames it to the reason', () => {
      const { container } = renderOff();
      expect(container.querySelector('[role="group"]')).toBeNull();
      expect(container.querySelectorAll('span[tabindex]').length).toBe(0);
      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('never runs its click; a press opens a note with the reason', () => {
      const onClick = vi.fn();
      renderOff({ onClick });
      fireEvent.click(screen.getByRole('button', { name: 'Proof' }));
      expect(onClick).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog', { name: 'Proof is unavailable' }).textContent).toContain(REASON);
    });

    it('opens the same note from the keyboard', () => {
      renderOff();
      const button = screen.getByRole('button', { name: 'Proof' });
      button.focus();
      fireEvent.keyDown(button, { key: 'Enter' });
      fireEvent.click(button);
      expect(screen.getByRole('dialog', { name: 'Proof is unavailable' })).toBeTruthy();
    });

    it('shows the reason as a hint on keyboard focus', () => {
      vi.useFakeTimers();
      renderOff();
      fireEvent.focus(screen.getByRole('button', { name: 'Proof' }));
      expect(screen.getByRole('tooltip').textContent).toBe(REASON);
    });

    it('stays the current page when it is also off, and keeps the muted look otherwise', () => {
      renderOff({ active: true });
      const current = screen.getByRole('button', { name: 'Proof' });
      expect(current.getAttribute('aria-current')).toBe('page');
      expect(current.className).toContain('bg-[var(--accent-soft)]');
    });

    it('is drawn in --text-muted at full strength: an off item keeps AA contrast because it can take focus', () => {
      renderOff();
      const className = screen.getByRole('button', { name: 'Proof' }).className;
      expect(className).toContain('text-[var(--text-muted)]');
      expect(className).not.toMatch(/opacity-\[0\.4/);
    });

    it('draws a lock, hidden from assistive technology, at its end', () => {
      renderOff();
      const lock = screen.getByRole('button', { name: 'Proof' }).querySelector('[data-nav-lock]');
      expect(lock?.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps its name when icon-only', () => {
      renderOff({ iconOnly: true });
      expect(screen.getByRole('button', { name: 'Proof' }).getAttribute('aria-disabled')).toBe('true');
    });
  });
});
