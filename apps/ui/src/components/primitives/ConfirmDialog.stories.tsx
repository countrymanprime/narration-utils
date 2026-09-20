import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ConfirmDialog } from './ConfirmDialog';

const meta = {
  title: 'Primitives/ConfirmDialog',
  component: ConfirmDialog,
  args: {
    title: 'Import chapter-01.md',
    body: 'MARKDOWN · 214 paragraphs · 12 proposed chapters.',
    confirmLabel: 'Import',
    confirm: fn(),
    cancel: fn(),
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// Overwriting existing work is spelled out in the body and the confirm label.
export const DestructiveConfirm: Story = {
  args: {
    title: 'Clear derived project data?',
    body: 'This permanently removes the imported manuscript and stored source, Story Bible and proofing data, reader notes/bookmarks, and saved comparison results for this project. Settings will remain.',
    confirmLabel: 'Clear project data',
  },
};

// The optional third action sits in the grouped side, next to the confirm button.
export const WithDangerAction: Story = {
  args: {
    title: 'Unsaved settings',
    body: 'Save or discard changes before continuing?',
    confirmLabel: 'Save & continue',
    dangerLabel: 'Discard & continue',
    danger: fn(),
  },
};

export const WithChildren: Story = {
  args: {
    children: (
      <label className="mt-4 flex items-center gap-2 text-sm">
        Markdown chapter heading level
        <select defaultValue="1" className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1">
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
        </select>
      </label>
    ),
  },
};

// ADR 0001: a long unbroken token in the body must wrap, not scroll sideways.
export const LongUnbrokenBody: Story = {
  args: {
    title: 'Import manuscript',
    body: 'C:/Users/author/Documents/Manuscripts/The_Very_Long_Running_Series/Book_Three_The_Reckoning/Drafts/Final/chapter_twenty_seven_the_long_way_home_revised_v14_reviewed_by_editor_FINAL.docx',
    confirmLabel: 'Import',
  },
};

// ADR 0001: tall children scroll inside the dialog; Cancel and Import stay reachable.
export const LongScrollingChildren: Story = {
  args: {
    title: 'Import manuscript',
    body: 'Review the imported structure.',
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
    await expect(canvas.getByRole('button', { name: 'Import' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Cancel' })).toBeVisible();
  },
};

export const ConfirmInvokesHandler: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = canvas.getByRole('dialog', { name: 'Import chapter-01.md' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    await expect(args.confirm).toHaveBeenCalledOnce();
    await expect(args.cancel).not.toHaveBeenCalled();
  },
};

// Both the Cancel button and the header close button dismiss via the same `cancel` handler.
export const CancelAndCloseInvokeCancel: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(args.cancel).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'Close' }));
    await expect(args.cancel).toHaveBeenCalledTimes(2);
    await expect(args.confirm).not.toHaveBeenCalled();
  },
};

export const DangerInvokesOnlyDanger: Story = {
  args: {
    title: 'Unsaved settings',
    body: 'Save or discard changes before continuing?',
    confirmLabel: 'Save & continue',
    dangerLabel: 'Discard & continue',
    danger: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Discard & continue' }));
    await expect(args.danger).toHaveBeenCalledOnce();
    await expect(args.confirm).not.toHaveBeenCalled();
    await expect(args.cancel).not.toHaveBeenCalled();
  },
};
