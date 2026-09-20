// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { danglingAriaReferences } from './ariaReferences';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from './Collapsible';

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger label={open ? 'Hide per-chapter breakdown' : 'Show per-chapter breakdown'}>v</CollapsibleTrigger>
      <CollapsiblePanel>
        <p>Chapter 1</p>
      </CollapsiblePanel>
    </Collapsible>
  );
}

describe('Collapsible', () => {
  it('is a disclosure: collapsed, its panel is not in the page and its button says so', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Show per-chapter breakdown' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Chapter 1')).toBeNull();
  });

  it('opens and closes on click and on Enter, and the button names what it controls', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Show per-chapter breakdown' }));
    const button = screen.getByRole('button', { name: 'Hide per-chapter breakdown' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Chapter 1')).toBeTruthy();
    expect(danglingAriaReferences()).toEqual([]);
    await user.keyboard('{Enter}');
    expect(screen.queryByText('Chapter 1')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show per-chapter breakdown' }).getAttribute('aria-expanded')).toBe('false');
  });
});
