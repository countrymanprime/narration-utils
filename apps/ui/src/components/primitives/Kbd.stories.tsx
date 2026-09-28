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

// The companion and Settings size (mock 07, input-commands-and-pedals): 18 px, the default.
export const CompanionSize: Story = { args: { keys: ['R'], size: 'sm' } };

// The booth command bar's size (mock 03): 23 px.
export const BoothSize: Story = { args: { keys: ['R'], size: 'md' } };

// The booth toolbar's row (mock-fidelity-primitives-and-components.prd.md Phase 10, mock 03): Space, R, ⌫, F, P, and Esc to exit.
export const BoothToolbarRow: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Kbd keys={['Space']} size="md" />
      <Kbd keys={['R']} size="md" />
      <Kbd keys={['⌫']} label="Backspace" size="md" />
      <Kbd keys={['F']} size="md" />
      <Kbd keys={['P']} size="md" />
      <Kbd keys={['Esc']} label="Escape, exit booth" size="md" />
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
