import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Tab, TabList, TabPanel, Tabs } from './Tabs';

const CATEGORIES = ['All', 'Characters', 'Places'];

function CategoryTabs({ activation, onChange }: { activation: 'manual' | 'automatic'; onChange: (value: string) => void }) {
  const [value, setValue] = useState('All');
  return (
    <Tabs
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    >
      <TabList label="Story Bible categories" activation={activation}>
        {CATEGORIES.map((name) => (
          <Tab key={name} value={name}>
            {name} · 3
          </Tab>
        ))}
      </TabList>
      <TabPanel value={value} className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
        Entries in {value}
      </TabPanel>
    </Tabs>
  );
}

function SideTabs() {
  const [value, setValue] = useState('appearance');
  return (
    <Tabs value={value} onChange={setValue} orientation="vertical" className="grid max-w-md grid-cols-[10rem_1fr] gap-4">
      <TabList label="Settings categories" variant="sidebar">
        <Tab value="appearance">Appearance</Tab>
        <Tab value="proofing">Proofing</Tab>
        <Tab value="daw">DAW</Tab>
      </TabList>
      <TabPanel value={value} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
        {value} settings
      </TabPanel>
    </Tabs>
  );
}

const meta = {
  title: 'Primitives/Tabs',
  component: Tabs,
  args: { value: 'All', onChange: fn(), children: null },
  render: (args) => <CategoryTabs activation="manual" onChange={args.onChange} />,
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Underline: Story = {};
export const Sidebar: Story = { render: () => <SideTabs /> };

// The strip is a tablist of tabs, the selected one is `aria-selected` and controls the panel, which the tab names.
export const RolesAndLinks: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('tablist', { name: 'Story Bible categories' })).toBeVisible();
    const all = canvas.getByRole('tab', { name: 'All · 3' });
    await expect(all).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByRole('tab', { name: 'Places · 3' })).toHaveAttribute('aria-selected', 'false');
    await expect(canvas.getByRole('tabpanel', { name: 'All · 3' })).toHaveTextContent('Entries in All');
  },
};

// Arrow keys move focus along the strip and Enter selects (the default, for a choice that asks a question first).
export const ArrowsMoveAndEnterSelects: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole('tab', { name: 'All · 3' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('tab', { name: 'Characters · 3' })).toHaveFocus();
    await expect(args.onChange).not.toHaveBeenCalled();
    await userEvent.keyboard('{Enter}');
    await expect(args.onChange).toHaveBeenLastCalledWith('Characters');
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('Entries in Characters');
  },
};

// With automatic activation the choice follows focus (a filter that only redraws a list).
export const AutomaticActivationFollowsFocus: Story = {
  render: (args) => <CategoryTabs activation="automatic" onChange={args.onChange} />,
  play: async ({ args, canvasElement }) => {
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect(args.onChange).toHaveBeenLastCalledWith('Places');
    await expect(within(canvasElement).getByRole('tabpanel')).toHaveTextContent('Entries in Places');
  },
};

// Measured on the benchmark mocks (mock-fidelity-primitives-and-components.prd.md Phase 5, ADR 0625): the selected
// underline tab's text is `--accent-strong`, distinct from an unselected tab's `--text-muted`, with a 2 px underline.
export const MeasuredShapes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selected = canvas.getByRole('tab', { name: 'All · 3' });
    const unselected = canvas.getByRole('tab', { name: 'Places · 3' });
    // Measured in the atlas's browser; jsdom (stories.test.tsx) loads no stylesheet — `getBoundingClientRect` stays 0 there
    // (jsdom does no layout at all), which the height check below uses as the gate, the same one StatusBadge.stories.tsx
    // uses. `getComputedStyle` is not a safe gate here: jsdom still answers it with non-zero initial values.
    if (selected.getBoundingClientRect().height === 0) return;
    const selectedStyle = getComputedStyle(selected);
    await expect(selectedStyle.borderBottomWidth).toBe('2px');
    await expect(selectedStyle.textTransform).toBe('uppercase');
    await expect(selectedStyle.color).not.toBe(getComputedStyle(unselected).color);
  },
};

// The sidebar tab's selected fill moved onto the `--accent-soft` token (Phase 0b), so it is a solid colour, not a
// translucent `color-mix` over whatever sits behind it.
export const SidebarMeasuredFill: Story = {
  render: () => <SideTabs />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const selected = canvas.getByRole('tab', { name: 'Appearance' });
    if (selected.getBoundingClientRect().height === 0) return;
    await expect(getComputedStyle(selected).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  },
};

export const SidebarUsesTheVerticalArrows: Story = {
  render: () => <SideTabs />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole('tab', { name: 'Appearance' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect(canvas.getByRole('tab', { name: 'Proofing' })).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(canvas.getByRole('tabpanel')).toHaveTextContent('proofing settings');
  },
};
