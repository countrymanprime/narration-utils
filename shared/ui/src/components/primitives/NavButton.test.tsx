// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { faHouse } from '@fortawesome/free-solid-svg-icons';
import { NavButton } from './NavButton';
import { TooltipProvider } from './Tooltip';

describe('NavButton', () => {
  afterEach(() => vi.useRealTimers());

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
