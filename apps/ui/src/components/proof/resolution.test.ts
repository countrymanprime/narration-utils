import { describe, expect, it } from 'vitest';
import type { Finding } from '../../types';
import { decisionLabel, fixKindOf, flagFixKind, resolutionCounts, resolutionOf, savedMessage } from './resolution';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    schema_version: 1,
    id: 'f1',
    analyzer: 'transcript-compare',
    project: {},
    source: {},
    category: 'transcript_discrepancy',
    severity: 'warning',
    confidence: 0.9,
    confidence_reason: '',
    evidence: { kind: 'MISREAD' },
    review: { status: 'unreviewed' },
    ...overrides,
  };
}

describe('fixKindOf (D85 #7: the mock says what a note asks for, a pickup or an edit)', () => {
  it('is a pickup for a misread, a skip, a pronunciation and a proofer pickup', () => {
    expect(fixKindOf(finding())).toBe('pickup');
    expect(fixKindOf(finding({ evidence: { kind: 'SKIPPED' } }))).toBe('pickup');
    expect(fixKindOf(finding({ category: 'pronunciation', evidence: {} }))).toBe('pickup');
    expect(fixKindOf(finding({ category: 'pickup', evidence: {} }))).toBe('pickup');
  });

  it('is an edit for extra words (a cut), a repeat, pacing and audio cleanup', () => {
    expect(fixKindOf(finding({ evidence: { kind: 'EXTRA' } }))).toBe('edit');
    expect(fixKindOf(finding({ category: 'duplicate_read', evidence: {} }))).toBe('edit');
    expect(fixKindOf(finding({ category: 'pacing', evidence: {} }))).toBe('edit');
    expect(fixKindOf(finding({ category: 'silence_cleanup', evidence: {} }))).toBe('edit');
    expect(fixKindOf(finding({ category: 'audio_quality', evidence: {} }))).toBe('edit');
  });

  it('is a pickup for a category it does not know, the safer fix', () => {
    expect(fixKindOf(finding({ category: 'something_new', evidence: {} }))).toBe('pickup');
  });

  it('reads a chapter flag the same way: extra words and cleanup are edits', () => {
    expect(flagFixKind('extra')).toBe('edit');
    expect(flagFixKind('cleanup')).toBe('edit');
    expect(flagFixKind('misread')).toBe('pickup');
    expect(flagFixKind('skip')).toBe('pickup');
  });
});

describe('resolutionOf (mock 04 Resolution column)', () => {
  it('says Pickup or Edit for an accepted note, by what it asks for', () => {
    expect(resolutionOf(finding({ review: { status: 'accepted' } }))).toEqual({ label: 'Pickup', tone: 'danger' });
    expect(resolutionOf(finding({ evidence: { kind: 'EXTRA' }, review: { status: 'accepted' } }))).toEqual({ label: 'Edit', tone: 'warning' });
  });

  it('says Waived for a dismissed note, and names the undecided and deferred ones plainly', () => {
    expect(resolutionOf(finding({ review: { status: 'dismissed' } }))).toEqual({ label: 'Waived', tone: 'success' });
    expect(resolutionOf(finding())).toEqual({ label: 'To review', tone: 'neutral' });
    expect(resolutionOf(finding({ review: { status: 'deferred' } }))).toEqual({ label: 'Deferred', tone: 'info' });
  });
});

describe('decisionLabel and savedMessage', () => {
  it('names the accept button for the fix it records', () => {
    expect(decisionLabel('accepted', 'pickup')).toBe('Pickup');
    expect(decisionLabel('accepted', 'edit')).toBe('Fix in edit');
    expect(decisionLabel('dismissed', 'pickup')).toBe('Waive');
    expect(decisionLabel('deferred', 'edit')).toBe('Defer');
  });

  it('confirms a saved decision in the same words', () => {
    expect(savedMessage('accepted', 'pickup')).toBe('Saved: needs a pickup.');
    expect(savedMessage('accepted', 'edit')).toBe('Saved: fix in edit.');
    expect(savedMessage('dismissed', 'pickup')).toBe('Saved: waived.');
    expect(savedMessage('deferred', 'pickup')).toBe('Saved: deferred.');
    expect(savedMessage('unreviewed', 'pickup')).toBe('Put back in the queue.');
  });
});

describe('resolutionCounts (the notes header chips)', () => {
  it('splits the accepted notes into pickups and edits, and counts the waived and undecided ones', () => {
    const counts = resolutionCounts([
      finding({ id: 'a', review: { status: 'accepted' } }),
      finding({ id: 'b', review: { status: 'accepted' } }),
      finding({ id: 'c', evidence: { kind: 'EXTRA' }, review: { status: 'accepted' } }),
      finding({ id: 'd', review: { status: 'dismissed' } }),
      finding({ id: 'e' }),
      finding({ id: 'f', review: { status: 'deferred' } }),
    ]);
    expect(counts).toEqual({ pickup: 2, edit: 1, waived: 1, toReview: 1, deferred: 1 });
  });
});
