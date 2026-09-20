import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { insidePortal, screen } from './portalScreen';
import { SlideOver } from './SlideOver';

const meta = {
  title: 'Primitives/SlideOver',
  component: SlideOver,
  args: { open: true, title: 'Entry details', onClose: fn(), children: <p className="text-sm">Alice is the protagonist. First mentioned in chapter 1.</p> },
} satisfies Meta<typeof SlideOver>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  play: async () => {
    await expect(await screen.findByRole('dialog', { name: 'Entry details' })).toBeVisible();
  },
};

// ADR-0017: a closed panel must never take focus or clicks. The library removes it from the page once it has slid out.
export const Closed: Story = {
  args: { open: false },
  play: async () => {
    await expect(screen.queryByRole('dialog')).toBeNull();
    await expect(document.querySelector('[data-slide-over]')).toBeNull();
    await expect(document.querySelector('[data-slide-over-backdrop]')).toBeNull();
  },
};

export const LongContent: Story = {
  args: {
    children: (
      <div className="space-y-3 text-sm">
        {Array.from({ length: 30 }, (_, index) => (
          <p key={index}>Mention {index + 1}: “Alice was beginning to get very tired of sitting by her sister on the bank.”</p>
        ))}
      </div>
    ),
  },
};

export const CustomCloseLabel: Story = { args: { closeLabel: 'Close entry details' } };

export const CloseButtonInvokesOnClose: Story = {
  play: async ({ args }) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const BackdropClickInvokesOnClose: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Entry details' });
    const backdrop = document.querySelector('[data-slide-over-backdrop]');
    if (!backdrop) throw new Error('an open SlideOver renders its click-away backdrop');
    await userEvent.click(backdrop);
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

// Escape closes it, like the dialogs.
export const EscapeInvokesOnClose: Story = {
  play: async ({ args }) => {
    await screen.findByRole('dialog', { name: 'Entry details' });
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

// The page behind is hidden from assistive technology, and Tab never leaves the panel.
export const KeepsFocusInsideAndHidesThePage: Story = {
  play: async ({ canvasElement }) => {
    await screen.findByRole('dialog', { name: 'Entry details' });
    await expect(canvasElement.closest('[aria-hidden="true"]')).not.toBeNull();
    for (let press = 0; press < 8; press += 1) {
      await userEvent.tab({ shift: press % 3 === 2 });
      await waitFor(() => expect(insidePortal(document.activeElement)).toBe(true));
    }
  },
};

function WithOpener() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="rounded border px-3 py-1 text-sm" onClick={() => setOpen(true)}>
        Open panel
      </button>
      <SlideOver open={open} title="Entry details" onClose={() => setOpen(false)}>
        <p className="text-sm">Alice is the protagonist.</p>
      </SlideOver>
    </div>
  );
}

// It opens from a button and gives focus back to that button when Escape closes it.
export const ReturnsFocusToTheOpener: Story = {
  render: () => <WithOpener />,
  play: async ({ canvasElement }) => {
    const opener = within(canvasElement).getByRole('button', { name: 'Open panel' });
    await userEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Entry details' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  },
};
