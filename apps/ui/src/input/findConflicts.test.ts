import { describe, expect, it } from 'vitest';
import { COMMAND_CATALOG, type CommandDescriptor } from './commands.catalog';
import { defaultKeymap, type Keymap } from './keymap';
import { findConflicts } from './findConflicts';
import { gesture } from './gestures';

describe('findConflicts', () => {
  it('has zero conflicts in the default keymap (Phase 1 done-when bar)', () => {
    expect(findConflicts(COMMAND_CATALOG, defaultKeymap(COMMAND_CATALOG, false))).toEqual([]);
    expect(findConflicts(COMMAND_CATALOG, defaultKeymap(COMMAND_CATALOG, true))).toEqual([]);
  });

  it('reports two global commands bound to the same gesture', () => {
    const catalog: CommandDescriptor[] = [
      { id: 'a', label: 'A', scope: 'global', defaults: [] },
      { id: 'b', label: 'B', scope: 'global', defaults: [] },
    ];
    const keymap: Keymap = { a: [gesture('keyboard', 'KeyP')], b: [gesture('keyboard', 'KeyP')] };
    expect(findConflicts(catalog, keymap)).toEqual([{ gesture: 'KeyP', commands: ['a', 'b'] }]);
  });

  it('does not report a page command and a dialog-only command sharing a gesture (dialog excludes page)', () => {
    const catalog: CommandDescriptor[] = [
      { id: 'a', label: 'A', scope: 'page', defaults: [] },
      { id: 'b', label: 'B', scope: 'dialog', defaults: [] },
    ];
    const keymap: Keymap = { a: [gesture('keyboard', 'KeyP')], b: [gesture('keyboard', 'KeyP')] };
    expect(findConflicts(catalog, keymap)).toEqual([]);
  });

  it('does not report a page command and a booth command sharing a gesture (a booth screen is never also a page)', () => {
    const catalog: CommandDescriptor[] = [
      { id: 'workspace.play', label: 'Play', scope: 'page', defaults: [] },
      { id: 'reading.toggle', label: 'Toggle', scope: 'booth', defaults: [] },
    ];
    const keymap: Keymap = { 'workspace.play': [gesture('keyboard', 'Space')], 'reading.toggle': [gesture('keyboard', 'Space')] };
    expect(findConflicts(catalog, keymap)).toEqual([]);
  });

  it('reports a global command and a page command sharing a gesture (global reaches every page)', () => {
    const catalog: CommandDescriptor[] = [
      { id: 'a', label: 'A', scope: 'global', defaults: [] },
      { id: 'b', label: 'B', scope: 'page', defaults: [] },
    ];
    const keymap: Keymap = { a: [gesture('keyboard', 'KeyP')], b: [gesture('keyboard', 'KeyP')] };
    expect(findConflicts(catalog, keymap)).toEqual([{ gesture: 'KeyP', commands: ['a', 'b'] }]);
  });

  it('does not report two commands bound to distinct gestures', () => {
    const catalog: CommandDescriptor[] = [
      { id: 'a', label: 'A', scope: 'global', defaults: [] },
      { id: 'b', label: 'B', scope: 'global', defaults: [] },
    ];
    const keymap: Keymap = { a: [gesture('keyboard', 'KeyP')], b: [gesture('keyboard', 'KeyQ')] };
    expect(findConflicts(catalog, keymap)).toEqual([]);
  });

  it('sorts a conflict pair regardless of which command it saw first', () => {
    const catalog: CommandDescriptor[] = [
      { id: 'z', label: 'Z', scope: 'global', defaults: [] },
      { id: 'a', label: 'A', scope: 'global', defaults: [] },
    ];
    const keymap: Keymap = { z: [gesture('keyboard', 'KeyP')], a: [gesture('keyboard', 'KeyP')] };
    expect(findConflicts(catalog, keymap)).toEqual([{ gesture: 'KeyP', commands: ['a', 'z'] }]);
  });
});
