// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
