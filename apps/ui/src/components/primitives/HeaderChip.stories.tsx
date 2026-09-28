import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faStopwatch } from '@fortawesome/free-solid-svg-icons';
import { expect, fn, userEvent, within } from 'storybook/test';
import { HeaderChip } from './HeaderChip';

// A header chip sits on the header's `--surface`, never the bare page background the atlas otherwise renders a story on.
const onHeader: Decorator = (Story) => (
  <div className="flex h-13 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5">
    <Story />
  </div>
);

const meta = {
  title: 'Primitives/HeaderChip',
  component: HeaderChip,
  args: { tone: 'neutral', children: 'Book 1 · Wonderland series' },
  decorators: [onHeader],
} satisfies Meta<typeof HeaderChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};
// Mock 01's engine chip: "REAPER linked" on `--ok-soft` with an `--ok` dot.
export const Success: Story = { args: { tone: 'success', dot: 'var(--ok)', children: 'REAPER linked · following Ch 7' } };
export const Warning: Story = { args: { tone: 'warning', dot: 'var(--warn)', children: 'Wrong REAPER project open' } };
export const QuietDot: Story = { args: { dot: 'var(--non-text)', children: 'No REAPER project linked' } };

// Mock 01's timer chip: the clock in Plex Mono 13 px 500 beside the Barlow text.
export const Timer: Story = {
  args: {
    role: 'timer',
    'aria-label': 'Timer running on Chapter 7, Recording: 2:14:08',
    children: (
      <>
        <FontAwesomeIcon icon={faStopwatch} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8125rem] font-medium tracking-normal">2:14:08</span>
        <span>· timer on Ch 7</span>
      </>
    ),
  },
};

// The engine chip opens the engine panel: a button in the chip's shape.
export const OpensThePanel: Story = {
  args: { tone: 'success', dot: 'var(--ok)', children: 'REAPER linked', onClick: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'REAPER linked' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

// The measured spec (mock-fidelity-primitives-and-components.prd.md Phase 8, ADR 0635), side by side as mock 01's header
// draws them: 22 px tall, fully rounded, 12 px apart, no border.
export const MeasuredHeader: Story = {
  render: () => (
    <>
      <HeaderChip>Book 1 · Wonderland series</HeaderChip>
      <HeaderChip role="timer" aria-label="Timer: 2:14:08">
        <FontAwesomeIcon icon={faStopwatch} aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8125rem] font-medium tracking-normal">2:14:08</span>
        <span>today · timer on Ch 7</span>
      </HeaderChip>
      <HeaderChip tone="success" dot="var(--ok)">
        REAPER linked · following Ch 7
      </HeaderChip>
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chip = canvas.getByText('REAPER linked · following Ch 7');
    // Measured in the atlas's browser; jsdom (stories.test.tsx) lays nothing out, so there HeaderChip.test.tsx pins the classes.
    if (chip.getBoundingClientRect().height === 0) return;
    await expect(chip.getBoundingClientRect().height).toBeCloseTo(22, 0);
    await expect(canvas.getByRole('timer').getBoundingClientRect().height).toBeCloseTo(22, 0);
    const style = getComputedStyle(chip);
    await expect(style.borderTopWidth).toBe('0px');
    await expect(style.textTransform).toBe('none');
    await expect(parseFloat(style.paddingLeft)).toBeCloseTo(10, 0);
  },
};
