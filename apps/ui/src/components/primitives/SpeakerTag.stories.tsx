import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SpeakerTag } from './SpeakerTag';

const meta = {
  title: 'Primitives/SpeakerTag',
  component: SpeakerTag,
  args: { label: 'Alice', speakerId: undefined, onActivate: undefined },
} satisfies Meta<typeof SpeakerTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// Every speaker gets one of the seven declared colours (--speaker-1..--speaker-7, styles.css), deterministically by id.
export const ACast: Story = {
  render: () => (
    <div className="flex flex-wrap gap-1">
      <SpeakerTag label="NARR" speakerId="narrator" />
      <SpeakerTag label="ALICE" speakerId="alice" />
      <SpeakerTag label="QUEEN" speakerId="queen" />
      <SpeakerTag label="FIVE" speakerId="five" />
      <SpeakerTag label="SEVEN" speakerId="seven" />
      <SpeakerTag label="TWO" speakerId="two" />
      <SpeakerTag label="HATTER" speakerId="hatter" />
      <SpeakerTag label="MARCH HARE" speakerId="march-hare" />
      <SpeakerTag label="DORMOUSE" speakerId="dormouse" />
    </div>
  ),
};

// The Booth's tag beside the script (mock 03): the same tag at 26 px, radius 4 (ADR 0600).
export const BoothSize: Story = {
  args: { label: 'March Hare', speakerId: 'march-hare', size: 'booth' },
  play: async ({ canvasElement }) => {
    const { height } = within(canvasElement).getByText('March Hare').getBoundingClientRect();
    // Measured in the atlas's browser; jsdom (stories.test.tsx) lays nothing out.
    if (height > 0) await expect(height).toBeCloseTo(26, 0);
  },
};

// The Script's tag (mock 02): 16 px on the 3 px tag radius.
export const ScriptSize: Story = {
  args: { label: 'Queen', speakerId: 'queen' },
  play: async ({ canvasElement }) => {
    const { height } = within(canvasElement).getByText('Queen').getBoundingClientRect();
    // Measured in the atlas's browser; jsdom (stories.test.tsx) lays nothing out.
    if (height > 0) await expect(height).toBeCloseTo(16, 0);
  },
};

export const Interactive: Story = { args: { onActivate: fn() } };

export const ClickActivates: Story = {
  args: { onActivate: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Alice' }));
    await expect(args.onActivate).toHaveBeenCalledOnce();
  },
};

export const KeyboardActivates: Story = {
  args: { label: 'Hatter', onActivate: fn() },
  play: async ({ args, canvasElement }) => {
    const target = within(canvasElement).getByRole('button', { name: 'Hatter' });
    target.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await expect(args.onActivate).toHaveBeenCalledTimes(2);
  },
};

// Without onActivate it is plain text with a tint, not a control (matches Highlight's own StaticIsNotAButton story).
export const StaticIsNotAButton: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};
