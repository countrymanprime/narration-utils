import type { Meta, StoryObj } from '@storybook/react-vite';
import { faFileLines } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { Tooltip, TooltipTarget } from './Tooltip';

const iconButtonClass =
  'inline-flex size-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]';
const cardClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] text-left shadow-[var(--shadow)] transition hover:-translate-y-px disabled:pointer-events-none disabled:opacity-50';

const meta = {
  title: 'Primitives/Tooltip',
  component: Tooltip,
  args: { text: 'The manuscript always uses the full reading width - adjust text size instead.' },
  // The preview decorator already supplies TooltipProvider, so these all use the shared tooltip layer.
  render: (args) => (
    <p className="text-sm">
      Text size <Tooltip {...args} />
    </p>
  ),
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InfoIcon: Story = {};

// The "i" is a real button: the keyboard reaches it, it shows its text at once on keyboard focus (hover waits 1000 ms),
// Escape hides it, and the text is also its accessible description, so a screen reader hears it without the popup.
export const InfoIconShowsTooltipOnKeyboardFocus: Story = {
  play: async ({ args, canvasElement }) => {
    const icon = within(canvasElement).getByRole('button', { name: 'More information' });
    await expect(icon).toHaveAccessibleDescription(args.text);
    await userEvent.tab();
    await expect(icon).toHaveFocus();
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(args.text);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull());
    await expect(icon).toHaveFocus();
  },
};

// A press opens it and a second press closes it; nothing it names is missing from the page.
export const InfoIconTogglesOnPress: Story = {
  play: async ({ args, canvasElement }) => {
    const icon = within(canvasElement).getByRole('button', { name: 'More information' });
    await userEvent.click(icon);
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(args.text);
    await expect(icon).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(icon);
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull());
  },
};

// WCAG 1.4.13: content shown on hover must be hoverable (the pointer can move onto it without it vanishing) and persistent
// (it stays until dismissed). The popup therefore takes pointer events; the pointer path is proved in a real browser by the
// visual suite's tooltip states and by hand, because a scripted pointer teleports and never travels the gap.
export const InfoIconPopupTakesPointerEvents: Story = {
  play: async ({ canvasElement }) => {
    const icon = within(canvasElement).getByRole('button', { name: 'More information' });
    await userEvent.click(icon);
    const tooltip = await within(document.body).findByRole('tooltip');
    await expect(getComputedStyle(tooltip).pointerEvents).not.toBe('none');
    // Close it again: while a popover opened by a press is showing, Base UI's invisible focus guards trip axe's
    // aria-hidden-focus, and the atlas runs axe after play().
    await userEvent.click(icon);
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull());
  },
};

export const OnButton: Story = {
  render: () => (
    <TooltipTarget text="View manuscript">
      <button className={iconButtonClass} aria-label="View manuscript">
        <FontAwesomeIcon icon={faFileLines} />
      </button>
    </TooltipTarget>
  ),
};

// Focus (unlike hover) shows the tooltip immediately, so no timers are needed here.
export const ShowsTooltipOnFocus: Story = {
  render: OnButton.render,
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await expect(within(canvasElement).getByRole('button', { name: 'View manuscript' })).toHaveFocus();
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('View manuscript');
  },
};

// Escape dismisses a hint without moving focus or the pointer.
export const EscapeHidesTooltip: Story = {
  render: OnButton.render,
  play: async ({ canvasElement }) => {
    await userEvent.tab();
    await within(document.body).findByRole('tooltip');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull());
    await expect(within(canvasElement).getByRole('button', { name: 'View manuscript' })).toHaveFocus();
  },
};

export const HidesTooltipOnBlur: Story = {
  render: OnButton.render,
  play: async () => {
    await userEvent.tab();
    await within(document.body).findByRole('tooltip');
    await userEvent.tab();
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull());
  },
};

// A disabled button never receives focus or hover events of its own, so the
// wrapper span becomes the tab stop (tabIndex 0) and carries the explanation as its name (role group).
export const OnDisabledButton: Story = {
  render: () => (
    <TooltipTarget text="Import a manuscript to unlock Proofing." className="max-w-sm">
      <button className={cardClass} aria-label="Open Proofing" disabled>
        <div className="font-semibold">Proofing</div>
        <div className="mt-1 text-sm">Select audio items or a track in REAPER, then start Proofing.</div>
      </button>
    </TooltipTarget>
  ),
};

export const DisabledButtonExplainsWhyOnFocus: Story = {
  render: OnDisabledButton.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Open Proofing' });
    await expect(button).toBeDisabled();
    await userEvent.tab();
    await expect(button.parentElement).toHaveFocus();
    await expect(canvas.getByRole('group', { name: 'Import a manuscript to unlock Proofing.' })).toBe(button.parentElement);
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('Import a manuscript to unlock Proofing.');
  },
};
