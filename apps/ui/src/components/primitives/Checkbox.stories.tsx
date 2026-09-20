import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Checkbox } from './Checkbox';

// Controlled, like every call site: the story feeds the new state back in.
function ControlledCheckbox(props: ComponentProps<typeof Checkbox>) {
  const [checked, setChecked] = useState(props.checked);
  return (
    <Checkbox
      {...props}
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        props.onChange(next);
      }}
    />
  );
}

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  args: {
    checked: false,
    onChange: fn(),
    children: (
      <>
        Alice<span style={{ color: 'var(--text-muted)' }}> — a curious child who follows a rabbit</span>
      </>
    ),
  },
  render: (args) => <ControlledCheckbox {...args} />,
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };

// Pressing the box toggles it, and the box is named by the label text (pressing the label text is proved in Checkbox.test.tsx:
// Base UI's label handling builds a PointerEvent that the Storybook jsdom runner's window rejects).
export const PressToggles: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('checkbox', { name: /Alice/ }));
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
    await expect(canvas.getByRole('checkbox', { name: /Alice/ })).toBeChecked();
  },
};

export const SpaceToggles: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole('checkbox', { name: /Alice/ })).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
  },
};
