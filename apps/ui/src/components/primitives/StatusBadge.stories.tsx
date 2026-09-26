import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { applyResolvedTheme } from '../../theme/theme';
import { StatusBadge, type StatusTone } from './StatusBadge';

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
      {(['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'experimental'] as StatusTone[]).map((tone) => (
        <StatusBadge key={tone} tone={tone} label={tone} variant="dot" />
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const tone of ['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'experimental']) {
      await expect(canvas.getByRole('img', { name: tone })).toBeVisible();
    }
  },
};

// FocusShell's booth surface (Q1): "the booth is a place, not a preference", regardless of the narrator's light/dark
// choice - but everything the booth block does not itself override (the tone colours a badge draws) falls through
// from dark specifically (tokenContrast.ts layers the block over dark, never light; ADR 0362). A real FocusShell will
// have to pin dark itself to honour that "regardless of preference" promise, so this story does the same rather than
// trusting whichever theme the atlas's global toolbar happens to be on for this capture - the booth attribute only
// repaints what renders inside its own element, so that element also needs its own background fill.
function BoothDemo() {
  applyResolvedTheme('dark');
  return (
    <div data-surface="booth" className="flex flex-col items-start gap-2 bg-[var(--bg)] p-4">
      {(['neutral', 'info', 'progress', 'success', 'warning', 'danger', 'experimental'] as StatusTone[]).map((tone) => (
        <StatusBadge key={tone} tone={tone} label={tone} />
      ))}
    </div>
  );
}

export const Booth: Story = { render: () => <BoothDemo /> };

export const AnnouncesItsLabel: Story = {
  args: { tone: 'progress', label: 'Delivery check 7 / 12' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Delivery check 7 / 12')).toBeVisible();
  },
};
