import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Save changes', onClick: fn() },
  argTypes: { variant: { control: 'radio', options: ['primary', 'ghost', 'danger'] } },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: 'primary' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Delete' } };

export const PrimaryDisabled: Story = { args: { variant: 'primary', disabled: true } };
export const GhostDisabled: Story = { args: { variant: 'ghost', disabled: true } };
export const DangerDisabled: Story = { args: { variant: 'danger', children: 'Delete', disabled: true } };

// The action this button started is running (ADR 0075): a spinner, dimmed, aria-busy, and a press does nothing. It stays focusable.
export const PrimaryPending: Story = { args: { variant: 'primary', pending: true } };
export const GhostPending: Story = { args: { variant: 'ghost', pending: true } };
export const DangerPending: Story = { args: { variant: 'danger', children: 'Delete', pending: true } };

// Busy and still focusable (it is not `disabled`). A pointer cannot reach it (`pointer-events: none`, like a disabled button), and the unit test
// presses it with the keyboard and by dispatching a click: the handler is never called.
export const PendingIsBusyAndFocusable: Story = {
  args: { pending: true },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save changes' });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).not.toBeDisabled();
    button.focus();
    await expect(button).toHaveFocus();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

// Interaction: clicking an enabled button invokes onClick exactly once.
export const ClickInvokesHandler: Story = {
  args: { variant: 'primary' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

// A disabled button is not actionable. (userEvent.click on it would throw
// because of the `pointer-events-none` class, so assert state instead.)
export const DisabledIsInert: Story = {
  args: { variant: 'danger', children: 'Delete', disabled: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Delete' })).toBeDisabled();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
