// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeLabel, gestureKeys, ShortcutSheet } from './ShortcutSheet';
import { COMMAND_CATALOG } from '../../input/commands.catalog';
import { gesture } from '../../input/gestures';
import { CommandRouter } from '../../input/router';
import { useCommand } from '../../input/useCommand';

describe('codeLabel', () => {
  it('strips the Key/Digit prefix a letter or number code carries', () => {
    expect(codeLabel('KeyR')).toBe('R');
    expect(codeLabel('Digit7')).toBe('7');
  });

  it('names an arrow, bracket and browser-navigation code', () => {
    expect(codeLabel('ArrowLeft')).toBe('←');
    expect(codeLabel('BracketRight')).toBe(']');
    expect(codeLabel('BrowserForward')).toBe('Browser Forward');
  });

  it('falls back to the raw code for one it does not know', () => {
    expect(codeLabel('F13')).toBe('F13');
  });
});

describe('gestureKeys', () => {
  it("puts a keyboard gesture's modifiers before its key", () => {
    expect(gestureKeys(gesture('keyboard', 'KeyS', ['Ctrl']))).toEqual(['Ctrl', 'S']);
  });

  it('falls back to the serialised gesture for a source with no key caps yet (MIDI, HID)', () => {
    expect(gestureKeys(gesture('midi', 'cc/1/64'))).toEqual(['midi:cc/1/64']);
  });
});

afterEach(cleanup);

function renderSheet(onClose = vi.fn(), onShowAll = vi.fn()) {
  render(
    <CommandRouter>
      <ShortcutSheet onClose={onClose} onShowAll={onShowAll} />
    </CommandRouter>,
  );
  return { onClose, onShowAll };
}

describe('ShortcutSheet', () => {
  it('is a modal dialog named "Keyboard shortcuts"', () => {
    renderSheet();
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('lists every catalog command, discoverable the same way the Settings category will (Success Metrics)', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    for (const command of COMMAND_CATALOG) expect(within(dialog).getByText(command.label)).toBeTruthy();
  });

  it('groups commands under a heading per scope, skipping a scope with no commands', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByRole('heading', { name: 'Global' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Page' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: 'Booth' })).toBeTruthy();
    // Nothing in the catalog is scoped `dialog` yet, so that heading is left out rather than drawn empty.
    expect(within(dialog).queryByRole('heading', { name: 'Dialog' })).toBeNull();
  });

  it("shows Back's three default gestures as key caps, and reading.toggle's Space", () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const backRow = within(dialog).getByText('Back').closest('li')!;
    expect(within(backRow).getByRole('img', { name: 'Alt + ←' })).toBeTruthy();
    expect(within(backRow).getByRole('img', { name: 'Browser Back' })).toBeTruthy();
    const readingRow = within(dialog).getByText('Play or pause reading').closest('li')!;
    expect(within(readingRow).getByRole('img', { name: 'Space' })).toBeTruthy();
  });

  it('shows its own "?" shortcut as Shift plus the physical Slash key, not the character it types', () => {
    renderSheet();
    const row = screen.getByText('Show keyboard shortcuts').closest('li')!;
    expect(within(row).getByRole('img', { name: 'Shift + /' })).toBeTruthy();
  });

  it('closes from the header Close button and calls onClose', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape', () => {
    const { onClose } = renderSheet();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('"Show all shortcuts" calls onShowAll, the link to Settings', () => {
    const { onShowAll } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Show all shortcuts' }));
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it("claims the router's dialog scope while open, so nav.back (global) no longer matches until it closes (ADR 0361 decision 4)", () => {
    function Harness({ backHandler }: { backHandler: () => void }) {
      const [open, setOpen] = useState(true);
      useCommand('nav.back', backHandler);
      return open ? <ShortcutSheet onClose={() => setOpen(false)} onShowAll={() => {}} /> : null;
    }
    const backHandler = vi.fn();
    render(
      <CommandRouter>
        <Harness backHandler={backHandler} />
      </CommandRouter>,
    );
    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    expect(backHandler).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    expect(backHandler).toHaveBeenCalledOnce();
  });
});
