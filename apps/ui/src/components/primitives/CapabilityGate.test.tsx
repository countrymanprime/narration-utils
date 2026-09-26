// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { CapabilityGate, type CapabilityEntry } from './CapabilityGate';
import { IconButton } from './IconButton';

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  cleanup();
});

const SUPPORTED: CapabilityEntry = { level: 'supported', available: true };
const EXPERIMENTAL_ON: CapabilityEntry = {
  level: 'experimental',
  available: true,
  message: 'Experimental: switched on in Settings',
};
const NOT_YET: CapabilityEntry = { level: 'not_yet_available', available: false, message: 'REAPER is not running' };
const UNSUPPORTED: CapabilityEntry = { level: 'unsupported', available: false };

describe('CapabilityGate', () => {
  it('renders a supported, available control unchanged', () => {
    render(
      <CapabilityGate capability={SUPPORTED}>
        <Button>Master all to spec</Button>
      </CapabilityGate>,
    );
    const button = screen.getByRole('button', { name: 'Master all to spec' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText('Experimental')).toBeNull();
  });

  it('renders an experimental, available control enabled with an Experimental badge and the message as its description', () => {
    render(
      <CapabilityGate capability={EXPERIMENTAL_ON}>
        <Button>Apply FX chain</Button>
      </CapabilityGate>,
    );
    const button = screen.getByRole('button', { name: 'Apply FX chain' });
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    expect(screen.getByText('Experimental')).toBeTruthy();
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe('Experimental: switched on in Settings');
  });

  it('renders no description when an experimental, available control has no message', () => {
    render(
      <CapabilityGate capability={{ level: 'experimental', available: true }}>
        <Button>Apply FX chain</Button>
      </CapabilityGate>,
    );
    const button = screen.getByRole('button', { name: 'Apply FX chain' });
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('gates an unavailable control as aria-disabled, still focusable, and the press never reaches the handler', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <CapabilityGate capability={NOT_YET}>
        <Button onClick={onClick}>Punch from here</Button>
      </CapabilityGate>,
    );
    const button = screen.getByRole('button', { name: 'Punch from here' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives the host message as both the description and the tooltip', async () => {
    const user = userEvent.setup();
    render(
      <CapabilityGate capability={NOT_YET}>
        <Button>Punch from here</Button>
      </CapabilityGate>,
    );
    const button = screen.getByRole('button', { name: 'Punch from here' });
    const describedBy = button.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toBe('REAPER is not running');
    await user.tab();
    expect(document.activeElement).toBe(button);
    expect((await screen.findByRole('tooltip')).textContent).toBe('REAPER is not running');
  });

  it('falls back to the control own name when the host gives no message, inventing no text of its own', () => {
    render(
      <CapabilityGate capability={UNSUPPORTED}>
        <IconButton label="Add take FX">x</IconButton>
      </CapabilityGate>,
    );
    const button = screen.getByRole('button', { name: 'Add take FX' });
    const describedBy = button.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy as string)?.textContent).toBe('Add take FX');
  });

  it('falls back to a text-only control own visible text when it has no label prop', () => {
    render(
      <CapabilityGate capability={UNSUPPORTED}>
        <Button>Build packages</Button>
      </CapabilityGate>,
    );
    const button = screen.getByRole('button', { name: 'Build packages' });
    const describedBy = button.getAttribute('aria-describedby');
    expect(document.getElementById(describedBy as string)?.textContent).toBe('Build packages');
  });

  it('hides an unsupported control when the caller opts to hide it', () => {
    render(
      <CapabilityGate capability={UNSUPPORTED} hideWhenUnsupported>
        <Button>Add take FX</Button>
      </CapabilityGate>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('never hides a not-yet-available control, even when hideWhenUnsupported is set', () => {
    render(
      <CapabilityGate capability={NOT_YET} hideWhenUnsupported>
        <Button>Punch from here</Button>
      </CapabilityGate>,
    );
    expect(screen.getByRole('button', { name: 'Punch from here' })).toBeTruthy();
  });

  it('leaves no dangling aria-describedby reference in either the gated or the experimental-badge case', () => {
    const { rerender } = render(
      <CapabilityGate capability={NOT_YET}>
        <Button>Punch from here</Button>
      </CapabilityGate>,
    );
    const button = screen.getByRole('button', { name: 'Punch from here' });
    expect(document.getElementById(button.getAttribute('aria-describedby') as string)).toBeTruthy();
    rerender(
      <CapabilityGate capability={EXPERIMENTAL_ON}>
        <Button>Punch from here</Button>
      </CapabilityGate>,
    );
    const enabled = screen.getByRole('button', { name: 'Punch from here' });
    expect(document.getElementById(enabled.getAttribute('aria-describedby') as string)).toBeTruthy();
  });
});
