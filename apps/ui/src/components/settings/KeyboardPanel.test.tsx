// @vitest-environment jsdom
import { useCallback, useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider, useApi } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi, ScopedSettingField } from '../../types';
import type { Notify } from '../primitives/Toast';
import { KeyboardPanel } from './KeyboardPanel';

afterEach(cleanup);

// The recorder's capture listener is a native document keydown listener (useGestureCapture), not one of RTL's own
// fireEvent helpers, so the state update it makes needs its own act() to flush before the next assertion reads the DOM.
function keydown(init: Partial<KeyboardEventInit> & { code: string }): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

// Mirrors what Settings.tsx does for every category: read `Keymap` out of `settingsForScope('global')` and hand the
// panel its own field plus a reload it can call after saving - so these tests exercise the real save/reload round trip
// through the mock host, not a hand-built fixture.
function Harness({ notify }: { notify: Notify }) {
  const api = useApi();
  const [field, setField] = useState<ScopedSettingField>();
  const load = useCallback(async () => {
    const settings = await api.settingsForScope('global');
    setField(settings.Keymap?.find((entry) => entry.key === 'overrides'));
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!field) return null;
  return <KeyboardPanel overridesField={field} notify={notify} reload={load} />;
}

function renderPanel(overrides: Partial<NarrationApi> = {}) {
  const notify = vi.fn();
  const api = createMockApi(overrides);
  render(
    <ApiProvider api={api}>
      <Harness notify={notify} />
    </ApiProvider>,
  );
  return { api, notify };
}

/** Opens `label`'s recorder (more than one row's Change button shares the accessible name "Change", so the search is
 * scoped to the row containing that label) and returns testing-library bound to the recorder's own `group`. */
async function openRecorderFor(label: string) {
  // getNodeText (dom-testing-library) only reads an element's own direct text-node children, so this finds the label
  // span itself even once a sibling "Plays audio" or "Changed" element joins it - its closest <div> is this row's own
  // header row, which also holds this row's (and only this row's) Change button.
  const heading = await screen.findByText(label);
  const headerRow = heading.closest('div')!;
  fireEvent.click(within(headerRow).getByRole('button', { name: 'Change' }));
  return within(await screen.findByRole('group', { name: `Change "${label}"` }));
}

describe('KeyboardPanel', () => {
  it('groups the catalog by scope, with each hint from the Visual Spec', async () => {
    renderPanel();
    expect(await screen.findByText('Global · anywhere, except while a dialog is open')).toBeTruthy();
    expect(screen.getByText("Page · a chapter's Proof view")).toBeTruthy();
    expect(screen.getByText('Booth · read aloud and the Teleprompter')).toBeTruthy();
    expect(screen.getByText('Back')).toBeTruthy();
    expect(screen.getByText('Play or pause reading')).toBeTruthy();
  });

  it('marks a noisy command as playing audio', async () => {
    renderPanel();
    await screen.findByText('Play or pause the chapter');
    expect(screen.getByText('Plays audio')).toBeTruthy();
  });

  it('shows the "?" hint using the live help.shortcuts binding', async () => {
    renderPanel();
    const hint = (await screen.findByText(/Press/)).closest('p')!;
    expect(within(hint).getByText('Shift')).toBeTruthy();
    expect(within(hint).getByText('/')).toBeTruthy();
  });

  it('opens an inline recorder on Change, with an idle prompt in its live region', async () => {
    renderPanel();
    const group = await openRecorderFor('Play or pause reading');
    expect(group.getByRole('status').textContent).toBe('Press a key or a pedal for "Play or pause reading"…');
  });

  it('captures a key, announces it in the live region, and saves it on Replace', async () => {
    const { api, notify } = renderPanel();
    const saveSettings = vi.spyOn(api, 'saveSettings');
    const group = await openRecorderFor('Play or pause reading');

    keydown({ code: 'PageDown' });
    expect(group.getByRole('status').textContent).toBe('Page Down captured. No other command uses it where reading happens.');
    expect(group.getByRole('button', { name: 'Add as another key' })).toBeTruthy();
    expect(group.getByRole('button', { name: 'Unbind' })).toBeTruthy();

    fireEvent.click(group.getByRole('button', { name: 'Replace' }));
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith('Keymap', 'global', {
        overrides: JSON.stringify({ version: 1, bindings: { 'reading.toggle': ['PageDown'] } }),
      }),
    );
    expect(notify).toHaveBeenCalledWith('Keyboard shortcut saved.');
    await waitFor(() => expect(screen.queryByRole('group', { name: /Change/ })).toBeNull());
    expect(await screen.findByText('Changed')).toBeTruthy();
  });

  it('reports a conflict from findConflicts and hides Add/Unbind/Reset while it stands', async () => {
    renderPanel();
    const group = await openRecorderFor('Next paragraph');

    // ArrowRight is Next word's default (page scope, same as Next paragraph): a real, findConflicts-reported clash.
    keydown({ code: 'ArrowRight' });

    expect(group.getByRole('status').textContent).toBe('→ already runs "Next word".');
    expect(group.getByRole('alert').textContent).toBe(
      'Replace takes it from "Next word", which is then left with no key; you can give it another one afterwards.',
    );
    expect(group.queryByRole('button', { name: 'Add as another key' })).toBeNull();
    expect(group.queryByRole('button', { name: 'Unbind' })).toBeNull();
    expect(group.getByRole('button', { name: 'Try another key' })).toBeTruthy();
  });

  it('Replace during a conflict also removes the gesture from the command it steals it from', async () => {
    const { api } = renderPanel();
    const saveSettings = vi.spyOn(api, 'saveSettings');
    const group = await openRecorderFor('Next paragraph');
    keydown({ code: 'ArrowRight' });

    fireEvent.click(group.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    const [, , values] = saveSettings.mock.calls[0] as [string, string, { overrides: string }];
    const saved = JSON.parse(values.overrides);
    expect(saved.bindings['workspace.paragraph.next']).toEqual(['ArrowRight']);
    expect(saved.bindings['workspace.word.next']).toEqual([]);
  });

  it('Try another key clears the capture and returns to the idle prompt without saving', async () => {
    const { api } = renderPanel();
    const saveSettings = vi.spyOn(api, 'saveSettings');
    const group = await openRecorderFor('Next paragraph');
    keydown({ code: 'ArrowRight' });
    fireEvent.click(group.getByRole('button', { name: 'Try another key' }));

    expect(group.getByRole('status').textContent).toBe('Press a key or a pedal for "Next paragraph"…');
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('Cancel closes the recorder without saving', async () => {
    const { api } = renderPanel();
    const saveSettings = vi.spyOn(api, 'saveSettings');
    const group = await openRecorderFor('Play or pause reading');
    keydown({ code: 'PageDown' });

    fireEvent.click(group.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: /Change/ })).toBeNull();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('a bare Escape cancels the recorder the same way', async () => {
    renderPanel();
    await openRecorderFor('Play or pause reading');
    keydown({ code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group', { name: /Change/ })).toBeNull());
  });

  it('Add as another key keeps the existing gestures and appends the captured one', async () => {
    const { api } = renderPanel();
    const saveSettings = vi.spyOn(api, 'saveSettings');
    const group = await openRecorderFor('Back');
    keydown({ code: 'F13' });

    fireEvent.click(group.getByRole('button', { name: 'Add as another key' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalled());
    const [, , values] = saveSettings.mock.calls[0] as [string, string, { overrides: string }];
    const saved = JSON.parse(values.overrides).bindings['nav.back'] as string[];
    expect(saved).toContain('F13');
    expect(saved).toHaveLength(4);
  });

  it('Unbind removes every gesture and shows Unbound', async () => {
    renderPanel();
    const group = await openRecorderFor('Play or pause reading');
    fireEvent.click(group.getByRole('button', { name: 'Unbind' }));
    expect(await screen.findByText('Unbound')).toBeTruthy();
    expect(screen.getByText('Changed')).toBeTruthy();
  });

  it('the row Reset button restores the catalog default', async () => {
    renderPanel();
    const group = await openRecorderFor('Play or pause reading');
    fireEvent.click(group.getByRole('button', { name: 'Unbind' }));
    await screen.findByText('Unbound');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.queryByText('Unbound')).toBeNull());
    expect(screen.queryByText('Changed')).toBeNull();
  });

  it('Reset all to defaults is disabled with no overrides and clears every override once there is one', async () => {
    renderPanel();
    await screen.findByText('Play or pause reading');
    const resetAll = screen.getByRole('button', { name: 'Reset all to defaults' }) as HTMLButtonElement;
    expect(resetAll.disabled).toBe(true);

    const group = await openRecorderFor('Play or pause reading');
    fireEvent.click(group.getByRole('button', { name: 'Unbind' }));
    await screen.findByText('Unbound');

    expect((screen.getByRole('button', { name: 'Reset all to defaults' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    await waitFor(() => expect(screen.queryByText('Unbound')).toBeNull());
    expect((screen.getByRole('button', { name: 'Reset all to defaults' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an error toast and keeps the recorder open when the save fails', async () => {
    const { notify } = renderPanel({
      saveSettings: async () => {
        throw new Error('the host refused it');
      },
    });
    const group = await openRecorderFor('Play or pause reading');
    keydown({ code: 'PageDown' });
    fireEvent.click(group.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('the host refused it'), 'error'));
    expect(screen.getByRole('group', { name: /Change/ })).toBeTruthy();
  });
});
