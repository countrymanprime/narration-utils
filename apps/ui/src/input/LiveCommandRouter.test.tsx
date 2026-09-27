// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/ApiContext';
import { createDawMock } from '../api/dawMock';
import type { DawTransport } from '../api/contracts/daw';
import type { NarrationApi } from '../types';
import type { CommandDescriptor } from './commands.catalog';
import { gesture } from './gestures';
import type { GestureEvent, InputSource } from './InputSource';
import type { Keymap } from './keymap';
import { LiveCommandRouter } from './LiveCommandRouter';
import { useCommand } from './useCommand';

function fakeSource(): InputSource & { emit: (event: Partial<GestureEvent> & Pick<GestureEvent, 'gesture'>) => void } {
  let listener: ((event: GestureEvent) => void) | undefined;
  return {
    subscribe(onGesture) {
      listener = onGesture;
      return () => {
        listener = undefined;
      };
    },
    emit(event) {
      listener?.({ target: null, preventDefault: () => {}, ...event });
    },
  };
}

const NOISY_COMMAND: CommandDescriptor = { id: 'test.noisy', label: 'Noisy test', scope: 'global', noisy: true, defaults: [] };

function Registrar({ id, onFire }: { id: string; onFire: () => void }) {
  useCommand(id, onFire);
  return null;
}

describe('LiveCommandRouter', () => {
  it('fires a noisy command while stopped, and suppresses it once daw_transport_changed reports recording (Phase 10)', () => {
    let onUpdate: ((state: DawTransport) => void) | undefined;
    const base = createDawMock({ daw: 'REAPER', transport: { playing: false, recording: false } });
    const api: Pick<NarrationApi, 'subscribeDawTransport'> = {
      subscribeDawTransport: (fn) => {
        onUpdate = fn;
        return base.subscribeDawTransport(fn);
      },
    };
    const source = fakeSource();
    const onFire = vi.fn();
    const keymap: Keymap = { [NOISY_COMMAND.id]: [gesture('keyboard', 'KeyP')] };

    render(
      <ApiProvider api={api as NarrationApi}>
        <LiveCommandRouter source={source} catalog={[NOISY_COMMAND]} keymap={keymap}>
          <Registrar id={NOISY_COMMAND.id} onFire={onFire} />
        </LiveCommandRouter>
      </ApiProvider>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP') }));
    expect(onFire).toHaveBeenCalledTimes(1);

    act(() => onUpdate?.({ playing: true, recording: true }));
    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP') }));
    expect(onFire).toHaveBeenCalledTimes(1);

    act(() => onUpdate?.({ playing: false, recording: false }));
    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP') }));
    expect(onFire).toHaveBeenCalledTimes(2);
  });

  it('throws when useCommand is called with no <ApiProvider> ancestor, same as any other DAW-port consumer', () => {
    const source = fakeSource();
    expect(() =>
      render(
        <LiveCommandRouter source={source} catalog={[NOISY_COMMAND]}>
          <Registrar id={NOISY_COMMAND.id} onFire={vi.fn()} />
        </LiveCommandRouter>,
      ),
    ).toThrow('useApi() called outside an <ApiProvider>.');
  });
});
