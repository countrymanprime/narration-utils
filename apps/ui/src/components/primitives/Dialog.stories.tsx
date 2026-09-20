import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';
import { Dialog } from './Dialog';

const meta = {
  title: 'Primitives/Dialog',
  component: Dialog,
  args: {
    title: 'Add note',
    onClose: fn(),
    actions: (
      <>
        <Button variant="ghost">Cancel</Button>
        <Button variant="primary">Add note</Button>
      </>
    ),
    children: <p className="text-sm">Note for: &ldquo;It was a bright cold day in April.&rdquo;</p>,
  },
  argTypes: { actionsAlign: { control: 'radio', options: ['between', 'end'] } },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

// ADR 0002: the default puts Cancel on the opposite side from the affirmative
// action(s), so the two buttons must not cluster together.
export const ActionsBetween: Story = { args: { actionsAlign: 'between' } };

// A lone action would be stranded on the left under 'between', so single-action
// dialogs (WorkDialog's Close) opt into 'end'.
export const ActionsEnd: Story = {
  args: { title: 'Import complete', actionsAlign: 'end', actions: <Button variant="primary">Close</Button> },
};

// Affirmative actions grouped in their own flex wrapper stay together on the far side.
export const ActionsBetweenWithGroup: Story = {
  args: {
    title: 'Unsaved settings',
    actions: (
      <>
        <Button variant="ghost">Cancel</Button>
        <div className="flex gap-2">
          <Button variant="danger">Discard</Button>
          <Button variant="primary">Save</Button>
        </div>
      </>
    ),
  },
};

// Without onClose the header has no close button; the actions row is the only exit.
export const WithoutCloseButton: Story = { args: { onClose: undefined } };

// ADR 0001: a long unbroken token (a file path) must wrap inside the body
// instead of forcing a horizontal scrollbar.
export const LongUnbrokenToken: Story = {
  args: {
    title: 'Import manuscript',
    children: (
      <p className="text-sm">
        C:/Users/author/Documents/Manuscripts/The_Very_Long_Running_Series/Book_Three_The_Reckoning/Drafts/Final/chapter_twenty_seven_the_long_way_home_revised_v14_reviewed_by_editor_FINAL.docx
      </p>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The body is the scrolling container that wraps the children.
    const body = canvas.getByText(/chapter_twenty_seven/).parentElement as HTMLElement;
    await expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth);
  },
};

// ADR 0001: tall content scrolls inside the body (capped at 80dvh) while the
// header and action row stay put.
export const LongScrollingContent: Story = {
  args: {
    title: 'Import manuscript',
    children: (
      <div>
        {Array.from({ length: 60 }, (_, index) => (
          <p key={index} className="text-sm">
            Suggested character {index + 1}
          </p>
        ))}
      </div>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole('dialog', { name: 'Import manuscript' });
    await expect(within(dialog).getByRole('button', { name: 'Add note' })).toBeVisible();
    await expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible();
  },
};

// The dialog is a labelled modal and its close button reports back exactly once.
export const CloseButtonInvokesOnClose: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole('dialog', { name: 'Add note' });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
