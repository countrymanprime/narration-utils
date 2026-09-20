// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { NavDrawer } from './NavDrawer';

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <main tabIndex={-1}>
        <button aria-label="Open navigation" onClick={() => setOpen(true)}>
          Menu
        </button>
        <button>Page content</button>
      </main>
      <NavDrawer open={open} onClose={() => setOpen(false)}>
        <nav>
          <button onClick={() => setOpen(false)}>Home</button>
          <button>Manuscript</button>
        </nav>
      </NavDrawer>
    </div>
  );
}

describe('NavDrawer', () => {
  it('is a named navigation dialog only while open', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(drawer.querySelector('nav')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Page content' })).toBeNull();
  });

  it('closes on Escape, on the Close button and on the scrim, and returns focus to the menu button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open navigation' });
    await user.click(opener);
    await screen.findByRole('dialog', { name: 'Navigation' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));

    await user.click(opener);
    await user.click(await screen.findByRole('button', { name: 'Close navigation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(opener);
    await screen.findByRole('dialog', { name: 'Navigation' });
    await user.click(document.querySelector('[data-nav-drawer-backdrop]') as HTMLElement);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes when a destination is chosen', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    await user.click(await screen.findByRole('button', { name: 'Home' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
