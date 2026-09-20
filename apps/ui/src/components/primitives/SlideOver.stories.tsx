import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { SlideOver } from './SlideOver';

const meta = {
  title: 'Primitives/SlideOver',
  component: SlideOver,
  args: { open: true, title: 'Entry details', onClose: fn(), children: <p className="text-sm">Alice is the protagonist. First mentioned in chapter 1.</p> },
} satisfies Meta<typeof SlideOver>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

// ADR-0017: the closed panel stays mounted (so it can slide) but must be invisible and inert.
export const Closed: Story = {
  args: { open: false },
  play: async ({ canvasElement }) => {
    const panel = canvasElement.querySelector('[data-slide-over]');
    await expect(panel).toHaveAttribute('data-open', 'false');
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(canvasElement.querySelector('[data-slide-over-backdrop]')).toBeNull();
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
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Close' }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

export const BackdropClickInvokesOnClose: Story = {
  play: async ({ args, canvasElement }) => {
    const backdrop = canvasElement.querySelector('[data-slide-over-backdrop]');
    if (!backdrop) throw new Error('an open SlideOver renders its click-away backdrop');
    await userEvent.pointer({ keys: '[MouseLeft>]', target: backdrop });
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
