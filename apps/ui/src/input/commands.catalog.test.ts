import { describe, expect, it } from 'vitest';
import { COMMAND_CATALOG, findCommand } from './commands.catalog';

describe('COMMAND_CATALOG', () => {
  it('has no duplicate id', () => {
    const ids = COMMAND_CATALOG.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a non-empty label and at least one default gesture for every command', () => {
    for (const command of COMMAND_CATALOG) {
      expect(command.label.length).toBeGreaterThan(0);
      expect(command.defaults.length).toBeGreaterThan(0);
    }
  });

  it('F13 to F24 stay unbound by default, for a programmable pedal (Solution Detail)', () => {
    const codes = COMMAND_CATALOG.flatMap((command) => command.defaults.map((gesture) => gesture.code));
    for (let n = 13; n <= 24; n++) expect(codes).not.toContain(`F${n}`);
  });

  it('findCommand looks up by id and is undefined for an unknown one', () => {
    expect(findCommand('nav.back')?.label).toBe('Back');
    expect(findCommand('not.a.command')).toBeUndefined();
  });
});
