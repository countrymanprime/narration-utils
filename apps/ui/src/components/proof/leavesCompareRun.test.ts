import { describe, expect, it } from 'vitest';
import { leavesCompareRun } from './leavesCompareRun';

describe('leavesCompareRun', () => {
  it('resets a run when the narrator leaves the chapter view it lives in', () => {
    expect(leavesCompareRun('/proof/chapter-1', '/', 'running')).toBe(true);
    expect(leavesCompareRun('/proof/chapter-1', '/proof', 'success')).toBe(true);
    expect(leavesCompareRun('/proof/chapter-1', '/proof/chapter-2', 'need_chapter')).toBe(true);
    // Back and Forward always leave the page.
    expect(leavesCompareRun('/proof/chapter-1', undefined, 'running')).toBe(true);
  });

  it('leaves the run alone when there is none, when staying put, or from anywhere but a chapter view', () => {
    expect(leavesCompareRun('/proof/chapter-1', '/', 'idle')).toBe(false);
    expect(leavesCompareRun('/proof/chapter-1', '/proof/chapter-1', 'running')).toBe(false);
    expect(leavesCompareRun('/proof', '/', 'running')).toBe(false);
    expect(leavesCompareRun('/settings', '/', 'success')).toBe(false);
  });
});
