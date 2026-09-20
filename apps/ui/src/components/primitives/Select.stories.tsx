import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Select } from './Select';

const STATUS_OPTIONS = [
  { value: 'not-started', label: 'Not started' },
  { value: 'recorded', label: 'Recorded' },
  { value: 'edited', label: 'Edited' },
  { value: 'finalized', label: 'Finalized' },
];

function ControlledSelect(props: ComponentProps<typeof Select>) {
  const [value, setValue] = useState(props.value);
  return (
    <div className="max-w-sm">
      <Select
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next);
          props.onChange(next);
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Primitives/Select',
  component: Select,
  args: { label: 'Chapter 1 status', value: 'not-started', options: STATUS_OPTIONS, onChange: fn() },
  render: (args) => <ControlledSelect {...args} />,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const FullWidth: Story = { args: { fullWidth: true } };
export const Disabled: Story = { args: { disabled: true, value: 'finalized' } };
export const WithPlaceholderOption: Story = {
  args: {
    label: 'Related entry',
    value: '',
    options: [
      { value: '', label: 'Choose entry…' },
      { value: 'hatter', label: 'Hatter' },
    ],
  },
};

// It is the native select: named by its label, and choosing an option reports the value (not the event).
export const ChoosingReportsTheValue: Story = {
  play: async ({ args, canvasElement }) => {
    const select = within(canvasElement).getByRole('combobox', { name: 'Chapter 1 status' });
    await userEvent.selectOptions(select, 'edited');
    await expect(args.onChange).toHaveBeenLastCalledWith('edited');
    await expect(select).toHaveValue('edited');
  },
};

// The keyboard reaches it (choosing with the arrow keys is the browser's own behaviour, which jsdom does not implement).
export const KeyboardReachesIt: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole('combobox', { name: 'Chapter 1 status' })).toHaveFocus();
  },
};
