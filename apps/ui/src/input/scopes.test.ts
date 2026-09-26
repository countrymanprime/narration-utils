import { describe, expect, it } from 'vitest';
import { scopesOverlap, SCOPE_PRIORITY, type Scope } from './scopes';

describe('scopesOverlap', () => {
  it('a scope always overlaps itself', () => {
    for (const scope of SCOPE_PRIORITY) expect(scopesOverlap(scope, scope)).toBe(true);
  });

  it('dialog overlaps booth (the read-aloud dialog is both)', () => {
    expect(scopesOverlap('dialog', 'booth')).toBe(true);
    expect(scopesOverlap('booth', 'dialog')).toBe(true);
  });

  it('booth overlaps global (the Teleprompter page is a booth with global still reachable)', () => {
    expect(scopesOverlap('booth', 'global')).toBe(true);
  });

  it('global overlaps page (a plain page with global still reachable)', () => {
    expect(scopesOverlap('global', 'page')).toBe(true);
  });

  it('dialog does not overlap global or page: a modal dialog suppresses both', () => {
    expect(scopesOverlap('dialog', 'global')).toBe(false);
    expect(scopesOverlap('dialog', 'page')).toBe(false);
  });

  it('page does not overlap booth: a booth claims the surface the same way a dialog does', () => {
    expect(scopesOverlap('page', 'booth')).toBe(false);
  });

  it('is symmetric for every pair', () => {
    for (const a of SCOPE_PRIORITY) for (const b of SCOPE_PRIORITY) expect(scopesOverlap(a, b)).toBe(scopesOverlap(b, a));
  });

  it('orders dialog, booth and page from most to least specific, with global last', () => {
    expect(SCOPE_PRIORITY).toEqual<Scope[]>(['dialog', 'booth', 'page', 'global']);
  });
});
