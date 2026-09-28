import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { StatStrip } from './StatStrip';

// The benchmark's one-card KPI strip (mock B01): six StatTiles divided by a rule instead of six separate cards.
const meta = {
  title: 'Primitives/StatStrip',
  component: StatStrip,
  args: {
    items: [
      { key: 'finished', label: 'Finished audio', value: '1:52 / 3:08', progress: 0.61 },
      { key: 'logged', label: 'Work time logged', value: '11:20', hint: 'record 5:40 · edit 3:55 · proof 1:45' },
      { key: 'pfh', label: 'Hours per finished hr', value: '6.1', unit: ': 1', hint: 'your last 5 books avg 6.4' },
      { key: 'rate', label: 'Effective rate', value: '$37', unit: '/hr', hint: 'at $225 PFH' },
      { key: 'pickups', label: 'Open pickups', value: '9', tone: 'warning', hint: '≈ 6 min booth time' },
      { key: 'delivery', label: 'Delivery check', value: '7', unit: '/ 12', hint: 'pass ACX · 1 fail · 4 pending', tone: 'danger' },
    ],
  },
} satisfies Meta<typeof StatStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('list', { name: 'Figures' })).toBeVisible();
    await expect(canvas.getByText('Finished audio')).toBeVisible();
    await expect(canvas.getByText('Open pickups')).toBeVisible();
  },
};

export const ThreeTiles: Story = {
  args: {
    items: [
      { key: 'recorded', label: 'Recorded', value: '97%' },
      { key: 'length', label: 'Length', value: '11:48' },
      { key: 'saved', label: 'Saved', value: '10:02', hint: 'current for the project' },
    ],
  },
};
