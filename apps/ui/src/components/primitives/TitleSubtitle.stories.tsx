import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { TitleSubtitle } from './TitleSubtitle';

// TitleSubtitle draws a chapter's name one way everywhere it appears (chapter-title-display-consistency.prd.md): the
// title semibold, the subtitle muted and regular, both in source casing. `inline` is one text run; `stacked` puts the
// subtitle on its own line under the title.
const meta = {
  title: 'Primitives/TitleSubtitle',
  component: TitleSubtitle,
  args: { title: 'PROLOGUE', subtitle: 'The Last Good Applause' },
} satisfies Meta<typeof TitleSubtitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {};

export const InlineNoSubtitle: Story = { args: { subtitle: undefined } };

// Real books mix headings the author typed in capitals with title-case ones; the component keeps both as written.
export const SourceCaps: Story = { args: { title: 'PROLOGUE', subtitle: 'The Last Good Applause' } };

export const Stacked: Story = { args: { layout: 'stacked' } };

export const Truncated: Story = {
  args: { title: 'The complete unabridged production notes for the second volume of the salt road trilogy', subtitle: 'A working title that keeps changing' },
  render: (args) => (
    <div style={{ width: 220 }}>
      <TitleSubtitle {...args} truncate />
    </div>
  ),
};

// A `Button`'s label forces uppercase; TitleSubtitle must still read in source casing.
export const InsideUppercaseButton: Story = {
  render: (args) => (
    <button type="button" className="uppercase">
      <TitleSubtitle {...args} />
    </button>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('PROLOGUE').closest('.normal-case')).not.toBeNull();
  },
};

// The Manuscript header alignment case (ADR 0058's overflow precedent): a subtitle with no break opportunity, like a
// file name, must clip or wrap without pushing the layout sideways.
export const LongUnbrokenSubtitle: Story = {
  args: { title: 'Tracks', subtitle: 'The_Very_Long_Running_Series_Book_Three_The_Reckoning_chapter_twenty_seven_revised_v14_FINAL' },
  render: (args) => (
    <div style={{ width: 220 }}>
      <TitleSubtitle {...args} truncate />
    </div>
  ),
};

export const RendersBothParts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('PROLOGUE')).toBeVisible();
    await expect(canvas.getByText(/The Last Good Applause/)).toBeVisible();
  },
};
