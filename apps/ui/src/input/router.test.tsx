// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CommandDescriptor } from './commands.catalog';
import { gesture } from './gestures';
import type { GestureEvent, InputSource } from './InputSource';
import type { Keymap } from './keymap';
import { activeScopes, CommandRouter, CommandScope } from './router';
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

describe('activeScopes', () => {
  it('is {page, global} for a plain page', () => {
    expect(activeScopes(['page'])).toEqual(new Set(['page', 'global']));
  });

  it('is {booth, global} for a booth that is a full page, not a dialog (the Teleprompter page)', () => {
    expect(activeScopes(['booth'])).toEqual(new Set(['booth', 'global']));
  });

  it('is {dialog, booth} for a booth inside a dialog (the read-aloud dialog): global and page are both suppressed', () => {
    expect(activeScopes(['dialog', 'booth'])).toEqual(new Set(['dialog', 'booth']));
  });

  it('is {dialog} for a plain dialog with no booth content', () => {
    expect(activeScopes(['dialog'])).toEqual(new Set(['dialog']));
  });

  it('excludes page once a dialog or a booth also claims the surface', () => {
    expect(activeScopes(['page', 'dialog'])).toEqual(new Set(['dialog']));
    expect(activeScopes(['page', 'booth'])).toEqual(new Set(['booth', 'global']));
  });

  it('is {global} with no boundary mounted at all', () => {
    expect(activeScopes([])).toEqual(new Set(['global']));
  });
});

const GLOBAL_COMMAND: CommandDescriptor = { id: 'test.global', label: 'Global test', scope: 'global', defaults: [] };
const PAGE_COMMAND: CommandDescriptor = { id: 'test.page', label: 'Page test', scope: 'page', defaults: [] };
const BOOTH_COMMAND: CommandDescriptor = { id: 'test.booth', label: 'Booth test', scope: 'booth', defaults: [], noisy: true };

function keymapFor(...commands: CommandDescriptor[]): Keymap {
  const keymap: Keymap = {};
  for (const command of commands) keymap[command.id] = [gesture('keyboard', 'KeyP')];
  return keymap;
}

function Registrar({ id, onFire, enabled = true }: { id: string; onFire: (event: { target: EventTarget | null }) => void; enabled?: boolean }) {
  useCommand(id, onFire, enabled);
  return null;
}

describe('CommandRouter', () => {
  it('calls the registered handler and consumes the gesture (preventDefault)', () => {
    const source = fakeSource();
    const onFire = vi.fn();
    const preventDefault = vi.fn();
    render(
      <CommandRouter source={source} catalog={[GLOBAL_COMMAND]} keymap={keymapFor(GLOBAL_COMMAND)}>
        <Registrar id="test.global" onFire={onFire} />
      </CommandRouter>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP'), preventDefault }));

    expect(onFire).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('leaves a gesture no command takes alone (no preventDefault)', () => {
    const source = fakeSource();
    const preventDefault = vi.fn();
    render(
      <CommandRouter source={source} catalog={[GLOBAL_COMMAND]} keymap={keymapFor(GLOBAL_COMMAND)}>
        <Registrar id="test.global" onFire={vi.fn()} />
      </CommandRouter>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyZ'), preventDefault }));

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('leaves a catalogued command alone when nothing has registered it yet', () => {
    const source = fakeSource();
    const preventDefault = vi.fn();
    render(
      <CommandRouter source={source} catalog={[GLOBAL_COMMAND]} keymap={keymapFor(GLOBAL_COMMAND)}>
        {null}
      </CommandRouter>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP'), preventDefault }));

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('does not call the handler while enabled is false, and does not consume the gesture either', () => {
    const source = fakeSource();
    const onFire = vi.fn();
    const preventDefault = vi.fn();
    render(
      <CommandRouter source={source} catalog={[GLOBAL_COMMAND]} keymap={keymapFor(GLOBAL_COMMAND)}>
        <Registrar id="test.global" onFire={onFire} enabled={false} />
      </CommandRouter>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP'), preventDefault }));

    expect(onFire).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('applies the target guard to a modifier-less gesture: an editable target keeps its key', () => {
    const source = fakeSource();
    const onFire = vi.fn();
    render(
      <CommandRouter source={source} catalog={[PAGE_COMMAND]} keymap={keymapFor(PAGE_COMMAND)}>
        <CommandScope kind="page">
          <Registrar id="test.page" onFire={onFire} />
        </CommandScope>
      </CommandRouter>,
    );
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP'), target: input }));

    expect(onFire).not.toHaveBeenCalled();
    input.remove();
  });

  it('does not apply the target guard to a gesture with a modifier held', () => {
    const source = fakeSource();
    const onFire = vi.fn();
    const modified: CommandDescriptor = { ...GLOBAL_COMMAND, id: 'test.modified' };
    render(
      <CommandRouter source={source} catalog={[modified]} keymap={{ [modified.id]: [gesture('keyboard', 'KeyP', ['Alt'])] }}>
        <Registrar id="test.modified" onFire={onFire} />
      </CommandRouter>,
    );
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP', ['Alt']), target: input }));

    expect(onFire).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it('resolves the page-scoped command while on a plain page', () => {
    const source = fakeSource();
    const onFire = vi.fn();
    render(
      <CommandRouter source={source} catalog={[PAGE_COMMAND]} keymap={keymapFor(PAGE_COMMAND)}>
        <CommandScope kind="page">
          <Registrar id="test.page" onFire={onFire} />
        </CommandScope>
      </CommandRouter>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP') }));

    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('does not resolve a page-scoped command while a dialog is open on top', () => {
    const source = fakeSource();
    const onFire = vi.fn();
    render(
      <CommandRouter source={source} catalog={[PAGE_COMMAND]} keymap={keymapFor(PAGE_COMMAND)}>
        <CommandScope kind="page">
          <Registrar id="test.page" onFire={onFire} />
        </CommandScope>
        <CommandScope kind="dialog">
          <div />
        </CommandScope>
      </CommandRouter>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP') }));

    expect(onFire).not.toHaveBeenCalled();
  });

  it('resolves a booth-scoped command on the Teleprompter page (booth with no dialog) alongside global', () => {
    const source = fakeSource();
    const onBooth = vi.fn();
    const onGlobal = vi.fn();
    render(
      <CommandRouter
        source={source}
        catalog={[BOOTH_COMMAND, GLOBAL_COMMAND]}
        keymap={{ [BOOTH_COMMAND.id]: [gesture('keyboard', 'KeyP')], [GLOBAL_COMMAND.id]: [gesture('keyboard', 'KeyQ')] }}
      >
        <CommandScope kind="booth">
          <Registrar id="test.booth" onFire={onBooth} />
        </CommandScope>
        <Registrar id="test.global" onFire={onGlobal} />
      </CommandRouter>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP') }));
    act(() => source.emit({ gesture: gesture('keyboard', 'KeyQ') }));

    expect(onBooth).toHaveBeenCalledTimes(1);
    expect(onGlobal).toHaveBeenCalledTimes(1);
  });

  it('suppresses a noisy command while recording: the gesture is consumed but the handler does not run', () => {
    const source = fakeSource();
    const onFire = vi.fn();
    const preventDefault = vi.fn();
    render(
      <CommandRouter source={source} catalog={[BOOTH_COMMAND]} keymap={keymapFor(BOOTH_COMMAND)} isRecording={() => true}>
        <CommandScope kind="booth">
          <Registrar id="test.booth" onFire={onFire} />
        </CommandScope>
      </CommandRouter>,
    );

    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP'), preventDefault }));

    expect(onFire).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('un-registers a command handler on unmount, so the gesture then passes through', () => {
    const source = fakeSource();
    const onFire = vi.fn();
    function Toggle() {
      const [mounted, setMounted] = useState(true);
      return (
        <CommandRouter source={source} catalog={[GLOBAL_COMMAND]} keymap={keymapFor(GLOBAL_COMMAND)}>
          {mounted && <Registrar id="test.global" onFire={onFire} />}
          <button onClick={() => setMounted(false)}>unmount</button>
        </CommandRouter>
      );
    }
    const { getByRole } = render(<Toggle />);

    act(() => getByRole('button').click());
    const preventDefault = vi.fn();
    act(() => source.emit({ gesture: gesture('keyboard', 'KeyP'), preventDefault }));

    expect(onFire).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('CommandScope', () => {
  it('throws when used outside a CommandRouter', () => {
    expect(() => render(<CommandScope kind="page">child</CommandScope>)).toThrow('<CommandScope> used outside a <CommandRouter>.');
  });
});

describe('useCommand', () => {
  it('throws for an id not in the catalog', () => {
    const source = fakeSource();
    expect(() =>
      render(
        <CommandRouter source={source} catalog={[GLOBAL_COMMAND]} keymap={keymapFor(GLOBAL_COMMAND)}>
          <Registrar id="not.a.command" onFire={vi.fn()} />
        </CommandRouter>,
      ),
    ).toThrow('no such command in commands.catalog.ts');
  });

  it('throws when used outside a CommandRouter', () => {
    expect(() => render(<Registrar id="test.global" onFire={vi.fn()} />)).toThrow('useCommand() called outside a <CommandRouter>.');
  });
});
