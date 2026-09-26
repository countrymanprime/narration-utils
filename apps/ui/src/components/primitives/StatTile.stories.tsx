import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { StatTile } from './StatTile';

// One KPI figure: label, mono value, optional hint, unit and progress bar, tinted by tone.
const meta = {
  title: 'Primitives/StatTile',
  component: StatTile,
  args: { label: 'Text present', value: '84%', hint: '2,410 of 2,870 words' },
  decorators: [
    (Story) => (
      <div className="w-56">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Text present')).toBeVisible();
    await expect(canvas.getByText('84%')).toBeVisible();
    await expect(canvas.getByText('2,410 of 2,870 words')).toBeVisible();
  },
};

export const NoHint: Story = { args: { label: 'Paragraphs', value: '9 of 12', hint: undefined } };

export const WithUnit: Story = { args: { label: 'Pace', value: '118', unit: '/min', hint: undefined } };

export const WithProgress: Story = {
  args: { label: 'Finished audio', value: '6.2 of 9 h', hint: undefined, progress: 0.69 },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('progressbar', { name: 'Finished audio' });
    await expect(bar).toHaveAttribute('aria-valuenow', '69');
  },
};

export const Success: Story = { args: { label: 'Delivery check', value: '12 of 12', tone: 'success', hint: 'every platform passing' } };

export const Warning: Story = { args: { label: 'Open pickups', value: '3', tone: 'warning', hint: 'from the last check' } };

export const Danger: Story = { args: { label: 'Delivery check', value: '4 of 12', tone: 'danger', hint: 'below the floor' } };

export const Info: Story = { args: { label: 'REAPER linked', value: 'following Ch 7', tone: 'info', hint: undefined } };

export const Experimental: Story = { args: { label: 'Punch estimate', value: '~2 min', tone: 'experimental', hint: 'from an unreleased analyzer' } };

// Rate figures and pace read as single tight numbers; long labels and hints must not push the tile sideways.
export const LongLabelWraps: Story = {
  args: {
    label: 'Hours per finished hour of narration',
    value: '1.8',
    hint: 'across every chapter recorded so far, including retakes and asides',
  },
};
