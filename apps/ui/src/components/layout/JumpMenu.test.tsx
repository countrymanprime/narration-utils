// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayHost } from '../../overlay/OverlayHost';
import { createOverlayService, type OverlayService } from '../../overlay/overlayService';
import { registerCommandProvider, type ProvidedCommand } from '../../input/commandProviders';
import { COMMAND_CATALOG, type CommandDescriptor } from '../../input/commands.catalog';
import { defaultKeymap } from '../../input/keymap';
import { registerSearchSource } from '../../registries/search';
import { openJumpMenu } from './JumpMenu';
import { useGoToCommands } from './useGoToCommands';

let service: OverlayService;
let cleanups: Array<() => void> = [];
beforeEach(() => {
  service = createOverlayService();
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  cleanup();
  cleanups.forEach((fn) => fn());
  cleanups = [];
});

const provide = (...commands: ProvidedCommand[]) => cleanups.push(registerCommandProvider(() => commands));
const command = (id: string, group: string, label: string, run: () => void = () => {}): ProvidedCommand => ({ id, group, label, run });
const GO_TO = [command('t.prod', 'Go to', 'Go to Production'), command('t.proof', 'Go to', 'Go to Proof'), command('t.set', 'Go to', 'Go to Settings')];

function mount(options: { catalog?: readonly CommandDescriptor[]; runCommand?: (id: string) => void } = {}) {
  const catalog = options.catalog ?? COMMAND_CATALOG;
  render(
    <main tabIndex={-1}>
      <button>Opener</button>
      <OverlayHost service={service} />
    </main>,
  );
  const open = () => openJumpMenu({ service, catalog, keymap: defaultKeymap(catalog, false), runCommand: options.runCommand ?? (() => {}) });
  return { open };
}
const field = () => screen.getByRole('combobox');
const names = () => screen.queryAllByRole('option').map((option) => option.textContent ?? '');

describe('JumpMenu', () => {
  it('opens-on-a-short-list: one row per group, at most ten, and Go to Production waits for its group', () => {
    provide(...GO_TO);
    const { open } = mount();
    act(() => void open());
    expect(screen.getAllByRole('option').length).toBeLessThanOrEqual(10);
    expect(screen.getAllByRole('option', { name: /^Go to/ })).toHaveLength(1);
    // One row per group: the catalogue's groups plus the provider's, none repeated.
    const rows = names();
    expect(rows).toHaveLength(new Set(rows).size);
    expect(rows.some((row) => row.startsWith('Zoom'))).toBe(true);
    expect(rows.some((row) => row.startsWith('View'))).toBe(true);
    expect(screen.queryByText('Go to Production')).toBeNull();
  });

  it('a-group-opens-to-its-own-commands-and-back-returns: All commands and Backspace on an empty field both return', async () => {
    provide(...GO_TO);
    const { open } = mount();
    act(() => void open());
    const user = userEvent.setup();
    await user.click(screen.getByRole('option', { name: /^Go to/ }));
    expect(screen.getByText('Go to Production')).toBeTruthy();
    await user.click(screen.getByRole('option', { name: /All commands/ }));
    expect(screen.queryByText('Go to Production')).toBeNull();
    await user.click(screen.getByRole('option', { name: /^Go to/ }));
    await user.keyboard('{Backspace}');
    expect(screen.queryByText('Go to Production')).toBeNull();
    expect(screen.getByRole('option', { name: /^Go to/ })).toBeTruthy();
  });

  it('typing-searches-everything-and-running-a-command-closes-the-menu', async () => {
    const run = vi.fn();
    provide(command('t.proof', 'Go to', 'Go to Proof', run), command('t.prod', 'Go to', 'Go to Production'));
    const { open } = mount();
    act(() => void open());
    const user = userEvent.setup();
    await user.type(field(), 'proof');
    expect(screen.queryByText('Go to Production')).toBeNull();
    await user.click(screen.getByRole('option', { name: /Go to Proof/ }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('greater-than-lists-commands-only: a leading > hides search-source hits', async () => {
    provide(command('t.proof', 'Go to', 'Go to Proof'));
    cleanups.push(registerSearchSource((term) => [{ group: 'Script', title: `The proof of ${term}`, run: () => {} }]));
    const { open } = mount();
    act(() => void open());
    const user = userEvent.setup();
    await user.type(field(), 'proof');
    expect(screen.getByRole('option', { name: /The proof of proof/ })).toBeTruthy();
    await user.clear(field());
    await user.type(field(), '>proof');
    expect(screen.queryByRole('option', { name: /The proof of/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Go to Proof/ })).toBeTruthy();
  });

  it('keyboard-drives-the-list: arrows move the active option, Enter runs it, Escape closes and focus returns to the opener', async () => {
    const run = vi.fn();
    provide(command('t.a', 'Go to', 'Go to Alpha'), command('t.b', 'Go to', 'Go to Beta', run));
    const { open } = mount();
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    act(() => void open());
    const user = userEvent.setup();
    await user.type(field(), 'go to');
    const [alpha, beta] = screen.getAllByRole('option');
    expect(field().getAttribute('aria-activedescendant')).toBe(alpha?.id);
    await user.keyboard('{ArrowDown}');
    expect(field().getAttribute('aria-activedescendant')).toBe(beta?.id);
    await user.keyboard('{ArrowUp}');
    expect(field().getAttribute('aria-activedescendant')).toBe(alpha?.id);
    await user.keyboard('{ArrowDown}');
    expect(field().getAttribute('aria-activedescendant')).toBe(beta?.id);
    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => void open());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('static-and-provided-commands-both-show: the catalogue row draws its bound key as caps from the given keymap', async () => {
    const fake: CommandDescriptor = {
      id: 'fake.row',
      label: 'Fake action',
      scope: 'global',
      defaults: [{ source: 'keyboard', code: 'KeyJ', modifiers: ['Mod'] }],
      group: 'Go to',
      surfaces: ['jumpMenu'],
    };
    provide(command('t.ch3', 'Go to', 'Go to chapter 3'));
    const runCommand = vi.fn();
    const { open } = mount({ catalog: [fake], runCommand });
    act(() => void open());
    const user = userEvent.setup();
    await user.click(screen.getByRole('option', { name: /^Go to/ }));
    const row = screen.getByRole('option', { name: /Fake action/ });
    expect(screen.getByRole('option', { name: /Go to chapter 3/ })).toBeTruthy();
    expect(within(row).getByText('Ctrl')).toBeTruthy();
    expect(within(row).getByText('J')).toBeTruthy();
    await user.click(row);
    expect(runCommand).toHaveBeenCalledWith('fake.row');
  });

  it('chapters are found by their formatted name once a hook has registered them', async () => {
    function Provide() {
      useGoToCommands({ pages: [{ id: 'proof', label: 'Proof' }], chapters: [{ id: 'c3', title: 'Chapter 3', subtitle: 'The Road' }], go: () => {} });
      return null;
    }
    const { open } = mount();
    render(<Provide />);
    act(() => void open());
    await userEvent.setup().type(field(), 'ch 3');
    expect(names()).toEqual([expect.stringContaining('Go to Chapter 3 — The Road')]);
  });

  it('search-sources-group-and-isolate: hits show under their group with the sub line, a short term asks nobody, a throwing source is skipped', async () => {
    const asked = vi.fn();
    cleanups.push(
      registerSearchSource(() => {
        throw new Error('index not ready');
      }),
      registerSearchSource((term) => (asked(term), [{ group: 'Script', title: 'The storm broke', sub: 'Chapter 2, line 4', run: () => {} }])),
    );
    const { open } = mount();
    act(() => void open());
    const user = userEvent.setup();
    await user.type(field(), 's');
    expect(asked).not.toHaveBeenCalled();
    await user.type(field(), 'torm');
    const hit = screen.getByRole('option', { name: /The storm broke/ });
    expect(hit.textContent).not.toContain('Script');
    expect(hit.textContent).toContain('Chapter 2, line 4');
    // The group is a heading before the run, not part of the row.
    expect(within(screen.getByRole('listbox')).getByText('Script').getAttribute('role')).toBe('presentation');
  });

  it('shows Nothing matches when nothing does', async () => {
    const { open } = mount();
    act(() => void open());
    await userEvent.setup().type(field(), 'zzzzzz');
    expect(screen.getByText('Nothing matches')).toBeTruthy();
    expect(field().getAttribute('aria-activedescendant')).toBeNull();
  });

  it('jump-menu-dismisses-on-outside-click: a press on the backdrop closes it, a press inside does not', async () => {
    provide(...GO_TO);
    const { open } = mount();
    const user = userEvent.setup();
    act(() => void open());
    await user.click(field());
    expect(screen.getByRole('dialog', { name: 'Jump menu' })).toBeTruthy();
    await user.click(document.querySelector('[data-dialog-backdrop]') as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Jump menu' })).toBeNull();
  });

  it('open-is-synchronous: the first list is in the DOM in the same act as the open call', () => {
    provide(...GO_TO);
    const { open } = mount();
    act(() => void open());
    expect(screen.getByRole('dialog', { name: 'Jump menu' })).toBeTruthy();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('jump-menu-uses-group-headings-and-no-header: no Close button, a group count at the right, a key cap for a command', async () => {
    provide(command('t.ch3', 'Go to', 'Go to chapter 3'));
    const { open } = mount();
    act(() => void open());
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    expect(screen.getAllByRole('presentation').some((el) => el.textContent === 'Commands')).toBe(true);
    expect(screen.getByRole('option', { name: /^Go to/ }).textContent).toMatch(/\d+ ›$/);
  });

  it('jump-menu-keeps-the-field-focused-and-named', async () => {
    provide(...GO_TO);
    const { open } = mount();
    act(() => void open());
    await vi.waitFor(() => expect(document.activeElement).toBe(field()));
    expect(screen.getByRole('dialog', { name: 'Jump menu' })).toBeTruthy();
    expect(field().getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id);
  });

  // A page the project cannot use yet is listed off with its reason, and choosing it runs nothing.
  it('lists an off command with its reason, marks it unavailable, and runs nothing on Enter or a click while the menu stays open', async () => {
    const run = vi.fn();
    const off: ProvidedCommand = { ...command('t.proof', 'Go to', 'Go to Proof', run), disabledReason: 'Import a manuscript to unlock this page.' };
    provide(command('t.prod', 'Go to', 'Go to Production'), off);
    const { open } = mount();
    act(() => void open());
    const user = userEvent.setup();
    await user.type(field(), 'go to');
    const row = screen.getByRole('option', { name: /^Go to Proof/ });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('Import a manuscript to unlock this page.');
    expect(screen.getByRole('option', { name: /^Go to Production/ }).getAttribute('aria-disabled')).toBeNull();
    await user.click(row);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Jump menu' })).toBeTruthy();
  });
});
