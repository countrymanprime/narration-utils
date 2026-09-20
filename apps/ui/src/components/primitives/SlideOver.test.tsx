// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlideOver } from './SlideOver';
import { tabInsideTrap } from './tabInsideTrap';

afterEach(cleanup);

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <main tabIndex={-1}>
        <button onClick={() => setOpen(true)}>Open panel</button>
        <button>Behind the panel</button>
      </main>
      <SlideOver
        open={open}
        title="Entry details"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <p>Alice is the protagonist.</p>
        <button>Inside the panel</button>
      </SlideOver>
    </div>
  );
}

async function openPanel(onClose?: () => void) {
  const user = userEvent.setup();
  render(<Harness onClose={onClose} />);
  await user.click(screen.getByRole('button', { name: 'Open panel' }));
  return { user, panel: await screen.findByRole('dialog', { name: 'Entry details' }) };
}

describe('SlideOver is a real modal panel', () => {
  it('renders nothing while closed and a named dialog while open', async () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[data-slide-over]')).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open panel' }));
    const panel = await screen.findByRole('dialog', { name: 'Entry details' });
    expect(panel.hasAttribute('data-slide-over')).toBe(true);
    expect(within(panel).getByRole('heading', { name: 'Entry details' })).toBeTruthy();
  });

  it('hides the page behind it while open', async () => {
    await openPanel();
    expect(screen.queryByRole('button', { name: 'Behind the panel' })).toBeNull();
  });

  it('closes on Escape and gives focus back to the opener', async () => {
    const onClose = vi.fn();
    const { user } = await openPanel(onClose);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open panel' })));
  });

  it('sends focus into <main> when the opener is gone by the time it closes', async () => {
    function GoneOpener() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <main tabIndex={-1}>
            {!open && <button onClick={() => setOpen(true)}>Open panel</button>}
            <button>Other control</button>
          </main>
          <SlideOver open={open} title="Entry details" onClose={() => setOpen(false)}>
            <p>Body</p>
          </SlideOver>
        </div>
      );
    }
    const user = userEvent.setup();
    render(<GoneOpener />);
    await user.click(screen.getByRole('button', { name: 'Open panel' }));
    await screen.findByRole('dialog', { name: 'Entry details' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.querySelector('main')?.contains(document.activeElement)).toBe(true));
  });

  it('closes on its Close button, with the label a caller chose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideOver open title="Entry" closeLabel="Close review panel" onClose={onClose}>
        <p>Body</p>
      </SlideOver>,
    );
    await user.click(await screen.findByRole('button', { name: 'Close review panel' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the click-away backdrop is pressed', async () => {
    const onClose = vi.fn();
    const { user } = await openPanel(onClose);
    await user.click(document.querySelector('[data-slide-over-backdrop]') as HTMLElement);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('keeps Tab inside the panel', async () => {
    const { user } = await openPanel();
    const behind = screen.getByRole('button', { name: 'Behind the panel', hidden: true });
    for (let press = 0; press < 8; press += 1) {
      const focused = await tabInsideTrap(user);
      expect(focused, `press ${press}`).not.toBe(behind);
    }
  });
});
