import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Dot as BareDot, StatusBadge, type StatusTone } from './StatusBadge';

// A badge's fill is a tint of its tone (paletteContrast.test.ts checks it against surface, ADR 0362), the same
// backdrop every real caller gives it (EntitySummary's badges, this PRD's mocks): a card, a table cell, a panel -
// never the bare page background the atlas's own decorator otherwise renders a story on.
const onSurface: Decorator = (Story) => (
  <div className="rounded-lg bg-[var(--surface)] p-6">
    <Story />
  </div>
);

const meta = {
  title: 'Primitives/StatusBadge',
  component: StatusBadge,
  args: { tone: 'info', label: 'REAPER linked · following Ch 7' },
  decorators: [onSurface],
} satisfies Meta<typeof StatusBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

// One story per tone (studio-ui-primitives.prd.md Q6): a closed set of meanings, not one tone per stage name.
export const Neutral: Story = { args: { tone: 'neutral', label: 'Not started' } };
export const Info: Story = {};
export const Progress: Story = { args: { tone: 'progress', label: '41%' } };
export const Success: Story = { args: { tone: 'success', label: 'PASS' } };
export const Warning: Story = { args: { tone: 'warning', label: '3 open' } };
export const Danger: Story = { args: { tone: 'danger', label: 'FLOOR' } };
export const Experimental: Story = { args: { tone: 'experimental', label: 'Experimental' } };
// The two tones the benchmark mocks add (ADR 0600): the accent (a proofer, a query, "Author ✓") and org (PACING).
export const Accent: Story = { args: { tone: 'accent', label: 'Author ✓' } };
export const Org: Story = { args: { tone: 'org', label: 'Pacing', shape: 'tag' } };

const TONES: StatusTone[] = ['neutral', 'info', 'progress', 'accent', 'success', 'warning', 'danger', 'org', 'experimental'];

// Every tone in each shape and look, as mocks 01, 02 and 04 draw them side by side: one row per shape, so a tone that
// drifts from the others shows here first.
export const EveryShapeAndLook: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      {(['pill', 'tag'] as const).map((shape) =>
        (['soft', 'outline'] as const).map((look) => (
          <div key={`${shape}-${look}`} className="flex flex-wrap items-center gap-2">
            {TONES.map((tone) => (
              <StatusBadge key={tone} tone={tone} shape={shape} look={look} label={shape === 'tag' ? tone : `6 need ${tone}`} />
            ))}
          </div>
        )),
      )}
    </div>
  ),
};

// The measured spec (mock-fidelity-primitives-and-components.prd.md Phase 2, ADR 0600): a pill is 22 px tall and fully
// rounded, a tag 16 px on the 3 px tag radius, the Booth's tag 26 px, the Production board's cell 58×20 (ADR 0645). Measured
// at the default root size.
export const MeasuredShapes: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <StatusBadge tone="danger" label="Pickup" />
      <StatusBadge tone="danger" shape="tag" label="Misread" />
      <StatusBadge tone="neutral" shape="booth" label="Narrator" />
      <StatusBadge tone="warning" look="outline" label="Changed" />
      <StatusBadge tone="success" shape="cell" label="✓" />
      <StatusBadge tone="danger" shape="cell" label="3 open" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const height = (text: string) => canvas.getByText(text).getBoundingClientRect().height;
    // Measured in the atlas's browser; the stories also run in jsdom (stories.test.tsx), which lays nothing out and loads no
    // stylesheet, so there the classes are what StatusBadge.test.tsx pins.
    if (height('Pickup') === 0) return;
    await expect(height('Pickup')).toBeCloseTo(22, 0);
    await expect(height('Misread')).toBeCloseTo(16, 0);
    await expect(height('Narrator')).toBeCloseTo(26, 0);
    // The outline is the same size as the soft fill: the soft look carries the same 1 px border, transparent.
    await expect(height('Changed')).toBeCloseTo(22, 0);
    await expect(getComputedStyle(canvas.getByText('Misread')).borderTopLeftRadius).toBe('3px');
    await expect(getComputedStyle(canvas.getByText('Pickup')).textTransform).toBe('none');
    await expect(getComputedStyle(canvas.getByText('Misread')).textTransform).toBe('uppercase');
    // Every board cell is the same 58×20 block, whatever its label says.
    for (const label of ['✓', '3 open']) {
      const box = canvas.getByText(label).getBoundingClientRect();
      await expect(box.height).toBeCloseTo(20, 0);
      await expect(box.width).toBeCloseTo(58, 0);
    }
    await expect(getComputedStyle(canvas.getByText('3 open')).textTransform).toBe('none');
  },
};

// The dark sets' warn-outline "TO VERIFY" and "CHANGED" badges.
export const Outline: Story = { args: { tone: 'warning', label: 'To verify', look: 'outline' } };

// A summary chip that opens what it counts (the Production board's stage suggestions): a button in THE pill's shape.
export const OpensWhatItCounts: Story = {
  args: { tone: 'accent', label: '2 chapters have a suggestion', onClick: fn() },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '2 chapters have a suggestion' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const WithIcon: Story = {
  args: {
    tone: 'danger',
    label: 'REC · P&R',
    icon: <span aria-hidden="true">●</span>,
  },
};

// The dense-list mark (PRD "Could"): no visible text, named for a screen reader.
export const Dot: Story = { args: { tone: 'success', label: 'This chapter: pass', variant: 'dot' } };

export const AllTonesAsDots: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {TONES.map((tone) => (
        <StatusBadge key={tone} tone={tone} label={tone} variant="dot" />
      ))}
      <BareDot color="var(--character)" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const tone of TONES) {
      await expect(canvas.getByRole('img', { name: tone })).toBeVisible();
    }
  },
};

export const AnnouncesItsLabel: Story = {
  args: { tone: 'progress', label: 'Delivery check 7 / 12' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Delivery check 7 / 12')).toBeVisible();
  },
};
