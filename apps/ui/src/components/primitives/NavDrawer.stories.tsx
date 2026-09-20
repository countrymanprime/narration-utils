import type { Meta, StoryObj } from '@storybook/react-vite';
import { faFileLines, faHouse } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { NavButton } from './NavButton';
import { NavDrawer } from './NavDrawer';
import { screen } from './portalScreen';

const navigation = (
  <nav className="flex-1 p-2 pt-14">
    {/* No item is drawn active here: the active item's accent-on-tint contrast is a known palette debt (NavButton in a11y-debt.ts). */}
    <NavButton active={false} icon={faHouse} onClick={() => undefined}>
      Home
    </NavButton>
    <NavButton active={false} icon={faFileLines} onClick={() => undefined}>
      Manuscript
    </NavButton>
  </nav>
);

const meta = {
  title: 'Primitives/NavDrawer',
  component: NavDrawer,
  args: { open: true, onClose: fn(), children: navigation },
} satisfies Meta<typeof NavDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

// The narrow layout's navigation: a modal panel from the left, named "Navigation".
export const Open: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Navigation' })).toBeVisible();
  },
};

export const Closed: Story = {
  args: { open: false },
  play: async () => {
    await expect(screen.queryByRole('dialog')).toBeNull();
  },
};

export const CloseButtonInvokesOnClose: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Close navigation' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const EscapeInvokesOnClose: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Navigation' });
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const ScrimPressInvokesOnClose: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Navigation' });
    await userEvent.click(document.querySelector('[data-nav-drawer-backdrop]') as HTMLElement);
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

function WithMenuButton() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button aria-label="Open navigation" className="rounded border px-3 py-1 text-sm" onClick={() => setOpen(true)}>
        Menu
      </button>
      <NavDrawer open={open} onClose={() => setOpen(false)}>
        {navigation}
      </NavDrawer>
    </div>
  );
}

// Opened from the menu button, closed with Escape, focus returns to the menu button.
export const ReturnsFocusToTheMenuButton: Story = {
  render: () => <WithMenuButton />,
  play: async ({ canvasElement }) => {
    const opener = within(canvasElement).getByRole('button', { name: 'Open navigation' });
    await userEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Navigation' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  },
};
