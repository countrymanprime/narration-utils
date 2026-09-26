import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Timeline, TimelineLane, type TimelineMarker } from './Timeline';

// The proof pass of mock 04: four categories over an eleven-minute pass, plus a decorative waveform backdrop and a
// playhead a few seconds into the recording.
const PROOF_LANES: { label: string; markers: TimelineMarker[] }[] = [
  {
    label: 'Misread',
    markers: [
      { id: 'misread-1', at: 42, tone: 'danger', label: "Misread 'desert' as 'dessert'" },
      { id: 'misread-2', at: 310, tone: 'danger', label: "Skipped 'ostensibly'" },
    ],
  },
  {
    label: 'Pronunciation',
    markers: [{ id: 'pron-1', at: 96, tone: 'warning', label: "Mispronounced 'epitome'" }],
  },
  {
    label: 'Noise',
    markers: [
      { id: 'noise-1', at: 180, tone: 'info', label: 'Chair creak' },
      { id: 'noise-2', at: 512, tone: 'info', label: 'Traffic outside' },
    ],
  },
  {
    label: 'Pacing',
    markers: [{ id: 'pacing-1', at: 420, tone: 'neutral', label: 'Rushed dialogue' }],
  },
];

const DURATION = 660;

function Waveform() {
  const bars = Array.from({ length: 60 }, (_, index) => 8 + ((index * 37) % 20));
  return (
    <svg viewBox="0 0 600 32" preserveAspectRatio="none" className="size-full">
      {bars.map((height, index) => (
        <rect key={index} x={index * 10} y={16 - height / 2} width={6} height={height} className="fill-[var(--border)]" />
      ))}
    </svg>
  );
}

function ProofTimeline({ onActivate }: { onActivate: (id: string) => void }) {
  const [lastActivated, setLastActivated] = useState<string | undefined>();
  return (
    <div className="w-[600px]">
      <Timeline duration={DURATION} playhead={24} backdrop={<Waveform />} className="border border-[var(--border)] p-2">
        {PROOF_LANES.map((lane) => (
          <div key={lane.label} className="grid grid-cols-[6rem_1fr] items-center gap-2">
            <span className="text-[0.75rem] font-semibold tracking-[0.03em] text-[var(--text-muted)] uppercase">{lane.label}</span>
            <TimelineLane
              label={lane.label}
              duration={DURATION}
              markers={lane.markers}
              onActivate={(id) => {
                setLastActivated(id);
                onActivate(id);
              }}
            />
          </div>
        ))}
      </Timeline>
      <p className="mt-2 text-[0.8rem] text-[var(--text-muted)]">{lastActivated ? `Activated: ${lastActivated}` : 'Nothing activated yet'}</p>
    </div>
  );
}

const meta = {
  title: 'Primitives/Timeline',
  component: Timeline,
  args: { duration: DURATION, children: null },
  render: () => <ProofTimeline onActivate={fn()} />,
} satisfies Meta<typeof Timeline>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProofPass: Story = {};

export const NoBackdropOrPlayhead: Story = {
  render: () => (
    <div className="w-[600px]">
      <Timeline duration={DURATION} className="border border-[var(--border)] p-2">
        <TimelineLane label="Pacing" duration={DURATION} markers={PROOF_LANES[3].markers} onActivate={fn()} />
      </Timeline>
    </div>
  ),
};

// Left/Right step focus between markers, Home/End jump to the ends, and Enter activates the focused one.
export const KeyboardStepsAndActivatesMarkers: Story = {
  render: () => <ProofTimeline onActivate={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: "0:42, Misread 'desert' as 'dessert'" })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('button', { name: "5:10, Skipped 'ostensibly'" })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(canvas.getByRole('button', { name: "0:42, Misread 'desert' as 'dessert'" })).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect(canvas.getByRole('button', { name: "5:10, Skipped 'ostensibly'" })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getByText('Activated: misread-2')).toBeVisible();
  },
};

export const EachLaneIsItsOwnGroup: Story = {
  render: () => <ProofTimeline onActivate={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'Misread' })).toBeVisible();
    await expect(canvas.getByRole('group', { name: 'Pronunciation' })).toBeVisible();
    await expect(canvas.getByRole('group', { name: 'Noise' })).toBeVisible();
    await expect(canvas.getByRole('group', { name: 'Pacing' })).toBeVisible();
  },
};
