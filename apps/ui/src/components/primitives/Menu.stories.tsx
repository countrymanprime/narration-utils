import type { Meta, StoryObj } from '@storybook/react-vite';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { faRotate } from '@fortawesome/free-solid-svg-icons';
import { Menu, type MenuItem } from './Menu';
import { IconButton } from './IconButton';
import { screen } from './portalScreen';

const dot = (color: string) => <span className="size-2 flex-none rounded-full" style={{ background: color }} />;
const items = (onSelect: () => void): MenuItem[] => [
  { key: 'character', label: 'Character', leading: dot('var(--character)'), onSelect },
  { key: 'place', label: 'Location', leading: dot('var(--place)'), onSelect: () => undefined },
  { key: 'org', label: 'Organization', leading: dot('var(--org)'), onSelect: () => undefined },
];

const meta = {
  title: 'Primitives/Menu',
  component: Menu,
  args: {
    items: items(fn()),
    triggerClassName: 'inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs',
    children: (
      <>
        Character <FontAwesomeIcon icon={faChevronDown} />
      </>
    ),
  },
  render: (args) => (
    <div className="p-2">
      <Menu {...args} />
    </div>
  ),
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Disabled: Story = { args: { disabled: true } };

// An icon-only trigger renders as an IconButton instead of pasting its look (the Story Bible Replace-pronunciation control).
export const IconOnlyTrigger: Story = {
  args: { render: <IconButton label="Replace pronunciation" />, children: <FontAwesomeIcon icon={faRotate} /> },
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: 'Replace pronunciation' });
    await userEvent.click(trigger);
    await expect(await screen.findAllByRole('menuitem')).toHaveLength(3);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  },
};

// A press opens the menu; the button reports it (aria-haspopup, aria-expanded) and the items are menuitems.
export const OpensOnPress: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: /Character/ });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(trigger);
    await expect(await screen.findAllByRole('menuitem')).toHaveLength(3);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // Close it so the story ends with nothing open (axe runs after play).
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
  },
};

// Arrow keys move, Enter chooses, the menu closes and focus returns to the button.
export const KeyboardChoosesAnItem: Story = {
  args: (() => {
    const onSelect = fn();
    return { items: items(onSelect) };
  })(),
  play: async ({ args, canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: /Character/ });
    trigger.focus();
    await userEvent.keyboard('{ArrowDown}');
    await screen.findAllByRole('menuitem');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Character' })).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await expect(args.items[0].onSelect).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('menuitem')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
