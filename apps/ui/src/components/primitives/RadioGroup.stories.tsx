import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type ComponentProps } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { RadioGroup } from './RadioGroup';

// Controlled, like every call site: the story feeds the new value back in.
function ControlledRadioGroup(props: ComponentProps<typeof RadioGroup<'reference' | 'opening'>>) {
  const [value, setValue] = useState(props.value);
  return (
    <RadioGroup
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange(next);
      }}
    />
  );
}

const meta = {
  title: 'Primitives/RadioGroup',
  component: RadioGroup<'reference' | 'opening'>,
  args: {
    label: 'What is it?',
    value: 'reference',
    onChange: fn(),
    options: [
      { value: 'reference', label: 'Not a chapter', description: 'A part title, an epigraph or a false split. Hidden from navigation too.' },
      { value: 'opening', label: 'Front matter', description: "Stays in the manuscript's navigation, not recorded as a chapter." },
    ],
  },
  render: (args) => <ControlledRadioGroup {...args} />,
} satisfies Meta<typeof RadioGroup<'reference' | 'opening'>>;

export default meta;
type Story = StoryObj<typeof meta>;

// chapter-track-link-control.prd.md Phase 3's "Remove from recording?" confirm (mockup 06): both options and their
// help text are visible together, not one at a time behind a Select.
export const Default: Story = {};

export const ClickSelects: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Front matter' }));
    await expect(args.onChange).toHaveBeenLastCalledWith('opening');
    await expect(canvas.getByRole('radio', { name: 'Front matter' })).toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'Not a chapter' })).not.toBeChecked();
  },
};

export const ArrowKeysMove: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole('radio', { name: 'Not a chapter' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(args.onChange).toHaveBeenLastCalledWith('opening');
  },
};
