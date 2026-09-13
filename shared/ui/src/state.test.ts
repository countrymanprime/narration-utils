import { describe, expect, it } from 'vitest';
import { canAddEquivalence, hasCompleteApi, hasCompleteMethodList, hasReadyApi, isTranscriptActive, REQUIRED_API_METHODS, selectDiscrepancy } from './state';

const row = { id: '0@1', kind: 'MISREAD', name: 'x', docText: 'Voss', audioText: 'Vos', projectTime: 1, itemIndex: 0, srcpos: 1 };

describe('Transcript workspace state', () => {
  it('treats preparation and recognition as cancellable work', () => {
    expect(isTranscriptActive('preparing')).toBe(true);
    expect(isTranscriptActive('running')).toBe(true);
    expect(isTranscriptActive('success')).toBe(false);
  });
  it('keeps the selected result when it exists and otherwise chooses the first result', () => {
    expect(selectDiscrepancy([row], row.id)).toEqual(row);
    expect(selectDiscrepancy([row], 'missing')).toEqual(row);
  });
  it('only enables equivalences for single-word misreads', () => {
    expect(canAddEquivalence(row)).toBe(true);
    expect(canAddEquivalence({ ...row, kind: 'SKIPPED' })).toBe(false);
    expect(canAddEquivalence({ ...row, audioText: 'two words' })).toBe(false);
  });
  it('waits for a complete pywebview API contract instead of an empty or partial object', () => {
    expect(hasCompleteApi(undefined)).toBe(false);
    expect(hasCompleteApi({})).toBe(false);
    expect(hasCompleteApi({ ready: () => undefined, bootstrap: () => undefined })).toBe(false);
    expect(hasCompleteApi(Object.fromEntries(REQUIRED_API_METHODS.map((name) => [name, () => undefined])))).toBe(true);
  });
  it('uses a callable ready handshake and rejects an incomplete advertised contract', () => {
    expect(hasReadyApi(undefined)).toBe(false);
    expect(hasReadyApi({})).toBe(false);
    expect(hasReadyApi({ ready: () => undefined })).toBe(true);
    expect(hasCompleteMethodList(['ready', 'bootstrap'])).toBe(false);
    expect(hasCompleteMethodList([...REQUIRED_API_METHODS])).toBe(true);
  });
});
