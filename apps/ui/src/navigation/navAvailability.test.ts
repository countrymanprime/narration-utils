import { describe, expect, it } from 'vitest';
import { NAV_PRECONDITIONS, navAvailability } from './navAvailability';

const NEEDS_MANUSCRIPT = ['/schedule', '/script', '/story-bible', '/booth', '/editing', '/proof', '/pickups', '/master', '/delivery'];
const NEVER_GATED = ['/', '/settings'];
const REASON = 'Import a manuscript to unlock this page.';

describe('navAvailability', () => {
  it('turns the nine pages that need a manuscript off with its reason when there is none', () => {
    for (const path of NEEDS_MANUSCRIPT) {
      expect(navAvailability(path, { hasManuscript: false, dawFileLinked: false }), path).toEqual({ disabled: true, reason: REASON });
    }
  });

  it('turns every page on once a manuscript is imported, with or without a linked DAW project file', () => {
    for (const path of [...NEEDS_MANUSCRIPT, ...NEVER_GATED]) {
      for (const dawFileLinked of [true, false]) expect(navAvailability(path, { hasManuscript: true, dawFileLinked }).disabled, path).toBe(false);
    }
  });

  it('never gates Production or Settings: the import and the project setup live there', () => {
    for (const path of NEVER_GATED) expect(navAvailability(path, { hasManuscript: false, dawFileLinked: false }).disabled, path).toBe(false);
  });

  it('names the page set exactly: a path added to the table is added here on purpose', () => {
    expect(Object.keys(NAV_PRECONDITIONS).sort()).toEqual([...NEEDS_MANUSCRIPT, ...NEVER_GATED].sort());
  });

  it('does not gate a path the table does not list', () => {
    expect(navAvailability('/somewhere-else', { hasManuscript: false, dawFileLinked: false })).toEqual({ disabled: false });
  });
});
