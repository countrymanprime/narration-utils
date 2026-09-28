import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Button } from './Button';
import { Heading } from './Heading';
import { InsetCard } from './InsetCard';
import { Panel } from './Panel';

// A card inside a card: a 1 px frame, a 6 px radius and 12 px inside, on the surface (ADR 0640). `tone` colours the frame, `fill` lifts
// it onto `--surface-2`, and `dashed` marks a placeholder.
const meta = {
  title: 'Primitives/InsetCard',
  component: InsetCard,
  args: { children: 'The latest run did not find this again. It is kept here with your decision so nothing you decided is lost.' },
} satisfies Meta<typeof InsetCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    if (canvasElement.getBoundingClientRect().width === 0) return;
    const style = getComputedStyle(within(canvasElement).getByText(/The latest run/));
    await expect(style.paddingTop).toBe('12px');
    await expect(style.paddingLeft).toBe('12px');
    await expect(style.borderTopLeftRadius).toBe('6px');
    await expect(style.borderTopWidth).toBe('1px');
  },
};

export const Filled: Story = { args: { fill: true } };

export const Dashed: Story = { args: { dashed: true, children: 'No pickups on this chapter yet.' } };

// The tones: a problem, a warning, and a match that needs you.
export const Tones: Story = {
  render: () => (
    <div className="space-y-2 text-sm">
      <InsetCard tone="danger" role="alert">
        The chapter track could not be linked.
      </InsetCard>
      <InsetCard tone="warn">Two tracks have the same name.</InsetCard>
      <InsetCard tone="accent" className="flex flex-wrap items-center justify-between gap-2">
        <span>Chapter 4 · The Rabbit Sends in a Little Bill</span>
        <Button variant="ghost">Link</Button>
      </InsetCard>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toBeVisible();
  },
};

// A list of inset cards inside a panel, as the take reads and the chapter track candidates are.
export const ListInAPanel: Story = {
  render: () => (
    <div className="space-y-4">
      <Heading title="Proof" />
      <Panel title="Reads">
        <ul className="space-y-2 text-sm">
          {['Take 1 · 0:00–0:41', 'Take 2 · 0:41–1:20', 'Take 3 · 1:20–2:02'].map((read) => (
            <InsetCard as="li" key={read}>
              {read}
            </InsetCard>
          ))}
        </ul>
      </Panel>
    </div>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('listitem')).toHaveLength(3);
  },
};

// A named section drawn as an inset card.
export const NamedSection: Story = {
  render: () => (
    <InsetCard as="section" aria-label="Online dictionary" className="space-y-2 text-sm">
      <p>Look words up in an online dictionary when the local one has no answer.</p>
    </InsetCard>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Online dictionary' })).toBeVisible();
  },
};
