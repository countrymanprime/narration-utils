// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Tooltip } from './Tooltip';

afterEach(cleanup);

describe('Tooltip', () => {
  it('renders tooltip text in the fixed portal on keyboard focus', () => {
    render(<Tooltip text="Helpful wireframe guidance" />);
    fireEvent.focus(screen.getByText('i'));
    expect(screen.getByRole('tooltip').textContent).toBe('Helpful wireframe guidance');
    expect(screen.getByRole('tooltip').id).toBe('tooltip-layer');
  });

  it('hides the tooltip again on blur', () => {
    render(<Tooltip text="Helpful wireframe guidance" />);
    const trigger = screen.getByText('i');
    fireEvent.focus(trigger);
    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('clears the tooltip on unmount instead of leaving it stuck (e.g. a click that navigates away)', () => {
    const { unmount } = render(<Tooltip text="Jump to script in Manuscript" />);
    fireEvent.mouseEnter(screen.getByText('i'));
    expect(screen.getByRole('tooltip').textContent).toBe('Jump to script in Manuscript');

    unmount();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
