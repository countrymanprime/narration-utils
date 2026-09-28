import type { Meta, StoryObj } from '@storybook/react-vite';
import { faFileLines, faGear, faHouse, faWaveSquare } from '@fortawesome/free-solid-svg-icons';
import { expect, fn, userEvent, within } from 'storybook/test';
import { NavButton } from './NavButton';

const MANUSCRIPT_REQUIRED_REASON = 'Import a manuscript to unlock this page.';

// The `medium-rail` class is what switches NavButton into its centred, square
// icon-only styling, so every icon-only story has to sit inside it, as in AppShell.
const railFrame = 'medium-rail flex w-14 flex-none flex-col gap-1 border-r border-[var(--border)] bg-[var(--surface)] p-2';

const meta = {
  title: 'Primitives/NavButton',
  component: NavButton,
  args: { active: false, icon: faHouse, children: 'Home', onClick: fn() },
  argTypes: { icon: { control: false } },
} satisfies Meta<typeof NavButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inactive: Story = {};
// The current page: accent-strong text on --accent-soft (ADR 0059, ADR 0635), exposed as aria-current="page".
export const Active: Story = { args: { active: true } };
export const Disabled: Story = { args: { icon: faFileLines, children: 'Manuscript', disabled: true, disabledReason: MANUSCRIPT_REQUIRED_REASON } };

export const IconOnly: Story = {
  args: { active: true, iconOnly: true },
  decorators: [
    (Story) => (
      <aside className={railFrame} aria-label="Primary navigation">
        <Story />
      </aside>
    ),
  ],
};

// The full-width sidebar (>= 1400px in AppShell): icon + label, unavailable pages disabled. The 216 px rail and its 8 px
// inset, as mock 01 draws it (mock-fidelity-primitives-and-components.prd.md Phase 8, ADR 0635).
export const Sidebar: Story = {
  render: () => (
    <nav className="flex w-54 flex-col gap-[0.1875rem] border-r border-[var(--border)] bg-[var(--surface)] p-2" aria-label="Primary navigation">
      <NavButton active icon={faHouse} onClick={fn()}>
        Production
      </NavButton>
      <NavButton active={false} icon={faFileLines} onClick={fn()} disabled disabledReason={MANUSCRIPT_REQUIRED_REASON}>
        Script
      </NavButton>
      <NavButton active={false} icon={faWaveSquare} onClick={fn()} count={14}>
        Proof
      </NavButton>
      <NavButton active={false} icon={faGear} onClick={fn()}>
        Settings
      </NavButton>
    </nav>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const current = canvas.getByRole('button', { name: 'Production' });
    const box = current.getBoundingClientRect();
    // Measured in the atlas's browser; jsdom (stories.test.tsx) lays nothing out, so there NavButton.test.tsx pins the classes.
    if (box.height === 0) return;
    await expect(box.height).toBeCloseTo(34, 0);
    await expect(box.width).toBeCloseTo(199, 0);
    const proof = canvas.getByRole('button', { name: 'Proof, 14' }).getBoundingClientRect();
    await expect(proof.top - box.top).toBeCloseTo(74, 0);
    const style = getComputedStyle(current);
    await expect(style.fontSize).toBe('13px');
    await expect(style.borderTopLeftRadius).toBe('7px');
    await expect(style.textTransform).toBe('uppercase');
  },
};

// The count slot (visual audit SH5): mock 01's "14" beside Proof, a 16 px pill at the item's end. Nothing passes a count
// until a page's count has data behind it.
export const WithCount: Story = { args: { icon: faWaveSquare, children: 'Proof', count: 14 } };
export const ActiveWithCount: Story = { args: { active: true, icon: faWaveSquare, children: 'Proof', count: 3 } };

// The collapsed rail (medium widths in AppShell): the label becomes the aria-label and the tooltip.
export const IconRail: Story = {
  render: () => (
    <aside className={railFrame} aria-label="Primary navigation">
      <NavButton active icon={faHouse} onClick={fn()} iconOnly>
        Home
      </NavButton>
      <NavButton active={false} icon={faFileLines} onClick={fn()} iconOnly disabled disabledReason={MANUSCRIPT_REQUIRED_REASON}>
        Manuscript
      </NavButton>
      <NavButton active={false} icon={faWaveSquare} onClick={fn()} iconOnly disabled disabledReason={MANUSCRIPT_REQUIRED_REASON}>
        Proofing
      </NavButton>
      <NavButton active={false} icon={faGear} onClick={fn()} iconOnly>
        Settings
      </NavButton>
    </aside>
  ),
};

export const ClickInvokesHandler: Story = {
  args: { children: 'Settings', icon: faGear },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Settings' }));
    await expect(args.onClick).toHaveBeenCalledOnce();
  },
};

export const ActiveMarksCurrentPage: Story = {
  args: { active: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  },
};

export const InactiveIsNotCurrent: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  },
};

// A disabled button is not actionable. Its wrapper, not the button, is what
// keyboard users reach, and that wrapper carries the reason as a tooltip.
export const DisabledIsInert: Story = {
  args: { icon: faFileLines, children: 'Manuscript', disabled: true, disabledReason: MANUSCRIPT_REQUIRED_REASON },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Manuscript' })).toBeDisabled();
    await userEvent.tab();
    await expect(within(document.body).getByRole('tooltip')).toHaveTextContent(MANUSCRIPT_REQUIRED_REASON);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

// Icon-only buttons have no visible label, so the tooltip must appear at once on
// keyboard focus rather than after the hover delay.
export const IconOnlyShowsLabelOnFocus: Story = {
  args: { iconOnly: true },
  decorators: IconOnly.decorators,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole('button', { name: 'Home' }).focus();
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent('Home');
  },
};
