// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { danglingAriaReferences } from './ariaReferences';
import { Disclosure } from './Disclosure';
import { Tooltip } from './Tooltip';

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  cleanup();
});

function Harness({ startOpen = false, onOpenChange = () => {} }: { startOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <Disclosure
      title="Reference material"
      summary="2 sections"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
      aside={<Tooltip label="About reference material" text="Excluded from audiobook totals." />}
    >
      <p>Glossary</p>
    </Disclosure>
  );
}

describe('Disclosure', () => {
  it('is one button named for its title and summary, and collapsed it holds nothing of its panel', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Reference material 2 sections' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Glossary')).toBeNull();
  });

  it('opens and closes on a press and on Enter, and reports each change', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: /^Reference material/ }));
    expect(screen.getByText('Glossary')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Reference material/ }).getAttribute('aria-expanded')).toBe('true');
    expect(danglingAriaReferences()).toEqual([]);
    await user.keyboard('{Enter}');
    expect(screen.queryByText('Glossary')).toBeNull();
    expect(onOpenChange.mock.calls.map(([open]) => open)).toEqual([true, false]);
  });

  it('is controlled: it shows the state it is given', () => {
    render(<Harness startOpen />);
    expect(screen.getByText('Glossary')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Reference material/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps its aside beside the button and not inside it, so a press on the aside does not toggle the panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /^Reference material/ });
    const info = screen.getByRole('button', { name: 'About reference material' });
    expect(trigger.contains(info)).toBe(false);
    await user.click(info);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('reaches the trigger and then the aside with Tab, in that order', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Reference material/ }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About reference material' }));
  });

  it('without a summary the button is named for the title alone', () => {
    render(
      <Disclosure title="Repairs" open={false} onOpenChange={() => {}}>
        <p>Text</p>
      </Disclosure>,
    );
    expect(screen.getByRole('button', { name: 'Repairs' })).toBeTruthy();
  });
});
