import type { Meta, StoryObj } from '@storybook/react-vite';
import { faChevronDown, faChevronUp } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from './Collapsible';

function Section({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Audiobook estimate</h2>
        <CollapsibleTrigger label={open ? 'Hide per-chapter breakdown' : 'Show per-chapter breakdown'}>
          <FontAwesomeIcon icon={open ? faChevronUp : faChevronDown} />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel className="mt-2 border-t border-[var(--border)] pt-2 text-sm">
        <p>Chapter 1: 2,100 words</p>
        <p>Chapter 2: 1,850 words</p>
      </CollapsiblePanel>
    </Collapsible>
  );
}

const meta = {
  title: 'Primitives/Collapsible',
  component: Collapsible,
  args: { open: false, onOpenChange: fn(), children: null },
  render: () => <Section />,
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};
export const Expanded: Story = { render: () => <Section startOpen /> };

// The button says what pressing it does, reports aria-expanded, and the panel is not in the page while collapsed.
export const OpensAndClosesWithTheKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/Chapter 1/)).toBeNull();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const button = canvas.getByRole('button', { name: 'Hide per-chapter breakdown' });
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText(/Chapter 1/)).toBeVisible();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.queryByText(/Chapter 1/)).toBeNull();
  },
};
