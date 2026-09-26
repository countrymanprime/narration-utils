import { describe, expect, it } from 'vitest';
import { COMMAND_CATALOG } from './commands.catalog';
import { defaultKeymap } from './keymap';
import { serializeGesture } from './gestures';

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
