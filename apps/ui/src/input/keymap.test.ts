import { describe, expect, it } from 'vitest';
import { COMMAND_CATALOG } from './commands.catalog';
import { bindingsFromKeymap, defaultKeymap, keymapFromBindings } from './keymap';
import { gesture, serializeGesture } from './gestures';

describe('defaultKeymap', () => {
  it('has one entry per catalog command', () => {
    const keymap = defaultKeymap(COMMAND_CATALOG, false);
    expect(Object.keys(keymap).sort()).toEqual(COMMAND_CATALOG.map((command) => command.id).sort());
  });

  it('resolves Mod to Meta on macOS and Ctrl elsewhere for the same command', () => {
    const mac = defaultKeymap(COMMAND_CATALOG, true);
    const other = defaultKeymap(COMMAND_CATALOG, false);
    const macBack = mac['nav.back'].map(serializeGesture);
    const otherBack = other['nav.back'].map(serializeGesture);
    expect(macBack).toContain('Meta+BracketLeft');
    expect(otherBack).toContain('Ctrl+BracketLeft');
  });

  it("today's exact gestures: nav.back and nav.forward", () => {
    const keymap = defaultKeymap(COMMAND_CATALOG, false);
    expect(keymap['nav.back'].map(serializeGesture).sort()).toEqual(['Alt+ArrowLeft', 'BrowserBack', 'Ctrl+BracketLeft'].sort());
    expect(keymap['nav.forward'].map(serializeGesture).sort()).toEqual(['Alt+ArrowRight', 'BrowserForward', 'Ctrl+BracketRight'].sort());
  });

  it("today's exact gestures: the workspace and reading Space", () => {
    const keymap = defaultKeymap(COMMAND_CATALOG, false);
    expect(keymap['workspace.play'].map(serializeGesture)).toEqual(['Space']);
    expect(keymap['reading.toggle'].map(serializeGesture)).toEqual(['Space']);
  });
});

describe('keymapFromBindings', () => {
  it('with no bindings, is the default keymap', () => {
    expect(keymapFromBindings({}, COMMAND_CATALOG, false)).toEqual(defaultKeymap(COMMAND_CATALOG, false));
  });

  it('overrides only the commands a binding names', () => {
    const keymap = keymapFromBindings({ 'reading.toggle': ['Numpad0'] }, COMMAND_CATALOG, false);
    expect(keymap['reading.toggle']).toEqual([gesture('keyboard', 'Numpad0')]);
    expect(keymap['workspace.play']).toEqual(defaultKeymap(COMMAND_CATALOG, false)['workspace.play']);
  });

  it('an unbound command (Unbind) keeps its empty list rather than falling back to the default', () => {
    const keymap = keymapFromBindings({ 'reading.toggle': [] }, COMMAND_CATALOG, false);
    expect(keymap['reading.toggle']).toEqual([]);
  });

  it('ignores a binding for a command id the catalog no longer has', () => {
    const keymap = keymapFromBindings({ 'no.such.command': ['Space'] }, COMMAND_CATALOG, false);
    expect(Object.keys(keymap).sort()).toEqual(COMMAND_CATALOG.map((command) => command.id).sort());
  });

  it('falls back to the default for one command whose stored gesture cannot be parsed, without losing the rest', () => {
    const keymap = keymapFromBindings({ 'reading.toggle': ['Fn+Nonsense'], 'workspace.play': ['Numpad0'] }, COMMAND_CATALOG, false);
    expect(keymap['reading.toggle']).toEqual(defaultKeymap(COMMAND_CATALOG, false)['reading.toggle']);
    expect(keymap['workspace.play']).toEqual([gesture('keyboard', 'Numpad0')]);
  });
});

describe('bindingsFromKeymap', () => {
  it('is empty for the default keymap', () => {
    expect(bindingsFromKeymap(defaultKeymap(COMMAND_CATALOG, false), COMMAND_CATALOG, false)).toEqual({});
  });

  it('names only the commands that differ from their default, regardless of gesture order', () => {
    const keymap = defaultKeymap(COMMAND_CATALOG, false);
    keymap['reading.toggle'] = [gesture('keyboard', 'Numpad0')];
    keymap['nav.back'] = [...keymap['nav.back']].reverse();
    expect(bindingsFromKeymap(keymap, COMMAND_CATALOG, false)).toEqual({ 'reading.toggle': ['Numpad0'] });
  });

  it('round-trips through keymapFromBindings', () => {
    const keymap = defaultKeymap(COMMAND_CATALOG, false);
    keymap['reading.toggle'] = [gesture('keyboard', 'Numpad0')];
    keymap['workspace.flag.next'] = [];
    const bindings = bindingsFromKeymap(keymap, COMMAND_CATALOG, false);
    expect(keymapFromBindings(bindings, COMMAND_CATALOG, false)).toEqual(keymap);
  });
});
