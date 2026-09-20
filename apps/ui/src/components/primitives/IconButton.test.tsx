// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';
import { TooltipTarget } from './Tooltip';

afterEach(cleanup);

describe('IconButton', () => {
  it('is a button named by its label, and never submits a form by accident', () => {
    render(
      <form onSubmit={(event) => event.preventDefault()}>
        <IconButton label="Edit this entry">i</IconButton>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Edit this entry' });
    expect(button.getAttribute('type')).toBe('button');
  });

  it('reports a click and ignores one when disabled', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <IconButton label="Remove" onClick={onClick}>
        x
      </IconButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <IconButton label="Remove" onClick={onClick} disabled>
        x
      </IconButton>,
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('forwards the ref and standard attributes so a library part can render as it', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <IconButton label="Close" ref={ref} aria-expanded="false" data-probe="yes">
        x
      </IconButton>,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: 'Close' }));
    expect(ref.current?.getAttribute('aria-expanded')).toBe('false');
    expect(ref.current?.getAttribute('data-probe')).toBe('yes');
  });

  it('keeps the disabled reason reachable through a hint wrapper', () => {
    render(
      <TooltipTarget text="No manuscript source is available">
        <IconButton label="Jump to manuscript" disabled>
          x
        </IconButton>
      </TooltipTarget>,
    );
    // The wrapper becomes the tab stop and carries the reason, because a disabled button takes no focus.
    expect(screen.getByRole('group', { name: 'No manuscript source is available' })).toBeTruthy();
  });

  it('gives each variant its own look, exclusively', () => {
    render(
      <>
        <IconButton label="a">x</IconButton>
        <IconButton label="b" variant="primary">
          x
        </IconButton>
        <IconButton label="c" variant="danger">
          x
        </IconButton>
      </>,
    );
    expect(screen.getByRole('button', { name: 'a' }).className).toContain('text-[var(--text-muted)]');
    expect(screen.getByRole('button', { name: 'a' }).className).not.toContain('bg-[var(--accent)]');
    expect(screen.getByRole('button', { name: 'b' }).className).toContain('bg-[var(--accent)]');
    expect(screen.getByRole('button', { name: 'c' }).className).toContain('text-[var(--danger)]');
  });
});
