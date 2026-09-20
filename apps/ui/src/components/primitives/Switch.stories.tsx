import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Switch } from './Switch';

function ControlledSwitch(props: ComponentProps<typeof Switch>) {
  const [checked, setChecked] = useState(props.checked);
  return (
    <Switch
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
  title: 'Primitives/Switch',
  component: Switch,
  args: { checked: false, onChange: fn(), children: 'Notify me when a job finishes' },
  render: (args) => <ControlledSwitch {...args} />,
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { checked: true } };
export const Disabled: Story = { args: { disabled: true } };

// It is a switch (announced "on"/"off"), named by its label, and pressing it toggles it (pressing the label text is proved
// in Switch.test.tsx, for the reason given in Checkbox.stories.tsx).
export const PressToggles: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('switch', { name: 'Notify me when a job finishes' }));
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
    await expect(canvas.getByRole('switch', { name: 'Notify me when a job finishes' })).toBeChecked();
  },
};

export const SpaceToggles: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole('switch')).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(args.onChange).toHaveBeenLastCalledWith(true);
  },
};
