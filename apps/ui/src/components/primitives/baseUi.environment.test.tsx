// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Checkbox } from '@base-ui/react/checkbox';
import { Collapsible } from '@base-ui/react/collapsible';
import { Dialog } from '@base-ui/react/dialog';
import { Drawer } from '@base-ui/react/drawer';
import { Field } from '@base-ui/react/field';
import { Menu } from '@base-ui/react/menu';
import { Popover } from '@base-ui/react/popover';
import { Progress } from '@base-ui/react/progress';
import { Switch } from '@base-ui/react/switch';
import { Toggle } from '@base-ui/react/toggle';
import { Tooltip } from '@base-ui/react/tooltip';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The library-level facts the primitives rely on, checked under jsdom (ADR 0047). Base UI 1.8.0 needs no polyfill in
// src/test-setup.ts; if a minor bump changes that, or changes the focus and dismissal behaviour the wrappers are built
// on, this file is where it shows first, with the library's own parts and not one of ours in the way. It goes when the
// wrappers' own tests cover every part it uses.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The app mounts a dialog conditionally (`{open && <ConfirmDialog />}`), so the dialog opens on mount and the parent
// removes it: there is never a Trigger.
function ConditionalDialog({ alert = false }: { alert?: boolean }) {
  const [open, setOpen] = useState(false);
  const Family = alert ? AlertDialog : Dialog;
  return (
    <div>
      <button onClick={() => setOpen(true)}>opener</button>
      {open && (
        <Family.Root open onOpenChange={(next) => !next && setOpen(false)}>
          <Family.Portal>
            <Family.Backdrop />
            <Family.Viewport>
              <Family.Popup>
                <Family.Title>Title</Family.Title>
                <button onClick={() => setOpen(false)}>close it</button>
              </Family.Popup>
            </Family.Viewport>
          </Family.Portal>
        </Family.Root>
      )}
    </div>
  );
}

describe('Base UI dialogs under jsdom', () => {
  it('returns focus to the opener when Escape closes a conditionally mounted dialog', async () => {
    const user = userEvent.setup();
    render(<ConditionalDialog />);
    await user.click(screen.getByText('opener'));
    expect(await screen.findByRole('dialog', { name: 'Title' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('returns focus to the opener when the parent unmounts the dialog', async () => {
    const user = userEvent.setup();
    render(<ConditionalDialog />);
    await user.click(screen.getByText('opener'));
    await user.click(await screen.findByText('close it'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByText('opener'));
  });

  it('hides the page behind a modal from assistive technology while it is open', async () => {
    const user = userEvent.setup();
    render(<ConditionalDialog />);
    await user.click(screen.getByText('opener'));
    await screen.findByRole('dialog');
    // Role queries skip aria-hidden content, so the opener is in the DOM but not in the accessibility tree.
    expect(screen.queryByRole('button', { name: 'opener' })).toBeNull();
    expect(screen.getByRole('button', { name: 'opener', hidden: true }).closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('gives AlertDialog the alertdialog role', async () => {
    const user = userEvent.setup();
    render(<ConditionalDialog alert />);
    await user.click(screen.getByText('opener'));
    expect(await screen.findByRole('alertdialog', { name: 'Title' })).toBeTruthy();
  });
});

describe('Base UI tooltips, popovers and fields under jsdom', () => {
  const tooltip = (
    <Tooltip.Provider delay={1000}>
      <Tooltip.Root>
        <Tooltip.Trigger>trigger</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner>
            <Tooltip.Popup>Tip text</Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );

  it('shows a tooltip on keyboard focus and hides it on Escape', async () => {
    const user = userEvent.setup();
    render(tooltip);
    await user.tab();
    expect(await screen.findByText('Tip text')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Tip text')).toBeNull();
  });

  it('shows a tooltip only after the hover delay', async () => {
    vi.useFakeTimers();
    render(tooltip);
    fireEvent.mouseEnter(screen.getByText('trigger'));
    fireEvent.mouseMove(screen.getByText('trigger'));
    await act(() => vi.advanceTimersByTimeAsync(900));
    expect(screen.queryByText('Tip text')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(screen.getByText('Tip text')).toBeTruthy();
  });

  it('opens a popover on click and closes it on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Popover.Root>
        <Popover.Trigger aria-label="More information">i</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner>
            <Popover.Popup aria-label="More information">Popover text</Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>,
    );
    await user.click(screen.getByRole('button', { name: 'More information' }));
    expect(await screen.findByText('Popover text')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Popover text')).toBeNull();
  });

  it('wires an invalid textarea to its error and hint through Field', () => {
    render(
      <Field.Root invalid>
        <Field.Label>Notes</Field.Label>
        <Field.Control render={<textarea />} />
        <Field.Description>A hint</Field.Description>
        <Field.Error match>An error</Field.Error>
      </Field.Root>,
    );
    const control = screen.getByRole('textbox', { name: 'Notes' });
    expect(control.tagName).toBe('TEXTAREA');
    expect(control.getAttribute('aria-invalid')).toBe('true');
    const described = (control.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(expect.arrayContaining(['A hint', 'An error']));
  });

  it('renders an indeterminate progress bar with no value', () => {
    render(
      <Progress.Root value={null}>
        <Progress.Track>
          <Progress.Indicator />
        </Progress.Track>
      </Progress.Root>,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
  });
});

describe('the remaining Base UI widgets under jsdom', () => {
  it('closes a modal drawer on Escape', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(true);
      return open ? (
        <Drawer.Root open modal onOpenChange={(next) => !next && setOpen(false)}>
          <Drawer.Portal>
            <Drawer.Backdrop />
            <Drawer.Viewport>
              <Drawer.Popup>
                <Drawer.Title>Drawer title</Drawer.Title>
                <button>inside</button>
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        </Drawer.Root>
      ) : null;
    }
    render(<Harness />);
    expect(await screen.findByRole('dialog', { name: 'Drawer title' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a menu, moves with the arrow keys and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Menu.Root>
        <Menu.Trigger>Categories</Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner>
            <Menu.Popup>
              <Menu.Item>Alpha</Menu.Item>
              <Menu.Item>Beta</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>,
    );
    await user.click(screen.getByText('Categories'));
    expect(await screen.findAllByRole('menuitem')).toHaveLength(2);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Alpha');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('exposes checkbox, switch and toggle state to assistive technology', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Checkbox.Root aria-label="Agree">
          <Checkbox.Indicator>x</Checkbox.Indicator>
        </Checkbox.Root>
        <Switch.Root aria-label="Notifications">
          <Switch.Thumb />
        </Switch.Root>
        <Toggle aria-label="Bold">B</Toggle>
      </div>,
    );
    for (const [role, name] of [
      ['checkbox', 'Agree'],
      ['switch', 'Notifications'],
    ] as const) {
      const control = screen.getByRole(role, { name });
      expect(control.getAttribute('aria-checked')).toBe('false');
      await user.click(control);
      expect(control.getAttribute('aria-checked')).toBe('true');
    }
    const toggle = screen.getByRole('button', { name: 'Bold' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows and hides a collapsible panel', async () => {
    const user = userEvent.setup();
    render(
      <Collapsible.Root>
        <Collapsible.Trigger>Details</Collapsible.Trigger>
        <Collapsible.Panel>Panel text</Collapsible.Panel>
      </Collapsible.Root>,
    );
    const trigger = screen.getByRole('button', { name: 'Details' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Panel text')).toBeTruthy();
  });
});
