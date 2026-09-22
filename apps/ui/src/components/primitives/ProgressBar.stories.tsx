import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { ProgressBar } from './ProgressBar';

const meta = {
  title: 'Primitives/ProgressBar',
  component: ProgressBar,
  args: { label: 'Download progress', value: 40, running: true },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProgressBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// A determinate bar announces its value.
export const Determinate: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('progressbar', { name: 'Download progress' })).toHaveAttribute('aria-valuenow', '40');
  },
};

// The bytes a download has moved are the value text: a screen reader hears them in place of the bare percentage.
export const WithValueText: Story = {
  args: { valueText: '44 of 109 MB' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('progressbar')).toHaveAttribute('aria-valuetext', '44 of 109 MB');
  },
};

// Nothing measured yet: no value is announced and the fill slides (it stands still for people who asked for reduced motion).
export const Indeterminate: Story = {
  args: { value: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  },
};

// A job that has begun shows at least a sliver, so 1 percent is visible.
export const JustBegun: Story = { args: { value: 1 } };

export const Done: Story = { args: { value: 100, running: false } };
