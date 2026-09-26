import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { CompactShell } from './CompactShell';

// The narrow companion panel: a header (title, status, one action) above stacked sections. Captured at the atlas's
// narrow (390 px) viewport, the width the host's own always-on-top window is expected to sit at.
const meta = {
  title: 'Primitives/CompactShell',
  component: CompactShell,
  args: { title: 'Companion' },
} satisfies Meta<typeof CompactShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TitleOnly: Story = {
  args: {
    children: <p className="text-sm">Following Chapter 7. Open the full app for the manuscript and Story Bible.</p>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'Companion' })).toBeVisible();
    await expect(canvas.getByRole('main')).toBeVisible();
  },
};

// The DAW companion mock (studio-ui-primitives.prd.md #07): a status chip beside the title, "Full app" as the one
// action, and the mock's stacked sections (script, note at playhead, pickups, hotkeys, this chapter) built from
// existing primitives (`Panel`) rather than anything CompactShell itself renders.
export const WithStatusAndAction: Story = {
  args: {
    status: <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent-strong)]">Following playhead</span>,
    action: (
      <button type="button" className="text-sm text-[var(--accent)] underline">
        Full app
      </button>
    ),
    children: (
      <>
        <section aria-label="Script" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <h2 className="text-sm font-semibold">Script</h2>
          <p className="mt-1 text-[var(--text-muted)]">…the lamplighter passed beneath her window, calling the hour as he always did.</p>
        </section>
        <section aria-label="Note at playhead" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <h2 className="text-sm font-semibold">Note at playhead</h2>
          <p className="mt-1 text-[var(--text-muted)]">Misread: “lamplighter” read as “lamp lighter”.</p>
        </section>
        <section aria-label="Pickups" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <h2 className="text-sm font-semibold">Pickups</h2>
          <p className="mt-1 text-[var(--text-muted)]">3 open in this chapter.</p>
        </section>
      </>
    ),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Following playhead')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Full app' })).toBeVisible();
  },
};

// A book title long enough to force a wrap must stay inside the header, never push it sideways.
export const LongTitleWraps: Story = {
  args: {
    title: 'The Very Long Running Series: Book Three, The Reckoning (Companion)',
    status: <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-xs text-[var(--accent-strong)]">Following playhead</span>,
    children: <p className="text-sm">Body</p>,
  },
};

export const FullAppActionIsClickable: Story = {
  args: {
    action: (
      <button type="button" className="text-sm text-[var(--accent)] underline">
        Full app
      </button>
    ),
    children: <p className="text-sm">Body</p>,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Full app' }));
  },
};
