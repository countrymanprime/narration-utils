import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { KeyHint } from './KeyHint';

const meta = {
  title: 'Primitives/KeyHint',
  component: KeyHint,
  args: { keys: ['Space'], action: 'Play' },
} satisfies Meta<typeof KeyHint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const BoothSize: Story = { args: { size: 'md' } };

export const SymbolWithSpokenLabel: Story = { args: { keys: ['⌫'], action: 'Erase', spokenLabel: 'Backspace' } };

// The booth's bottom command bar (mock 03): one KeyHint per action, in a row.
export const CommandBarRow: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      <KeyHint keys={['Space']} action="Play" size="md" />
      <KeyHint keys={['R']} action="Record" size="md" />
      <KeyHint keys={['⌫']} action="Erase" spokenLabel="Backspace" size="md" />
      <KeyHint keys={['F']} action="Full screen" size="md" />
      <KeyHint keys={['P']} action="Punch" size="md" />
    </div>
  ),
};

export const IsNamedByItsKeysAndShowsTheAction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('img', { name: 'Space' })).toBeVisible();
    await expect(canvas.getByText('Play')).toBeVisible();
  },
};

export const SpokenLabelOverridesTheCapsName: Story = {
  args: { keys: ['⌫'], action: 'Erase', spokenLabel: 'Backspace' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('img', { name: 'Backspace' })).toBeVisible();
    await expect(canvas.getByText('Erase')).toBeVisible();
  },
};
