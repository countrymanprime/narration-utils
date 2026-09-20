import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Field } from './Field';

// Field is a controlled component: it never holds its own value. Stories that
// type into it need a parent that feeds `onChange` back into `value`, exactly
// like the draft state in GuideDetail. The `onChange` arg is still called so
// play functions can assert on it.
function ControlledField(props: ComponentProps<typeof Field>) {
  const [value, setValue] = useState(props.value);
  return (
    <Field
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
  title: 'Primitives/Field',
  component: Field,
  args: { label: 'Timeline context', value: 'Spring, three winters after the siege', onChange: fn(), onBlur: fn() },
  argTypes: { textarea: { control: 'boolean' }, disabled: { control: 'boolean' } },
  render: (args) => <ControlledField {...args} />,
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextInput: Story = {};
export const TextInputEmpty: Story = { args: { value: '' } };
export const WithPlaceholder: Story = { args: { value: '', placeholder: 'Microphone (USB Audio Device)' } };
// A value wider than the field: the input scrolls, the layout must not grow.
export const TextInputLongValue: Story = {
  args: { value: 'Late autumn, roughly forty days after the harbour fire and three winters after the siege of the lower city' },
};

export const Textarea: Story = {
  args: {
    label: 'Description',
    textarea: true,
    value: 'Captain of the river watch. Speaks slowly, never raises her voice, and keeps a ledger of every favour she is owed.',
  },
};
export const TextareaEmpty: Story = { args: { label: 'Description', textarea: true, value: '' } };
export const TextareaMultiline: Story = {
  args: {
    label: 'Personality notes',
    textarea: true,
    value: 'Patient with children.\nSuspicious of anyone who offers help unasked.\nHums when she is lying.',
  },
};

// Locked story-bible entries (ADR 0007) and unsaved new drafts render their fields disabled.
export const TextInputDisabled: Story = { args: { disabled: true } };
export const TextareaDisabled: Story = {
  args: { label: 'Description', textarea: true, disabled: true, value: 'Locked entry: edits are blocked until it is unlocked.' },
};

export const TypingUpdatesValue: Story = {
  args: { label: 'Timeline context', value: 'Spring' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Timeline context' });
    await userEvent.type(input, ', year two');
    await expect(input).toHaveValue('Spring, year two');
    await expect(args.onChange).toHaveBeenLastCalledWith('Spring, year two');
  },
};

export const ClearingReportsEmptyString: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Timeline context' });
    await userEvent.clear(input);
    await expect(input).toHaveValue('');
    await expect(args.onChange).toHaveBeenLastCalledWith('');
  },
};

export const TextareaTypingKeepsNewlines: Story = {
  args: { label: 'Description', textarea: true, value: '' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByRole('textbox', { name: 'Description' });
    await userEvent.type(textarea, 'First line{Enter}Second line');
    await expect(textarea).toHaveValue('First line\nSecond line');
    await expect(args.onChange).toHaveBeenLastCalledWith('First line\nSecond line');
  },
};

// onBlur is how callers commit a draft, so it must fire once focus leaves the field.
export const BlurCommitsDraft: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('textbox', { name: 'Timeline context' }));
    await expect(args.onBlur).not.toHaveBeenCalled();
    await userEvent.tab();
    await expect(args.onBlur).toHaveBeenCalledOnce();
  },
};

// A disabled field is not editable. (userEvent.type on it would be a no-op at
// best, so assert state instead.)
export const DisabledIsInert: Story = {
  args: { disabled: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Timeline context' })).toBeDisabled();
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

export const TextareaDisabledIsInert: Story = {
  args: { label: 'Description', textarea: true, disabled: true, value: 'Locked entry' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Description' })).toBeDisabled();
    await expect(args.onChange).not.toHaveBeenCalled();
  },
};

// A hint describes the control; the control is wired to it, not just placed near it.
export const WithHint: Story = {
  args: { hint: 'As it appears in the manuscript' },
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Timeline context' });
    await expect(input).toHaveAccessibleDescription(String(args.hint));
  },
};

// An error marks the control invalid and is read with it.
export const WithError: Story = {
  args: { value: '', error: 'A timeline context is required' },
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'Timeline context' });
    await expect(input).toBeInvalid();
    await expect(input).toHaveAccessibleDescription(String(args.error));
  },
};

export const TextareaWithHintAndError: Story = {
  args: { label: 'Description', textarea: true, value: '', hint: 'One or two sentences', error: 'A description is required' },
  play: async ({ canvasElement }) => {
    const textarea = within(canvasElement).getByRole('textbox', { name: 'Description' });
    await expect(textarea).toBeInvalid();
    await expect(textarea).toHaveAccessibleDescription('One or two sentences A description is required');
  },
};

// A dialog whose one job is this field opens with the cursor in it.
export const FocusedOnMount: Story = {
  args: { label: 'Note', textarea: true, value: '', autoFocus: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('textbox', { name: 'Note' })).toHaveFocus();
  },
};
