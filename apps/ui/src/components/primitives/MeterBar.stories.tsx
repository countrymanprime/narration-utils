import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { STATUS_COLOR, STATUS_LABELS, STATUS_ORDER } from '../manuscript/ChapterNav';
import { Button } from './Button';
import { MeterBar, type MeterSegment } from './MeterBar';

type Status = (typeof STATUS_ORDER)[number];
type StatusPercents = Partial<Record<Status, number>>;

// Same shape AudiobookEstimatePanel builds: one segment per status that has any
// chapters, in the order the caller chooses.
function segmentsFor(percents: StatusPercents, order: readonly Status[]): MeterSegment[] {
  return order
    .filter((status) => (percents[status] ?? 0) > 0)
    .map((status) => ({
      key: status,
      widthPercent: percents[status] ?? 0,
      color: STATUS_COLOR[status],
      tooltip: `${STATUS_LABELS[status]}: ${percents[status]}% of the manuscript`,
    }));
}

// ADR 0006: the chapter-progress bar reads like a device-storage indicator, so the
// caller reverses STATUS_ORDER and finished work sits on the left.
const FINISHED_FIRST = [...STATUS_ORDER].reverse();
const MID_PRODUCTION: StatusPercents = { finalized: 40, proofing: 15, editing: 10, recording: 5, not_started: 30 };

function segmentWidths(canvasElement: HTMLElement): number[] {
  return Array.from(canvasElement.querySelectorAll<HTMLElement>('.progress-segment')).map((segment) => Number.parseFloat(segment.style.flexBasis));
}

const meta = {
  title: 'Primitives/MeterBar',
  component: MeterBar,
  args: { label: 'Chapter progress', segments: segmentsFor(MID_PRODUCTION, FINISHED_FIRST) },
} satisfies Meta<typeof MeterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

// The default: finished work on the left, not-started on the right.
export const PartialFinishedFirst: Story = {};

// The chronological order the shared STATUS_ORDER constant keeps for the legend
// and the status <select>. The component has no opinion; this is what an
// un-reversed call site would draw.
export const PartialChronological: Story = { args: { segments: segmentsFor(MID_PRODUCTION, STATUS_ORDER) } };

// No segments at all: only the empty track is drawn.
export const Empty: Story = { args: { segments: [] } };

export const NothingStarted: Story = { args: { segments: segmentsFor({ not_started: 100 }, FINISHED_FIRST) } };

// One segment that does not reach 100%: the track shows through as the remainder.
export const SingleSegmentPartial: Story = { args: { segments: segmentsFor({ finalized: 25 }, FINISHED_FIRST) } };

export const Full: Story = { args: { segments: segmentsFor({ finalized: 100 }, FINISHED_FIRST) } };

// A one-chapter sliver next to a big block must stay visible, not collapse to nothing.
export const ThinSegments: Story = {
  args: { segments: segmentsFor({ finalized: 92.3, proofing: 0.8, editing: 0.8, recording: 0.8, not_started: 5.3 }, FINISHED_FIRST) },
};

// As the recording-progress row appears on Home: caption, count, bar, then a
// legend so colour is never the only way to read the segments.
export const WithCaptionAndLegend: Story = {
  render: (args) => (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
          Recording progress
        </span>
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]" style={{ color: 'var(--text-muted)' }}>
          9 of 22 chapters finalized
        </span>
      </div>
      <MeterBar {...args} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        {STATUS_ORDER.map((status) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className="size-2 flex-none rounded-full" style={{ background: STATUS_COLOR[status] }} />
            {STATUS_LABELS[status]}
          </span>
        ))}
      </div>
    </div>
  ),
};

// A screen reader hears the label and every segment's breakdown; the bar is one image, not a row of unnamed boxes.
export const IsNamedByItsLabelAndSegments: Story = {
  play: async ({ args, canvasElement }) => {
    const meter = within(canvasElement).getByRole('img', { name: /^Chapter progress: / });
    for (const segment of args.segments) await expect(meter).toHaveAccessibleName(expect.stringContaining(segment.tooltip));
  },
};

export const SegmentsRenderInCallerOrder: Story = {
  play: async ({ canvasElement }) => {
    await expect(segmentWidths(canvasElement)).toEqual([40, 15, 10, 5, 30]);
  },
};

export const ChronologicalOrderIsTheMirrorImage: Story = {
  args: { segments: segmentsFor(MID_PRODUCTION, STATUS_ORDER) },
  play: async ({ canvasElement }) => {
    await expect(segmentWidths(canvasElement)).toEqual([30, 5, 10, 15, 40]);
  },
};

export const EmptyDrawsNoSegments: Story = {
  args: { segments: [] },
  play: async ({ canvasElement }) => {
    await expect(segmentWidths(canvasElement)).toEqual([]);
  },
};

function LiveMeter() {
  const [finalizedChapters, setFinalizedChapters] = useState(9);
  const totalChapters = 20;
  const finalized = (finalizedChapters / totalChapters) * 100;
  const segments = segmentsFor({ finalized, not_started: 100 - finalized }, FINISHED_FIRST);
  return (
    <div className="space-y-3">
      <MeterBar label="Chapter progress" segments={segments} />
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {finalizedChapters} of {totalChapters} chapters finalized
      </p>
      <Button onClick={() => setFinalizedChapters((count) => Math.min(totalChapters, count + 1))}>Finalize next chapter</Button>
    </div>
  );
}

// Each segment animates its flex-basis over 300ms (docs/design/motion-and-animation.md).
// jsdom runs no transitions, so this asserts the target widths; the easing
// itself can only be judged in a browser.
export const UpdatesWhenProgressChanges: Story = {
  render: () => <LiveMeter />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(segmentWidths(canvasElement)).toEqual([45, 55]);
    await userEvent.click(canvas.getByRole('button', { name: 'Finalize next chapter' }));
    await expect(canvas.getByText('10 of 20 chapters finalized')).toBeVisible();
    await expect(segmentWidths(canvasElement)).toEqual([50, 50]);
  },
};
