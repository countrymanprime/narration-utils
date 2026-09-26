// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Toolbar, ToolbarButton } from './Toolbar';

afterEach(cleanup);

function Example({ onSpace = () => undefined, onRecord = () => undefined }: { onSpace?: () => void; onRecord?: () => void }) {
  return (
    <Toolbar label="Booth commands">
      <ToolbarButton render={<Button onClick={onSpace}>Play</Button>} />
      <ToolbarButton render={<Button onClick={onRecord}>Record</Button>} />
      <ToolbarButton disabled focusableWhenDisabled={false} render={<Button>Erase</Button>} />
      <ToolbarButton render={<IconButton label="Full screen">F</IconButton>} />
    </Toolbar>
  );
}

describe('Toolbar', () => {
  it('is a named toolbar of buttons', () => {
    render(<Example />);
    const toolbar = screen.getByRole('toolbar', { name: 'Booth commands' });
    expect(toolbar.getAttribute('aria-orientation')).toBe('horizontal');
    expect(screen.getAllByRole('button')).toHaveLength(4);
  });

  it('keeps one tab stop: only the first item is in the tab order until focus moves', async () => {
    render(<Example />);
    const [play, record, erase, full] = screen.getAllByRole('button');
    expect(play.tabIndex).toBe(0);
    expect(record.tabIndex).toBe(-1);
    expect(erase.tabIndex).toBe(-1);
    expect(full.tabIndex).toBe(-1);
    await userEvent.setup().tab();
    expect(document.activeElement).toBe(play);
  });

  it('moves focus with the arrow keys, skipping a disabled item that is out of the rotation', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const [play, record, , full] = screen.getAllByRole('button');
    await user.tab();
    expect(document.activeElement).toBe(play);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(record);
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(full);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(record);
  });

  it('Home and End jump to the first and last item', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const [play, record, , full] = screen.getAllByRole('button');
    await user.tab();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(record);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(full);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(play);
  });

  it('moves with Up/Down instead of Left/Right when vertical', async () => {
    const user = userEvent.setup();
    render(
      <Toolbar label="Rail" orientation="vertical">
        <ToolbarButton render={<Button>One</Button>} />
        <ToolbarButton render={<Button>Two</Button>} />
      </Toolbar>,
    );
    const [one, two] = screen.getAllByRole('button');
    await user.tab();
    expect(document.activeElement).toBe(one);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(two);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(one);
  });

  it('presses reach the wrapped button and a disabled one never fires', async () => {
    const onSpace = vi.fn();
    const onRecord = vi.fn();
    render(<Example onSpace={onSpace} onRecord={onRecord} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Record' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onSpace).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Erase' }));
    expect(onRecord).toHaveBeenCalledTimes(1);
  });

  it('names an icon-only button by its own label, unchanged by the toolbar', () => {
    render(<Example />);
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeTruthy();
  });
});
