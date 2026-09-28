// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pill } from './Pill';

afterEach(cleanup);

describe('Pill', () => {
  it('does not invoke a disabled constrained pill', () => {
    const select = vi.fn();
    render(<Pill label="10m" active={false} disabled onClick={select} />);
    fireEvent.click(screen.getByRole('button', { name: '10m' }));
    expect(select).not.toHaveBeenCalled();
  });

  it('invokes onClick for an enabled pill and marks the active one', () => {
    const select = vi.fn();
    render(<Pill label="1m" active onClick={select} />);
    const button = screen.getByRole('button', { name: '1m' });
    expect(button.className).toContain('active');
    fireEvent.click(button);
    expect(select).toHaveBeenCalledOnce();
  });

  it('announces whether it is the selected one, by role and pressed state', () => {
    render(
      <>
        <Pill label="small" active={false} />
        <Pill label="medium" active />
      </>,
    );
    expect(screen.getByRole('button', { name: 'small', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'medium', pressed: true })).toBeTruthy();
  });

  it('invokes onClick for the keyboard too, and again on the already selected pill', async () => {
    const select = vi.fn();
    const user = userEvent.setup();
    render(<Pill label="medium" active onClick={select} />);
    await user.tab();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(select).toHaveBeenCalledTimes(2);
  });

  // The segmented look (mock-fidelity-primitives-and-components.prd.md Phase 5) is still a pressed toggle underneath —
  // only ToggleGroup's container draws the border, so a segment carries none of its own.
  it('is still a pressed toggle in the segmented look, without its own border', () => {
    render(<Pill label="ACX" active look="segmented" />);
    const button = screen.getByRole('button', { name: 'ACX', pressed: true });
    expect(button.className).toContain('active');
    expect(button.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
  });
});
