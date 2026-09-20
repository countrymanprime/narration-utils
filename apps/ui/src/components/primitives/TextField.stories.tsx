import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { TextField } from './TextField';

function ControlledTextField(props: ComponentProps<typeof TextField>) {
  const [value, setValue] = useState(props.value);
  return (
    <div className="max-w-sm">
      <TextField
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
  title: 'Primitives/TextField',
  component: TextField,
  args: { label: 'Relationship', value: '', placeholder: 'Relationship, e.g. located in', onChange: fn() },
  render: (args) => <ControlledTextField {...args} />,
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Filled: Story = { args: { value: 'located in' } };
export const Disabled: Story = { args: { value: 'located in', disabled: true } };
export const Monospace: Story = { args: { label: 'Note colour', value: 'FFD54F', mono: true } };
export const ColourPicker: Story = { args: { label: 'Note colour hex', type: 'color', value: '#ffd54f' } };

// The field is named by its label, and typing reports the text (not the event), one change per key.
export const TypingReportsTheText: Story = {
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Relationship' });
    await userEvent.type(field, 'in');
    await expect(args.onChange).toHaveBeenCalledTimes(2);
    await expect(args.onChange).toHaveBeenLastCalledWith('in');
    await expect(field).toHaveValue('in');
  },
};

export const DisabledTakesNoInput: Story = {
  args: { disabled: true },
  play: async ({ args, canvasElement }) => {
    const field = within(canvasElement).getByRole('textbox', { name: 'Relationship' });
    await expect(field).toBeDisabled();
    await userEvent.type(field, 'x');
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};
