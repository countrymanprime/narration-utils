import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { StatusBadge, type StatusTone } from './StatusBadge';

const meta = {
  title: 'Primitives/StatusBadge',
  component: StatusBadge,
  args: { tone: 'info', label: 'REAPER linked · following Ch 7' },
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

// One story per tone (studio-ui-primitives.prd.md Q6): a closed set of meanings, not one tone per stage name.
export const Neutral: Story = { args: { tone: 'neutral', label: 'Not started' } };
export const Info: Story = {};
export const Progress: Story = { args: { tone: 'progress', label: '41%' } };
export const Success: Story = { args: { tone: 'success', label: 'PASS' } };
export const Warning: Story = { args: { tone: 'warning', label: '3 open' } };
export const Danger: Story = { args: { tone: 'danger', label: 'FLOOR' } };
export const Experimental: Story = { args: { tone: 'experimental', label: 'Experimental' } };

export const WithIcon: Story = {
  args: {
    tone: 'danger',
    label: 'REC · P&R',
    icon: <span aria-hidden="true">●</span>,
  },
};

// The dense-list mark (PRD "Could"): no visible text, named for a screen reader.
export const Dot: Story = { args: { tone: 'success', label: 'This chapter: pass', variant: 'dot' } };

export const AllTonesAsDots: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'experimental'] as StatusTone[]).map((tone) => (
        <StatusBadge key={tone} tone={tone} label={tone} variant="dot" />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const tone of ['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'experimental']) {
      await expect(canvas.getByRole('img', { name: tone })).toBeVisible();
    }
  },
};

// FocusShell's booth surface (Q1): the booth block overrides only the surface/text tokens, so a badge's own fill and
// text tokens fall through unchanged from dark - this story is the record that they still hold up inside it.
export const Booth: Story = {
  render: () => (
    <div data-surface="booth" className="flex flex-col items-start gap-2 p-4">
      {(['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'experimental'] as StatusTone[]).map((tone) => (
        <StatusBadge key={tone} tone={tone} label={tone} />
      ))}
    </div>
  ),
};

export const AnnouncesItsLabel: Story = {
  args: { tone: 'progress', label: 'Delivery check 7 / 12' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Delivery check 7 / 12')).toBeVisible();
  },
};
