import { describe, expect, it } from 'vitest';
import { COVERAGE_EVALUATOR_REASONS, COVERAGE_REFUSAL_REASONS } from '../../api/schemas/coverage';
import type { CoverageJudgement, CoverageRegion, CoverageReport, ManuscriptChapter } from '../../types';
import {
  COVERAGE_REASON_TEXT,
  describeParagraphs,
  describePosition,
  describeRegion,
  formatAudioTime,
  paragraphRefs,
  recordedTo,
  verdict,
} from './recordingCheckText';

const report = (present: number, body: number): CoverageReport => ({
  model: 'small',
  alignment: { maxMisreadRun: 8, minAnchorRun: 3 },
  bodyTokens: body,
  presentTokens: present,
  missingTokens: body - present,
  extraTokens: 0,
  longestMissingRun: body - present,
  playedSeconds: 60,
  items: [],
  paragraphs: [],
  regions: [],
});

const region: CoverageRegion = {
  kind: 'tail',
  paragraphIds: ['p-b', 'p-c'],
  tokenCount: 14,
  firstWord: 'the',
  lastWord: 'end.',
  position: { itemIndex: 1, itemGuid: '{ITEM}', sourceTime: 185.4 },
};

const chapter: ManuscriptChapter = {
  id: 'c-1',
  title: 'Chapter 1',
  index: 0,
  wordCount: 100,
  status: 'recording',
  paragraphIds: [
    { id: 'p-a', index: 40 },
    { id: 'p-b', index: 41 },
    { id: 'p-c', index: 42 },
  ],
};

describe('recording check text', () => {
  it('has a plain sentence for every reason the host can send', () => {
    for (const reason of [...COVERAGE_REFUSAL_REASONS, ...COVERAGE_EVALUATOR_REASONS]) {
      expect(COVERAGE_REASON_TEXT[reason], reason).toMatch(/^[A-Z].*\.$/);
      expect(COVERAGE_REASON_TEXT[reason], reason).not.toMatch(/_/);
    }
  });

  it('falls back to the plain word count with no judgement (an older stored result)', () => {
    expect(verdict(report(1000, 1000))).toEqual({ complete: true, headline: 'All the text is recorded', detail: 'Text present: 1,000 of 1,000 words.' });
    expect(verdict(report(986, 1000))).toMatchObject({ complete: false, headline: '14 words not recorded' });
    expect(verdict(report(0, 1)).headline).toBe('1 word not recorded');
  });

  it("leads with the host judgement when one is given, sharing the stage signal's rule (ADR 0204)", () => {
    const met: CoverageJudgement = {
      state: 'met',
      reason: 'Text present: 1,000 of 1,000 words; every paragraph passes.',
      thresholds: { minParagraphPresent: 0.8, maxMissingRun: 3 },
    };
    expect(verdict(report(1000, 1000), met)).toEqual({ complete: true, headline: 'Passes the check', detail: met.reason });
    const notMet: CoverageJudgement = {
      state: 'not_met',
      reason: 'paragraph 14: 9 words not read.',
      thresholds: { minParagraphPresent: 0.8, maxMissingRun: 3 },
    };
    expect(verdict(report(986, 1000), notMet)).toEqual({ complete: false, headline: `Not complete: ${notMet.reason}`, detail: '' });
  });

  it('numbers paragraphs within their chapter and keeps the manuscript index for a link', () => {
    expect(paragraphRefs(chapter, ['p-b', 'p-c'])).toEqual([
      { number: 2, index: 41 },
      { number: 3, index: 42 },
    ]);
    expect(paragraphRefs(chapter, ['p-unknown'])).toEqual([{ number: 1 }]);
  });

  it('reads a run of paragraphs as a range and a scattered set as a list', () => {
    expect(describeParagraphs([12])).toBe('paragraph 12');
    expect(describeParagraphs([40, 38, 39])).toBe('paragraphs 38 to 40');
    expect(describeParagraphs([3, 9, 5])).toBe('paragraphs 3, 5 and 9');
    expect(describeParagraphs([])).toBe('no paragraph');
  });

  it('names a region by its paragraphs, size and first and last missing words', () => {
    expect(describeRegion(region, paragraphRefs(chapter, region.paragraphIds))).toBe('paragraphs 2 to 3: 14 words, from “the” to “end.”');
    expect(describeRegion({ ...region, tokenCount: 1, lastWord: 'the' }, [{ number: 5 }])).toBe('paragraph 5: 1 word, “the”');
  });

  it('places a region in the audio by item and source time', () => {
    expect(describePosition(region)).toBe('Item 2 of the track, at 3:05 in its audio file');
    expect(describePosition({ ...region, position: undefined })).toBeUndefined();
  });

  it('formats audio times as minutes and seconds, with hours when needed', () => {
    expect(formatAudioTime(7.9)).toBe('0:07');
    expect(formatAudioTime(3729)).toBe('1:02:09');
    expect(formatAudioTime(-3)).toBe('0:00');
  });

  it('states an unread end or start as "recorded to", never as a pickup (RS2 A)', () => {
    const paragraphs = [
      { id: 'p-a', tokens: 40, present: 40, longestMissingRun: 0 },
      { id: 'p-b', tokens: 30, present: 30, longestMissingRun: 0 },
      { id: 'p-c', tokens: 30, present: 16, longestMissingRun: 14 },
    ];
    const withTail = { ...report(86, 100), paragraphs, regions: [region] };
    expect(recordedTo(withTail, chapter)).toEqual({ kind: 'tail', paragraph: 1, total: 3, wordsLeft: 14 });

    const withHead = { ...report(86, 100), paragraphs, regions: [{ ...region, kind: 'head' as const, paragraphIds: ['p-a', 'p-b'] }] };
    expect(recordedTo(withHead, chapter)).toEqual({ kind: 'head', paragraph: 2, total: 3, wordsLeft: 14 });

    expect(recordedTo({ ...report(100, 100), paragraphs }, chapter)).toBeUndefined();
  });
});
