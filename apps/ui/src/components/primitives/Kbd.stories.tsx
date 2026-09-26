import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Kbd } from './Kbd';

const meta = {
  title: 'Primitives/Kbd',
  component: Kbd,
  args: { keys: ['R'] },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleKey: Story = {};

export const Chord: Story = { args: { keys: ['Ctrl', 'R'] } };

export const ThreeKeyChord: Story = { args: { keys: ['Ctrl', 'Shift', 'R'] } };

// A symbol key needs a spoken name: read aloud, ⌫ alone is a stray character, not "Backspace".
export const SymbolWithSpokenLabel: Story = { args: { keys: ['⌫'], label: 'Backspace' } };

export const ChordWithSymbolAndSpokenLabel: Story = { args: { keys: ['Ctrl', '⌫'], label: 'Control plus Backspace' } };

// The booth toolbar's row (studio-ui-primitives.prd.md mock 03): Space, R, ⌫, F, P, and Esc to exit.
export const BoothToolbarRow: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Kbd keys={['Space']} />
      <Kbd keys={['R']} />
      <Kbd keys={['⌫']} label="Backspace" />
      <Kbd keys={['F']} />
      <Kbd keys={['P']} />
      <Kbd keys={['Esc']} label="Escape, exit booth" />
    </div>
  ),
};

export const IsNamedByItsKeys: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'R' })).toBeVisible();
  },
};

export const ChordIsNamedByEveryKey: Story = {
  args: { keys: ['Ctrl', 'R'] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: 'Ctrl + R' })).toBeVisible();
  },
};

export const SpokenLabelOverridesTheGlyphName: Story = {
  args: { keys: ['Ctrl', '⌫'], label: 'Control plus Backspace' },
  play: async ({ canvasElement }) => {
    const cap = within(canvasElement).getByRole('img', { name: 'Control plus Backspace' });
    await expect(cap).toBeVisible();
    await expect(cap.textContent).toBe('Ctrl+⌫');
  },
};
