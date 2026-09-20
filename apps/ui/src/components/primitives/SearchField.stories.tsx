import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SearchField } from './SearchField';

function ControlledSearch(props: ComponentProps<typeof SearchField>) {
  const [value, setValue] = useState(props.value);
  return (
    <div className="max-w-xs">
      <SearchField
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
  title: 'Primitives/SearchField',
  component: SearchField,
  args: { label: 'Search entries', value: '', placeholder: 'Search entries…', onChange: fn() },
  render: (args) => <ControlledSearch {...args} />,
} satisfies Meta<typeof SearchField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WithText: Story = { args: { value: 'rabbit' } };

// Typing shows the clear button; pressing it empties the field and puts the cursor back in it, so typing can go on.
export const ClearEmptiesAndKeepsFocus: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'Clear search' })).toBeNull();
    const field = canvas.getByRole('textbox', { name: 'Search entries' });
    await userEvent.type(field, 'rab');
    await userEvent.click(canvas.getByRole('button', { name: 'Clear search' }));
    await expect(args.onChange).toHaveBeenLastCalledWith('');
    await expect(field).toHaveValue('');
    await expect(field).toHaveFocus();
    await expect(canvas.queryByRole('button', { name: 'Clear search' })).toBeNull();
  },
};
