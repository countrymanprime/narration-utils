import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Pill } from './Pill';

const meta = {
  title: 'Primitives/Pill',
  component: Pill,
  args: { label: '10m', active: false, onClick: fn() },
} satisfies Meta<typeof Pill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inactive: Story = {};
// The selected pill: accent fill, so its label must use the contrast colour.
export const Active: Story = { args: { active: true } };
export const Disabled: Story = { args: { disabled: true } };
export const WithTooltip: Story = { args: { title: 'Jump ten minutes ahead' } };

export const ClickSelects: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '10m' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};
