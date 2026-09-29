import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { screen } from './portalScreen';

const items = (onSelect: () => void): ContextMenuItem[] => [
  { key: 'plugin', label: 'Add an effect to this passage…', onSelect },
  { key: 'chain', label: 'Put an FX chain on the chapter’s track…', onSelect: () => undefined },
];

const meta = {
  title: 'Primitives/ContextMenu',
  component: ContextMenu,
  args: {
    items: items(fn()),
    onOpen: fn(),
    children: (
      <p className="max-w-sm rounded border border-[var(--border)] p-3 text-sm">Alice was beginning to get very tired of sitting by her sister on the bank.</p>
    ),
  },
  render: (args) => (
    <div className="p-2">
      <ContextMenu {...args} />
    </div>
  ),
} satisfies Meta<typeof ContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

// An item that cannot run says why under its label, is read with that reason, and does nothing when pressed.
export const ItemUnavailable: Story = {
  args: {
    items: [
      { key: 'plugin', label: 'Add an effect to this passage…', onSelect: fn(), unavailable: 'REAPER is not connected. Open the app from REAPER.' },
      { key: 'chain', label: 'Put an FX chain on the chapter’s track…', onSelect: fn(), unavailable: 'REAPER is not connected. Open the app from REAPER.' },
    ],
  },
  play: async ({ canvasElement }) => {
    fireEvent.contextMenu(within(canvasElement).getByText(/Alice was beginning/));
    const entries = await screen.findAllByRole('menuitem');
    await expect(entries).toHaveLength(2);
    await expect(entries[0]).toHaveAttribute('aria-disabled', 'true');
    await expect(entries[0]).toHaveAccessibleDescription('REAPER is not connected. Open the app from REAPER.');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  },
};

// A right click tells the caller first (so it can choose what the menu acts on) and opens the menu.
export const OpensOnRightClick: Story = {
  play: async ({ args, canvasElement }) => {
    fireEvent.contextMenu(within(canvasElement).getByText(/Alice was beginning/));
    await expect(args.onOpen).toHaveBeenCalledOnce();
    await expect(await screen.findAllByRole('menuitem')).toHaveLength(2);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  },
};

// Arrow keys move, Enter chooses, the menu closes.
export const KeyboardChoosesAnItem: Story = {
  args: (() => {
    const onSelect = fn();
    return { items: items(onSelect) };
  })(),
  play: async ({ args, canvasElement }) => {
    fireEvent.contextMenu(within(canvasElement).getByText(/Alice was beginning/));
    await screen.findAllByRole('menuitem');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    await expect(args.items[0].onSelect).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  },
};

// Escape closes without choosing.
export const EscapeCloses: Story = {
  play: async ({ args, canvasElement }) => {
    fireEvent.contextMenu(within(canvasElement).getByText(/Alice was beginning/));
    await screen.findAllByRole('menuitem');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
    await expect(args.items[0].onSelect).not.toHaveBeenCalled();
  },
};
