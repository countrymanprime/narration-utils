import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { IconButton } from './IconButton';
import { Listbox } from './Listbox';

// A list of choices on the popover surface: the popup of a combobox (the Story Bible alias box), with the active row on
// --surface-2 and a chosen value marked by an --accent check (read-aloud-control-bar/03's device list).
const OPTIONS = [
  { id: 'mv7', label: 'Shure MV7 (USB Audio)' },
  { id: 'array', label: 'Microphone Array (Realtek(R) Audio)' },
  { id: 'jabra', label: 'Headset Microphone (Jabra Evolve2 65)' },
];

const meta = {
  title: 'Primitives/Listbox',
  component: Listbox,
  args: { id: 'story-listbox', label: 'Microphone', options: OPTIONS, onPick: fn() },
  render: (args) => (
    <div className="max-w-[22rem] p-2">
      <Listbox {...args} />
    </div>
  ),
} satisfies Meta<typeof Listbox>;

export default meta;
type Story = StoryObj<typeof meta>;

// The chosen device carries the check, and the row the keyboard is on is highlighted.
export const Chosen: Story = {
  args: { selectedId: 'mv7', activeIndex: 0 },
  play: async ({ canvasElement, args }) => {
    const list = within(canvasElement).getByRole('listbox', { name: 'Microphone' });
    const options = within(list).getAllByRole('option');
    await expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(options[1]);
    await expect(args.onPick).toHaveBeenCalledWith('array');
  },
};

// A combobox's matches, with a second line and a footer of actions outside the listbox role.
export const Matches: Story = {
  args: {
    label: 'Matching Story Bible entries',
    options: [
      { id: 'alice', label: 'Alice', description: 'Character · 41 occurrences' },
      { id: 'rabbit', label: 'White Rabbit', description: 'Character · 9 occurrences' },
    ],
    activeIndex: 1,
    footer: (
      <div className="flex justify-end p-2">
        <IconButton label="Add alias">+</IconButton>
      </div>
    ),
  },
};

// Nothing matches: the message stands in for an empty listbox.
export const Empty: Story = { args: { options: [], empty: 'No matching Story Bible entries.' } };
