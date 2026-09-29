// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { ApplyFxDialog, fxDoneMessage, type FxRequest } from './ApplyFxDialog';

afterEach(cleanup);

const plugin: FxRequest = { kind: 'plugin', firstToken: 2, lastToken: 4, passage: 'beginning to get' };

function renderDialog(request: FxRequest, api: ReturnType<typeof createMockApi> = createMockApi()) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  render(
    <ApiProvider api={api}>
      <ApplyFxDialog chapterId="chapter-1" request={request} onDone={onDone} onClose={onClose} />
    </ApiProvider>,
  );
  return { onDone, onClose, api };
}

describe('ApplyFxDialog', () => {
  it('lists REAPER’s effects, says what will happen to the passage, and sends only after Add effect', async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    const send = vi
      .spyOn(api, 'workspaceAddTakeFX')
      .mockResolvedValue({ outcome: 'added', plugin: 'ReaEQ (Cockos)', itemGuid: '{A}', takeGuid: '{B}', splits: 2 });
    const { onDone } = renderDialog(plugin, api);
    const select = await screen.findByRole('combobox', { name: 'Effect' });
    expect(screen.getByText('beginning to get')).toBeTruthy();
    expect(screen.getByText(/one Undo in REAPER takes back the cuts and the effect together/)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    await user.selectOptions(select, 'ReaEQ (Cockos)');
    await user.click(screen.getByRole('button', { name: 'Add effect' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('chapter-1', 2, 4, 'ReaEQ (Cockos)'));
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('Added ReaEQ (Cockos)'));
  });

  it('shows what REAPER refused, keeps the dialog open and reports nothing done', async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    vi.spyOn(api, 'workspaceAddTakeFX').mockResolvedValue({ outcome: 'refused', reason: 'crosses_items', message: 'This passage crosses two REAPER items.' });
    const { onDone, onClose } = renderDialog(plugin, api);
    await screen.findByRole('combobox', { name: 'Effect' });
    await user.click(screen.getByRole('button', { name: 'Add effect' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This passage crosses two REAPER items.');
    expect(onDone).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('puts a chain on the chapter’s track, chosen from the chains REAPER lists', async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    const send = vi.spyOn(api, 'workspaceApplyFXChain').mockResolvedValue({ outcome: 'applied', chain: 'Vocal Warmth.RfxChain', track: '{T}', added: 2 });
    const { onDone } = renderDialog({ kind: 'chain' }, api);
    const select = await screen.findByRole('combobox', { name: 'FX chain' });
    expect(screen.getByText(/changes how everything on that track sounds/)).toBeTruthy();
    await user.selectOptions(select, 'Vocal Warmth.RfxChain');
    await user.click(screen.getByRole('button', { name: 'Put chain on track' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('chapter-1', 'Vocal Warmth.RfxChain'));
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('Vocal Warmth.RfxChain'));
  });

  it('lists the narrator’s favourites first', async () => {
    const api = createMockApi();
    vi.spyOn(api, 'settingsForScope').mockResolvedValue({
      DAW: [
        { key: 'fx_favourites', label: '', kind: 'tags', choices: [], value: '', isSet: true, effectiveValue: 'ReaEQ (Cockos)', effectiveSource: 'project' },
      ],
    });
    renderDialog(plugin, api);
    const select = await screen.findByRole('combobox', { name: 'Effect' });
    const labels = Array.from(select.querySelectorAll('option')).map((option) => option.textContent);
    expect(labels[0]).toBe('★ ReaEQ (Cockos)');
    expect(labels).toContain('JS: De-esser');
  });

  it('says so when REAPER cannot be asked', async () => {
    renderDialog(plugin, createMockApi({}, { reaper: 'standalone' }));
    expect((await screen.findByRole('alert')).textContent).toContain('REAPER was not asked');
  });

  it('words a success for one cut, no cut and a chain', () => {
    expect(fxDoneMessage({ outcome: 'added', plugin: 'X', itemGuid: 'a', takeGuid: 'b', splits: 0 })).toContain('nothing was split');
    expect(fxDoneMessage({ outcome: 'added', plugin: 'X', itemGuid: 'a', takeGuid: 'b', splits: 1 })).toContain('once');
    expect(fxDoneMessage({ outcome: 'applied', chain: 'C.RfxChain', track: 't', added: 1 })).toContain('1 effect)');
  });
});
