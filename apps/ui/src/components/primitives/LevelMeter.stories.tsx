import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { LevelMeter } from './LevelMeter';

const meta = {
  title: 'Primitives/LevelMeter',
  component: LevelMeter,
  args: { label: 'Input level', peak: null, rms: -20 },
} satisfies Meta<typeof LevelMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Silence: Story = { args: { peak: null, rms: -58 } };

export const Speech: Story = { args: { peak: -14, rms: -24 } };

export const Hot: Story = { args: { peak: -5, rms: -6 } };

export const Clipped: Story = { args: { peak: 0, rms: -1 } };

export const NoReadingYet: Story = { args: { peak: null, rms: null } };

export const Decorative: Story = { args: { peak: -6, rms: -18, decorative: true, className: 'w-8' } };

export const BoothSize: Story = { args: { peak: -6, rms: -8, size: 'booth' } };

export const CompactSize: Story = { args: { peak: -14, rms: -24, size: 'compact' } };

export const CustomFloorAndCeiling: Story = { args: { peak: -12, rms: -18, floor: -80, ceiling: -10, label: 'Room level' } };

export const IsNamedAndReadsItsValue: Story = {
  play: async ({ canvasElement }) => {
    const meter = within(canvasElement).getByRole('meter', { name: 'Input level' });
    await expect(meter).toHaveAttribute('aria-valuetext', '-20 dBFS');
  },
};

export const SilentReadsAsSilent: Story = {
  args: { peak: null, rms: null },
  play: async ({ canvasElement }) => {
    const meter = within(canvasElement).getByRole('meter', { name: 'Input level' });
    await expect(meter).toHaveAttribute('aria-valuetext', 'silent');
  },
};
