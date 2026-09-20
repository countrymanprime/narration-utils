import type { Meta, StoryObj } from '@storybook/react-vite';
import { faFileLines } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test';
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

// The "i" icon is a plain span, not a tab stop, so a keyboard cannot reach it and
// focusin is dispatched directly. Focus shows the tooltip at once; hover waits 1000 ms.
export const InfoIconShowsTooltip: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    fireEvent.focusIn(canvas.getByLabelText('More information'));
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(args.text);
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
    const canvas = within(canvasElement);
    canvas.getByRole('button', { name: 'View manuscript' }).focus();
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('View manuscript');
  },
};

export const HidesTooltipOnBlur: Story = {
  render: OnButton.render,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'View manuscript' });
    button.focus();
    await within(document.body).findByRole('tooltip');
    button.blur();
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull());
  },
};

// A disabled button never receives focus or hover events of its own, so the
// wrapper span becomes the tab stop (tabIndex 0) and carries the explanation.
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
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('Import a manuscript to unlock Proofing.');
  },
};
