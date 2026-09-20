import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Highlight, type HighlightKind } from './Highlight';

const KINDS: HighlightKind[] = ['Character', 'Place', 'Organization', 'Lore', 'Item', 'Event', 'Review', 'Note', 'Cursor'];

const meta = {
  title: 'Primitives/Highlight',
  component: Highlight,
  args: { kind: 'Character', children: 'Alice', onActivate: undefined },
  argTypes: { kind: { control: 'select', options: KINDS } },
} satisfies Meta<typeof Highlight>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Character: Story = { args: { kind: 'Character', children: 'Alice' } };
export const Place: Story = { args: { kind: 'Place', children: 'Wonderland' } };
export const Organization: Story = { args: { kind: 'Organization', children: 'the Queen’s court' } };
export const Lore: Story = { args: { kind: 'Lore', children: 'the rabbit hole' } };
export const Item: Story = { args: { kind: 'Item', children: 'the golden key' } };
export const Event: Story = { args: { kind: 'Event', children: 'the tea party' } };
export const Review: Story = { args: { kind: 'Review', children: 'Cheshire' } };
export const Note: Story = { args: { kind: 'Note', children: 'a note anchored to this sentence' } };
// The Teleprompter's current word: a solid accent fill (not a tint) that reads as a position marker.
export const Cursor: Story = { args: { kind: 'Cursor', children: 'beginning' } };

// The highlight sits inside running text: it must paint the whole line height and keep the
// text baseline, including where it wraps across lines (box-decoration-break: clone).
export const InRunningText: Story = {
  render: () => (
    <p className="max-w-xs text-sm leading-7">
      Down the rabbit hole went <Highlight kind="Character">Alice</Highlight>, never once considering how in the world she was to get out of{' '}
      <Highlight kind="Place">Wonderland</Highlight> again, a <Highlight kind="Note">note that wraps across two lines of text</Highlight>.
    </p>
  ),
};

export const Interactive: Story = { args: { kind: 'Character', children: 'Alice', onActivate: fn() } };

export const ClickActivates: Story = {
  args: { kind: 'Character', children: 'Alice', onActivate: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Alice' }));
    await expect(args.onActivate).toHaveBeenCalledOnce();
  },
};

export const KeyboardActivates: Story = {
  args: { kind: 'Place', children: 'Wonderland', onActivate: fn() },
  play: async ({ args, canvasElement }) => {
    const target = within(canvasElement).getByRole('button', { name: 'Wonderland' });
    target.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await expect(args.onActivate).toHaveBeenCalledTimes(2);
  },
};

// Without onActivate it is plain text with a tint, not a control.
export const StaticIsNotAButton: Story = {
  args: { kind: 'Item', children: 'the golden key', onActivate: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};
