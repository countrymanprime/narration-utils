import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { insidePortal, screen } from './portalScreen';

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
  play: async () => {
    // The body is the scrolling container that wraps the children.
    const body = (await screen.findByText(/chapter_twenty_seven/)).parentElement as HTMLElement;
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
  play: async () => {
    const dialog = await screen.findByRole('dialog', { name: 'Import manuscript' });
    await expect(within(dialog).getByRole('button', { name: 'Add note' })).toBeVisible();
    await expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible();
  },
};

// The dialog is a labelled modal (named by its visible title) and its close button reports back exactly once.
export const CloseButtonInvokesOnClose: Story = {
  play: async ({ args }) => {
    const dialog = await screen.findByRole('dialog', { name: 'Add note' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

// Modality: the page behind the dialog is hidden from assistive technology while it is open.
export const HidesThePageBehindIt: Story = {
  play: async ({ canvasElement }) => {
    await expect(await screen.findByRole('dialog', { name: 'Add note' })).toBeVisible();
    await expect(canvasElement.closest('[aria-hidden="true"]')).not.toBeNull();
  },
};

// Focus starts on the body region so a screen reader reads the message before any control.
export const FocusStartsOnTheBody: Story = {
  play: async () => {
    await screen.findByRole('dialog', { name: 'Add note' });
    const body = screen.getByText(/Note for:/).parentElement as HTMLElement;
    await waitFor(() => expect(document.activeElement).toBe(body));
  },
};

// Escape closes a dialog that has an onClose.
export const EscapeInvokesOnClose: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Add note' });
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

// Without onClose (a job that is still running) there is nowhere to go, so Escape does nothing.
export const EscapeIsIgnoredWithoutOnClose: Story = {
  args: { onClose: undefined },
  play: async () => {
    await screen.findByRole('dialog', { name: 'Add note' });
    await userEvent.keyboard('{Escape}');
    await expect(screen.getByRole('dialog', { name: 'Add note' })).toBeVisible();
  },
};

// A press on the scrim never dismisses: an accidental click must not discard a confirm.
export const BackdropPressDoesNotClose: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Add note' });
    await userEvent.click(document.querySelector('[data-dialog-backdrop]') as HTMLElement);
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(screen.getByRole('dialog', { name: 'Add note' })).toBeVisible();
  },
};

// Tab and Shift+Tab loop inside the dialog; the page behind is never reached.
export const TabStaysInsideTheDialog: Story = {
  play: async ({ canvasElement }) => {
    await screen.findByRole('dialog', { name: 'Add note' });
    for (let press = 0; press < 10; press += 1) {
      await userEvent.tab({ shift: press % 3 === 2 });
      await waitFor(() => expect(insidePortal(document.activeElement)).toBe(true));
      await expect(canvasElement.contains(document.activeElement)).toBe(false);
    }
  },
};

function WithOpener() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="rounded border px-3 py-1 text-sm" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      {open && (
        <Dialog title="Add note" onClose={() => setOpen(false)} actions={<Button variant="ghost">Cancel</Button>}>
          <p className="text-sm">Note body</p>
        </Dialog>
      )}
    </div>
  );
}

// The dialog is mounted on demand, like every consumer's, and gives focus back to the button that opened it.
export const ReturnsFocusToTheOpener: Story = {
  render: () => <WithOpener />,
  play: async ({ canvasElement }) => {
    const opener = within(canvasElement).getByRole('button', { name: 'Open dialog' });
    await userEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Add note' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  },
};

// An autoFocus child (the note field) wins over the body region.
export const AutoFocusChildWins: Story = {
  args: { children: <textarea aria-label="Note" autoFocus className="w-full rounded border p-2 text-sm" /> },
  play: async () => {
    const note = await screen.findByRole('textbox', { name: 'Note' });
    await waitFor(() => expect(document.activeElement).toBe(note));
  },
};
