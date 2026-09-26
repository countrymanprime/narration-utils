import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Kbd } from './Kbd';
import { Toolbar, ToolbarButton } from './Toolbar';

function CommandButton({ label, keys }: { label: string; keys: string[] }) {
  return (
    <ToolbarButton
      render={
        <Button variant="ghost" className="flex-col gap-1 px-3 py-1.5 text-[0.7rem] normal-case">
          <Kbd keys={keys} />
          {label}
        </Button>
      }
    />
  );
}

const meta = {
  title: 'Primitives/Toolbar',
  component: Toolbar,
  args: { label: 'Booth commands', children: null },
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

// The booth mock's command bar (studio-ui-primitives.prd.md mock 03): Space, R, ⌫, F and P, each a `Kbd`-labelled button.
export const BoothCommandBar: Story = {
  render: (args) => (
    <Toolbar {...args}>
      <CommandButton label="Play" keys={['Space']} />
      <CommandButton label="Record" keys={['R']} />
      <CommandButton label="Erase" keys={['⌫']} />
      <CommandButton label="Full screen" keys={['F']} />
      <CommandButton label="Punch" keys={['P']} />
    </Toolbar>
  ),
};

export const WithAnIconOnlyButton: Story = {
  render: (args) => (
    <Toolbar {...args}>
      <ToolbarButton render={<Button>Resolve</Button>} />
      <ToolbarButton render={<Button>Waive</Button>} />
      <ToolbarButton render={<IconButton label="Go to in REAPER">R</IconButton>} />
    </Toolbar>
  ),
};

export const VerticalRail: Story = {
  args: { label: 'Rail', orientation: 'vertical', className: 'w-32' },
  render: (args) => (
    <Toolbar {...args}>
      <ToolbarButton render={<Button>Last punch</Button>} />
      <ToolbarButton render={<Button>Voices</Button>} />
      <ToolbarButton render={<Button>Coming up</Button>} />
    </Toolbar>
  ),
};

// An item taken out of the rotation (`focusableWhenDisabled={false}`) is skipped by the arrow keys and by Home/End.
export const WithADisabledCommand: Story = {
  render: (args) => (
    <Toolbar {...args}>
      <ToolbarButton render={<Button>Play</Button>} />
      <ToolbarButton disabled focusableWhenDisabled={false} render={<Button>Record</Button>} />
      <ToolbarButton render={<Button>Full screen</Button>} />
    </Toolbar>
  ),
};

// One tab stop; the arrow keys rove focus along the strip and Home/End jump to the ends (Base UI's toolbar part gives
// the roving tabindex and the arrows; Home/End is this primitive's own addition, since the installed part has none).
export const ArrowsHomeAndEndMoveFocus: Story = {
  render: (args) => (
    <Toolbar {...args}>
      <ToolbarButton render={<Button>Play</Button>} />
      <ToolbarButton render={<Button>Record</Button>} />
      <ToolbarButton render={<Button>Erase</Button>} />
      <ToolbarButton render={<Button>Full screen</Button>} />
    </Toolbar>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [play, record, erase, full] = canvas.getAllByRole('button');
    await expect(play).toHaveAttribute('tabindex', '0');
    await expect(record).toHaveAttribute('tabindex', '-1');
    await expect(erase).toHaveAttribute('tabindex', '-1');
    await expect(full).toHaveAttribute('tabindex', '-1');

    await userEvent.tab();
    await expect(play).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await expect(record).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    await expect(full).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect(erase).toHaveFocus();

    await userEvent.keyboard('{End}');
    await expect(full).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect(play).toHaveFocus();
  },
};

export const IsNamedAsAToolbar: Story = {
  render: (args) => (
    <Toolbar {...args}>
      <ToolbarButton render={<Button>Play</Button>} />
    </Toolbar>
  ),
  play: async ({ canvasElement }) => {
    const toolbar = within(canvasElement).getByRole('toolbar', { name: 'Booth commands' });
    await expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');
  },
};
