import { faPen, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { IconButton } from './IconButton';
import { TooltipTarget } from './Tooltip';

const meta = {
  title: 'Primitives/IconButton',
  component: IconButton,
  args: { label: 'Edit this entry', onClick: fn(), children: <FontAwesomeIcon icon={faPen} /> },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Primary: Story = { args: { variant: 'primary', label: 'Save changes' } };
export const Danger: Story = { args: { variant: 'danger', label: 'Delete entity', children: <FontAwesomeIcon icon={faTrash} /> } };
export const Disabled: Story = { args: { disabled: true, label: 'Remove relationship', children: <FontAwesomeIcon icon={faXmark} /> } };

// The action this button started is running (ADR 0075): the icon becomes a spinner, the name stays, and a press does nothing.
export const Pending: Story = { args: { pending: true, variant: 'primary', label: 'Save changes' } };

export const PendingIsBusyAndFocusable: Story = {
  args: { pending: true, label: 'Save changes' },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Save changes' });
    await expect(button).toHaveAttribute('aria-busy', 'true');
    await expect(button).not.toBeDisabled();
    button.focus();
    await expect(button).toHaveFocus();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

// A hint is composed around the button, not a prop of it: the hint can say more than the label.
export const WithHint: Story = {
  render: (args) => (
    <TooltipTarget text="Discard changes and stop editing">
      <IconButton {...args} label="Cancel editing" />
    </TooltipTarget>
  ),
};

// It is a button named by its label, and pressing it, by pointer or by Enter, reports one click.
export const PressReportsClick: Story = {
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Edit this entry' });
    await userEvent.click(button);
    await expect(args.onClick).toHaveBeenCalledTimes(1);
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onClick).toHaveBeenCalledTimes(2);
  },
};

export const DisabledDoesNothing: Story = {
  args: { disabled: true },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Edit this entry' });
    await expect(button).toBeDisabled();
    // A real pointer press is refused by the browser (the disabled button takes no pointer events), so click the element itself.
    button.click();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

// disabledReason keeps the button focusable and hoverable, unlike native disabled (D6, WCAG 1.4.13): pair it with
// a plain TooltipTarget whose tooltip stays reachable because the button itself carries it.
export const DisabledWithReason: Story = {
  args: { disabledReason: 'No pronunciation exists for this name yet.', label: 'Play preview' },
  play: async ({ args, canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Play preview' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toBeDisabled();
    button.click();
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};
