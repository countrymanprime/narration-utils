import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  args: { children: 'Save changes', onClick: fn() },
  argTypes: {
    variant: { control: 'radio', options: ['primary', 'secondary', 'ghost', 'danger', 'link'] },
    size: { control: 'radio', options: ['md', 'sm'] },
  },
} satisfies Meta<typeof Button>;

export default meta;

const isLaidOut = (element: HTMLElement) => element.getBoundingClientRect().width > 0;
type Story = StoryObj<typeof meta>;

// The measured spec (ADR 0595): 32 px (`md`, the default) or 28 px (`sm`), 12 px each side, Barlow Condensed at `--font-size-sm`,
// uppercase, tracked 0.06 em. Primary is filled `--accent`; secondary is outlined and filled `--surface`.
export const Primary: Story = { args: { variant: 'primary' } };
export const Secondary: Story = { args: { variant: 'secondary' } };
// Secondary without the fill, for a button on a tinted surface.
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Delete' } };

export const PrimarySmall: Story = { args: { variant: 'primary', size: 'sm', children: 'Punch & roll here' } };
export const SecondarySmall: Story = { args: { variant: 'secondary', size: 'sm', children: 'Resolve' } };
export const DangerSmall: Story = { args: { variant: 'danger', size: 'sm', children: 'Delete' } };

// The underlined text action inside a sentence: the sentence's font, size and colour, and none of the button chrome.
export const Link: Story = {
  args: { variant: 'link', children: 'Settings > Credits' },
  render: (args) => (
    <p className="text-sm">
      Two more fields are waiting in <Button {...args} />.
    </p>
  ),
};

// The mocks' header row: a secondary and a primary button side by side, 8 px apart, each 32 px tall.
export const HeaderRow: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button variant="secondary">Export status report</Button>
      <Button variant="primary">● Start session</Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole('button');
    // Measured in the atlas's browser; the unit run's jsdom lays nothing out.
    if (!isLaidOut(canvasElement)) return;
    for (const button of buttons) await expect(button.getBoundingClientRect().height).toBe(32);
  },
};

// The companion's row of small buttons, 28 px tall.
export const SmallRow: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Button variant="primary" size="sm">
        ● Punch & roll here
      </Button>
      <Button variant="secondary" size="sm">
        Resolve
      </Button>
      <Button variant="secondary" size="sm">
        Waive
      </Button>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const buttons = within(canvasElement).getAllByRole('button');
    // Measured in the atlas's browser; the unit run's jsdom lays nothing out.
    if (!isLaidOut(canvasElement)) return;
    for (const button of buttons) await expect(button.getBoundingClientRect().height).toBe(28);
  },
};

export const PrimaryDisabled: Story = { args: { variant: 'primary', disabled: true } };
export const SecondaryDisabled: Story = { args: { variant: 'secondary', disabled: true } };
export const DangerDisabled: Story = { args: { variant: 'danger', children: 'Delete', disabled: true } };

// The action this button started is running (ADR 0075): a spinner, dimmed, aria-busy, and a press does nothing. It stays focusable.
export const PrimaryPending: Story = { args: { variant: 'primary', pending: true } };
export const SecondaryPending: Story = { args: { variant: 'secondary', pending: true } };
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
