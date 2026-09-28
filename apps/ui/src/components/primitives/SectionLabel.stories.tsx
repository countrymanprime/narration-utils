import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Heading } from './Heading';
import { Panel } from './Panel';
import { SectionLabel } from './SectionLabel';

// The eyebrow over a section, a KPI tile or a nav group: Barlow Condensed 11 px, semibold, uppercase, tracked 0.1 em,
// muted (benchmark mock 05's "BOOK CONSISTENCY · RMS BY CHAPTER" and "OUTPUTS", ADR 0640). `as` picks the element.
const meta = {
  title: 'Primitives/SectionLabel',
  component: SectionLabel,
  args: { children: 'Outputs' },
} satisfies Meta<typeof SectionLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// Mock 05's delivery package: the label over the outputs list inside a card.
export const InACard: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Master & QC" />
      <Panel title="Delivery package · ACX">
        <SectionLabel as="h3" className="mb-2">
          Outputs
        </SectionLabel>
        <p className="text-sm">ACX/ 14 MP3 · {'{nn} {Title}'}.mp3</p>
        <SectionLabel as="h3" className="mt-4 mb-2">
          Book consistency · RMS by chapter
        </SectionLabel>
        <p className="text-sm">Spread 0.8 dB across the book.</p>
      </Panel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const label = within(canvasElement).getByRole('heading', { level: 3, name: 'Outputs' });
    if (canvasElement.getBoundingClientRect().width === 0) return;
    await document.fonts.ready;
    const style = getComputedStyle(label);
    await expect(style.fontSize).toBe('11px');
    await expect(style.fontWeight).toBe('600');
    await expect(style.fontFamily).toContain('Barlow Condensed');
    await expect(style.textTransform).toBe('uppercase');
    await expect(style.letterSpacing).toBe('1.1px');
  },
};

// The label over a fieldset is its legend.
export const AsLegend: Story = {
  render: () => (
    <fieldset>
      <SectionLabel as="legend" className="mb-1">
        Build packages for
      </SectionLabel>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" defaultChecked /> ACX
      </label>
    </fieldset>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('group', { name: 'Build packages for' })).toBeVisible();
  },
};

// A long label wraps rather than pushing the page sideways.
export const LongLabelWraps: Story = {
  args: { children: 'Tracks that are not chapters, including the pickup tracks recorded after the session closed (14)', as: 'div' },
};
