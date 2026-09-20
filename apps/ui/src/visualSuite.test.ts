import { describe, expect, test } from 'vitest';
import { APP_DRIVERS } from '../tests/visual/app.drivers';
import { STATE_CATALOG } from '../tests/visual/state-catalog';
import { VIEWPORTS } from '../tests/visual/viewports';
import { findBlankCaptures, findStaleSameAs, findUndeclaredDuplicates, isSameImage, type CaptureRecord } from '../tests/visual/lib/validators';

// A stand-in image: every cell of the signature is one brightness level derived from `hash`,
// so equal hashes are the same picture and different hashes are clearly different pictures.
function level(hash: string): number {
  return ([...hash].reduce((sum, char) => sum + char.charCodeAt(0), 0) * 37) % 256;
}

function record(page: string, state: string, viewport: string, hash: string, overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return { page, state, viewport, hash, signature: Array<number>(8).fill(level(hash)), maxChannelStdev: 40, overflowPx: 0, ...overrides };
}

const key = (page: string, state: string) => `${page}/${state}`;

describe('isSameImage', () => {
  test('treats anti-aliasing noise (a level or two per cell) as the same image', () => {
    expect(isSameImage([10, 20, 30, 40], [11, 19, 30, 42])).toBe(true);
  });

  test('treats a localized real change as a different image', () => {
    expect(isSameImage([10, 20, 30, 40], [10, 20, 90, 40])).toBe(false);
  });

  test('images of different sizes are never the same', () => {
    expect(isSameImage([10, 20], [10, 20, 30])).toBe(false);
  });
});

describe('findBlankCaptures', () => {
  test('flags a capture whose pixels are effectively uniform', () => {
    const blank = record('home', 'default', 'desktop', 'a', { maxChannelStdev: 0.2 });
    const real = record('home', 'other', 'desktop', 'b', { maxChannelStdev: 30 });
    expect(findBlankCaptures([blank, real])).toEqual([blank]);
  });

  test('returns nothing when every capture has visible content', () => {
    expect(findBlankCaptures([record('home', 'default', 'desktop', 'a')])).toEqual([]);
  });
});

describe('findUndeclaredDuplicates', () => {
  test('flags two states with identical pixels at the same viewport when neither declares sameAs', () => {
    const records = [record('manuscript', 'a', 'desktop', 'h1'), record('manuscript', 'b', 'desktop', 'h1')];
    const groups = findUndeclaredDuplicates(records, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ viewport: 'desktop', states: [key('manuscript', 'a'), key('manuscript', 'b')] });
  });

  test('accepts a duplicate when one state declares it is the same as the other', () => {
    const records = [record('home', 'default', 'desktop', 'h1'), record('home', 'collapsed', 'desktop', 'h1')];
    const declared = [{ page: 'home', state: 'collapsed', sameAs: { of: key('home', 'default'), reason: 'collapsed is the default' } }];
    expect(findUndeclaredDuplicates(records, declared)).toEqual([]);
  });

  test('does not call two states duplicates over even a small localized change', () => {
    // Same coarse signature (a Play->Pause glyph is a few pixels), different bytes: a real difference.
    const records = [
      record('tracks', 'default', 'desktop', 'h1'),
      record('tracks', 'playing', 'desktop', 'h2', { signature: Array<number>(8).fill(level('h1')) }),
    ];
    expect(findUndeclaredDuplicates(records, [])).toEqual([]);
  });

  test('does not compare across viewports', () => {
    const records = [record('home', 'a', 'desktop', 'h1'), record('home', 'b', 'mobile', 'h1')];
    expect(findUndeclaredDuplicates(records, [])).toEqual([]);
  });

  test('a sameAs limited to some viewports does not excuse a duplicate at another', () => {
    const records = [record('global', 'rail', 'mobile', 'h1'), record('global', 'drawer', 'mobile', 'h1')];
    const declared = [{ page: 'global', state: 'drawer', sameAs: { of: key('global', 'rail'), reason: 'no-op on desktop', viewports: ['desktop'] } }];
    expect(findUndeclaredDuplicates(records, declared)).toHaveLength(1);
  });
});

describe('findStaleSameAs', () => {
  test('flags a sameAs declaration whose two states no longer render identically', () => {
    const records = [record('home', 'default', 'desktop', 'h1'), record('home', 'collapsed', 'desktop', 'h2')];
    const declared = [{ page: 'home', state: 'collapsed', sameAs: { of: key('home', 'default'), reason: 'collapsed is the default' } }];
    expect(findStaleSameAs(records, declared)).toEqual([{ state: key('home', 'collapsed'), of: key('home', 'default'), viewport: 'desktop' }]);
  });

  test('does not call a declaration stale over anti-aliasing noise', () => {
    const records = [
      record('home', 'default', 'desktop', 'h1'),
      record('home', 'collapsed', 'desktop', 'h1', { signature: Array<number>(8).fill(level('h1') - 1) }),
    ];
    const declared = [{ page: 'home', state: 'collapsed', sameAs: { of: key('home', 'default'), reason: 'collapsed is the default' } }];
    expect(findStaleSameAs(records, declared)).toEqual([]);
  });

  test('ignores a declaration when either side was not captured in this run', () => {
    const records = [record('home', 'collapsed', 'desktop', 'h2')];
    const declared = [{ page: 'home', state: 'collapsed', sameAs: { of: key('home', 'default'), reason: 'x' } }];
    expect(findStaleSameAs(records, declared)).toEqual([]);
  });
});

describe('visual suite catalog integrity', () => {
  const keys = STATE_CATALOG.map((entry) => key(entry.page, entry.state));

  test('every catalog row is unique', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every catalog row has a driver, or says why not', () => {
    const silent = STATE_CATALOG.filter((entry) => !APP_DRIVERS[entry.page]?.[entry.state] && !entry.undriven);
    expect(silent.map((entry) => key(entry.page, entry.state))).toEqual([]);
  });

  test('every driver belongs to a catalog row', () => {
    const orphans = Object.entries(APP_DRIVERS).flatMap(([page, states]) =>
      Object.keys(states)
        .map((state) => key(page, state))
        .filter((k) => !keys.includes(k)),
    );
    expect(orphans).toEqual([]);
  });

  test('no driver is marked undriven', () => {
    const contradictions = STATE_CATALOG.filter((entry) => entry.undriven && APP_DRIVERS[entry.page]?.[entry.state]);
    expect(contradictions.map((entry) => key(entry.page, entry.state))).toEqual([]);
  });

  test('the undriven budget never grows past what is recorded today', () => {
    const MAX_UNDRIVEN = 0;
    expect(STATE_CATALOG.filter((entry) => entry.undriven).length).toBeLessThanOrEqual(MAX_UNDRIVEN);
  });

  test('sameAs targets exist and viewport names are real', () => {
    const viewportNames = VIEWPORTS.map((viewport) => viewport.name);
    for (const entry of STATE_CATALOG) {
      if (!entry.sameAs) continue;
      expect(keys, `${key(entry.page, entry.state)} sameAs.of`).toContain(entry.sameAs.of);
      expect(entry.sameAs.reason.trim().length, `${key(entry.page, entry.state)} needs a reason`).toBeGreaterThan(10);
      for (const name of entry.sameAs.viewports ?? []) expect(viewportNames).toContain(name);
    }
  });
});
