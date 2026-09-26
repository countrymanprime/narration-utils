import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { FocusShell } from './FocusShell';

// FocusShell is the full-screen booth layout: a status bar, an optional side rail, the main region and a command bar,
// each a named landmark. It composes whatever it is given - these stories stand in for the primitives that will
// eventually fill each slot (Kbd, StatusBadge, LevelMeter, Toolbar) with plain markup, since a primitive imports none
// of them.
const meta = {
  title: 'Primitives/FocusShell',
  component: FocusShell,
  parameters: { layout: 'fullscreen' },
  args: {
    status: (
      <>
        <span className="rounded-full bg-[var(--danger)]/20 px-2 py-0.5 text-xs font-semibold text-[var(--danger-text)]">REC · P&amp;R</span>
        <span className="text-[var(--text-muted)]">Room −64.1 dB</span>
        <span className="ml-auto text-[var(--text-muted)]">REAPER · take 4</span>
      </>
    ),
    commands: (
      <div className="flex items-center gap-4 text-sm">
        <span>Space record</span>
        <span>R restart</span>
        <span>⌫ delete</span>
        <span>F flag</span>
        <span>P punch</span>
        <span className="ml-auto">Esc exit booth</span>
      </div>
    ),
    children: (
      <div className="mx-auto max-w-2xl space-y-3 text-[1.1rem] leading-relaxed">
        <p>The lighthouse keeper counted the ships that never came, and the ones that did.</p>
        <p>She had not always been alone on the point. Once there had been a whole family of keepers.</p>
      </div>
    ),
  },
} satisfies Meta<typeof FocusShell>;

export default meta;
type Story = StoryObj<typeof meta>;

// The booth mock (mock 03): status, script, rail and commands together on the booth surface.
export const Booth: Story = {
  args: {
    rail: (
      <div className="space-y-4 text-sm">
        <div>
          <h2 className="font-semibold text-[var(--text-muted)]">Last punch</h2>
          <p>Ch 7, p. 12</p>
        </div>
        <div>
          <h2 className="font-semibold text-[var(--text-muted)]">Voices in scene</h2>
          <p>Keeper, Gull</p>
        </div>
        <div>
          <h2 className="font-semibold text-[var(--text-muted)]">Coming up</h2>
          <p>A storm, three pages ahead</p>
        </div>
        <div>
          <h2 className="font-semibold text-[var(--text-muted)]">This session</h2>
          <p>42 min · 6 takes</p>
        </div>
      </div>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('region', { name: 'Status' })).toBeVisible();
    await expect(canvas.getByRole('complementary', { name: 'Rail' })).toBeVisible();
    await expect(canvas.getByRole('main')).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'Commands' })).toBeVisible();
  },
};

// No rail: a narrower booth session (no session context to show), main takes the full width.
export const WithoutRail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('complementary')).toBeNull();
    await expect(canvas.getByRole('main')).toBeVisible();
  },
};

// The rail is given content but collapsed: the feature owns the toggle and its state, this shell just stops rendering
// the landmark while collapsed.
export const RailCollapsed: Story = {
  args: {
    rail: <p>Session details</p>,
    railCollapsed: true,
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('complementary')).toBeNull();
  },
};
