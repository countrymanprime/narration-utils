import { describe, expect, it } from 'vitest';
import type { StageChapterRecommendation, StageUnknownCause } from '../../types';
import { CAUSE_TEXT, evidenceValue, formatAge, summarize, verdictLine, verdictSentence } from './stageText';

const base: StageChapterRecommendation = {
  chapterId: 'c4',
  title: 'Chapter 4',
  from: 'recording',
  target: 'editing',
  verdict: 'recommended',
  signals: [],
  causes: [],
};

describe('stage suggestion text', () => {
  it('names the target stage in the row line of every verdict that has one', () => {
    expect(verdictLine(base)).toBe('Suggested: Editing');
    expect(verdictLine({ ...base, verdict: 'dismissed' })).toBe('Suggestion dismissed (Editing)');
    expect(verdictLine({ ...base, verdict: 'not_ready' })).toBe('Not ready for Editing');
  });

  it('says why an unknown verdict cannot tell, from its first cause', () => {
    expect(verdictLine({ ...base, verdict: 'unknown', causes: ['unmapped_track'] })).toBe('Can’t tell yet: no track linked');
    expect(verdictLine({ ...base, verdict: 'unknown' })).toBe('Can’t tell yet');
  });

  it('says nothing in the row for a chapter that is not evaluated', () => {
    expect(verdictLine({ ...base, verdict: 'none', noneReason: 'stage_not_evaluated', target: undefined })).toBeUndefined();
  });

  it('never words an unknown verdict as ready', () => {
    const sentence = verdictSentence({ ...base, verdict: 'unknown', causes: ['never_analyzed'] });
    expect(sentence).toMatch(/never counts as done/);
    expect(sentence).not.toMatch(/looks ready/);
  });

  it('explains a none verdict by its reason', () => {
    expect(verdictSentence({ ...base, from: 'editing', verdict: 'none', noneReason: 'no_required_signals' })).toMatch(/No check for the Editing stage/);
    expect(verdictSentence({ ...base, from: 'finalized', verdict: 'none', noneReason: 'stage_not_evaluated' })).toBe(
      'Chapters in Finalized get no suggestion.',
    );
  });

  it('has a row phrase and an action for every cause the host can send', () => {
    const causes: StageUnknownCause[] = [
      'never_analyzed',
      'stale',
      'incomplete_run',
      'analysis_running',
      'unmapped_track',
      'unconfirmed_mapping',
      'multiple_tracks',
      'measurement_unavailable',
      'project_unreadable',
      'provider_error',
    ];
    for (const cause of causes) {
      expect(CAUSE_TEXT[cause].short.length).toBeGreaterThan(0);
      expect(CAUSE_TEXT[cause].action.length).toBeGreaterThan(0);
    }
  });

  it('reads a stale signal’s reason codes as the recording check’s sentences', () => {
    expect(evidenceValue('stale', 'item_trimmed')).toBe('An item on the chapter’s track was trimmed since this check.');
    expect(evidenceValue('stale', 'unheard_of')).toBe('unheard_of');
    expect(evidenceValue('coverage', 'item_trimmed')).toBe('item_trimmed');
  });

  it('counts suggestions and changed evidence for the summary chips', () => {
    const changed = { ...base, from: 'editing' as const, verdict: 'none' as const, contradiction: { revertTo: 'recording' as const, signals: [] } };
    expect(summarize([base, { ...base, verdict: 'dismissed' }, changed, { ...base, verdict: 'not_ready' }])).toEqual({ suggested: 1, changed: 1 });
  });

  it('says how old a time is, and nothing for a time it cannot read', () => {
    const now = Date.parse('2026-09-23T10:00:00Z');
    expect(formatAge('2026-09-21T10:00:00Z', now)).toMatch(/2 days ago/);
    expect(formatAge('2026-09-23T09:59:30Z', now)).toBe('just now');
    expect(formatAge('not a time', now)).toBe('');
  });
});
