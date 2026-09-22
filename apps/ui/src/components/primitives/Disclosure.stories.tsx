import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Disclosure } from './Disclosure';
import { Tooltip } from './Tooltip';

function Group({ startOpen = false, withAside = false }: { startOpen?: boolean; withAside?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <Disclosure
      title="Reference material"
      summary="2 sections"
      open={open}
      onOpenChange={setOpen}
      className="w-80 border-t border-[var(--border)]"
      aside={
        withAside ? (
          <Tooltip label="About reference material" text="Excluded from audiobook totals and Proofing. Still readable in the manuscript." />
        ) : undefined
      }
    >
      <ul className="space-y-1 pb-2 pl-5 text-sm">
        <li>Glossary</li>
        <li>Characters</li>
      </ul>
    </Disclosure>
  );
}

const meta = {
  title: 'Primitives/Disclosure',
  component: Disclosure,
  args: { title: 'Reference material', open: false, onOpenChange: fn(), children: null },
  render: () => <Group />,
} satisfies Meta<typeof Disclosure>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};
export const Expanded: Story = { render: () => <Group startOpen /> };
export const WithInfoIcon: Story = { render: () => <Group startOpen withAside /> };

// The whole row is the button: Enter opens it, its name carries the summary, and the panel is not in the page while it is closed.
export const OpensAndClosesWithTheKeyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('Glossary')).toBeNull();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    const button = canvas.getByRole('button', { name: 'Reference material 2 sections' });
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByText('Glossary')).toBeVisible();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.queryByText('Glossary')).toBeNull();
  },
};
