import { faWaveSquare } from '@fortawesome/free-solid-svg-icons';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Button } from './Button';
import { CapabilityGate, type CapabilityEntry } from './CapabilityGate';
import { IconButton } from './IconButton';
import { NavButton } from './NavButton';

// The badge's fill is a tint checked against a surface, the same backdrop every real caller gives it (StatusBadge.stories.tsx),
// never the bare page background the atlas's own decorator otherwise renders a story on.
function OnSurface({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-[var(--surface)] p-6">{children}</div>;
}

const SUPPORTED: CapabilityEntry = { level: 'supported', available: true };
const EXPERIMENTAL_ON: CapabilityEntry = {
  level: 'experimental',
  available: true,
  message: 'Experimental: switched on in Settings',
};
const NOT_YET_AVAILABLE: CapabilityEntry = {
  level: 'not_yet_available',
  available: false,
  message: 'REAPER is not running',
};
const UNSUPPORTED: CapabilityEntry = { level: 'unsupported', available: false };

const meta = {
  title: 'Primitives/CapabilityGate',
  component: CapabilityGate,
  // Every story below overrides both with `render`; this default only satisfies the required props for the type.
  args: { capability: SUPPORTED, children: <Button onClick={fn()}>Example</Button> },
} satisfies Meta<typeof CapabilityGate>;

export default meta;
type Story = StoryObj<typeof meta>;

// `supported` and available: the gate adds nothing, so any control composes, including one, like `NavButton`, that
// the gate never has to reach inside.
export const SupportedIsUnchanged: Story = {
  render: () => (
    <CapabilityGate capability={SUPPORTED}>
      <NavButton active={false} icon={faWaveSquare} onClick={fn()}>
        Open in REAPER
      </NavButton>
    </CapabilityGate>
  ),
};

// `experimental` and available (Q4): the control stays live, but an "Experimental" badge and the host's message
// (as its description) mark it out.
export const ExperimentalIsEnabledWithABadge: Story = {
  render: () => (
    <OnSurface>
      <CapabilityGate capability={EXPERIMENTAL_ON}>
        <IconButton label="Apply FX chain" onClick={fn()}>
          FX
        </IconButton>
      </CapabilityGate>
    </OnSurface>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Apply FX chain' });
    await expect(button).not.toHaveAttribute('aria-disabled');
    await expect(canvas.getByText('Experimental')).toBeVisible();
    const describedBy = button.getAttribute('aria-describedby');
    await expect(describedBy).toBeTruthy();
    await expect(document.getElementById(describedBy as string)).toHaveTextContent('Experimental: switched on in Settings');
  },
};

// Not yet available (Q3's default): disabled with the host's message, not hidden - the narrator learns the control
// exists and why it is off.
export const NotYetAvailableIsDisabledWithTheMessage: Story = {
  render: () => (
    <CapabilityGate capability={NOT_YET_AVAILABLE}>
      <Button onClick={fn()}>Punch from here</Button>
    </CapabilityGate>
  ),
  // Tabs onto the gated control and checks its description: the tab stop is the control itself, not a wrapper, so
  // the narrator hears its name first and then why it is off.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Punch from here' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).not.toBeDisabled();
    const describedBy = button.getAttribute('aria-describedby');
    await expect(document.getElementById(describedBy as string)).toHaveTextContent('REAPER is not running');
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('REAPER is not running');
    await button.click();
  },
};

// A missing message falls back to the control's own name (its `label`) rather than inventing a reason.
export const UnsupportedFallsBackToTheControlsOwnName: Story = {
  render: () => (
    <CapabilityGate capability={UNSUPPORTED}>
      <IconButton label="Add take FX" onClick={fn()}>
        FX
      </IconButton>
    </CapabilityGate>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Add take FX' });
    const describedBy = button.getAttribute('aria-describedby');
    await expect(document.getElementById(describedBy as string)).toHaveTextContent('Add take FX');
  },
};

// Q3's opt-out: a caller may hide an unsupported control instead of showing it disabled.
export const UnsupportedCanBeHiddenInstead: Story = {
  render: () => (
    <CapabilityGate capability={UNSUPPORTED} hideWhenUnsupported>
      <Button onClick={fn()}>Build packages</Button>
    </CapabilityGate>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).toBeNull();
  },
};

const punchHandler = fn();

export const PressNeverReachesTheHandler: Story = {
  render: () => (
    <CapabilityGate capability={NOT_YET_AVAILABLE}>
      <Button onClick={punchHandler}>Punch from here</Button>
    </CapabilityGate>
  ),
  play: async ({ canvasElement }) => {
    const button = within(canvasElement).getByRole('button', { name: 'Punch from here' });
    // A native click on an aria-disabled (not disabled) button still reaches the DOM, so the gate itself, not the
    // browser, has to stop it from reaching the handler underneath.
    await userEvent.click(button);
    await expect(punchHandler).not.toHaveBeenCalled();
  },
};
