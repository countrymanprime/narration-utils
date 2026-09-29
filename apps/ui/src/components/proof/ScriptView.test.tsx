// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceToken } from '../../api/contracts/workspace';
import { ScriptView } from './ScriptView';

afterEach(cleanup);

const words = ['Alice', 'was', 'beginning', 'to', 'get', 'very', 'tired'];
const tokens: WorkspaceToken[] = words.map((text, i) => ({ i, p: 'p1', w: i, text, status: 'read', item: 0, start: i, end: i + 1 }));

function renderScript(blocked?: string) {
  const onRequest = vi.fn();
  const onSeekToken = vi.fn();
  render(
    <ScriptView
      paragraphs={[{ id: 'p1', text: words.join(' ') }]}
      tokens={tokens}
      extras={[]}
      currentTokenIndex={undefined}
      isPlaying={false}
      onSeekToken={onSeekToken}
      effects={{ blocked, onRequest }}
    />,
  );
  return { onRequest, onSeekToken };
}

const word = (text: string) => screen.getByRole('button', { name: text });

describe('ScriptView passage selection and effects (edit-and-proof-workspace PRD Phase 9)', () => {
  it('a plain click seeks and selects nothing; Shift+click selects from the last word clicked', async () => {
    const user = userEvent.setup();
    const { onSeekToken } = renderScript();
    await user.click(word('was'));
    expect(onSeekToken).toHaveBeenCalledOnce();
    expect(screen.queryByText(/selected/)).toBeNull();
    await user.keyboard('{Shift>}');
    await user.click(word('get'));
    await user.keyboard('{/Shift}');
    expect(onSeekToken).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toContain('4 words selected');
    expect(word('was').getAttribute('data-selected')).toBe('true');
    expect(word('to').getAttribute('data-selected')).toBe('true');
    expect(word('very').getAttribute('data-selected')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a right click on a word selects it and offers the passage effect, which asks for the confirm step', async () => {
    const user = userEvent.setup();
    const { onRequest } = renderScript();
    fireEvent.contextMenu(word('beginning'));
    await user.click(await screen.findByRole('menuitem', { name: /Add an effect to this passage/ }));
    expect(onRequest).toHaveBeenCalledWith({ kind: 'plugin', firstToken: 2, lastToken: 2, passage: 'beginning' });
  });

  it('a right click inside the selection keeps the passage', async () => {
    const user = userEvent.setup();
    const { onRequest } = renderScript();
    await user.click(word('was'));
    await user.keyboard('{Shift>}');
    await user.click(word('to'));
    await user.keyboard('{/Shift}');
    fireEvent.contextMenu(word('beginning'));
    await user.click(await screen.findByRole('menuitem', { name: /Add an effect to this passage/ }));
    expect(onRequest).toHaveBeenCalledWith({ kind: 'plugin', firstToken: 1, lastToken: 3, passage: 'was beginning to' });
  });

  it('offers the chain for the track without a selection', async () => {
    const user = userEvent.setup();
    const { onRequest } = renderScript();
    fireEvent.contextMenu(screen.getByRole('region', { name: 'Script text' }));
    const passage = await screen.findByRole('menuitem', { name: /Add an effect to this passage/ });
    expect(passage.getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: /Put an FX chain on the chapter/ }));
    expect(onRequest).toHaveBeenCalledWith({ kind: 'chain' });
  });

  it('says why both are off while REAPER is not connected', async () => {
    const { onRequest } = renderScript('REAPER is not running.');
    fireEvent.contextMenu(word('was'));
    const items = await screen.findAllByRole('menuitem');
    expect(items.every((item) => item.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(screen.getAllByText('REAPER is not running.')).toHaveLength(2);
    expect(onRequest).not.toHaveBeenCalled();
  });
});
