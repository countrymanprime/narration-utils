import { describe, expect, it } from 'vitest';
import { COVERAGE_EVALUATOR_REASONS, COVERAGE_REFUSAL_REASONS } from '../../api/schemas/coverage';
import type { CoverageRegion, CoverageReport, ManuscriptChapter } from '../../types';
import { COVERAGE_REASON_TEXT, describeParagraphs, describePosition, describeRegion, formatAudioTime, paragraphRefs, verdict } from './recordingCheckText';

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

  it('says every word was recorded only when none is missing', () => {
    expect(verdict(report(1000, 1000))).toEqual({ complete: true, headline: 'All the text is recorded', detail: 'Text present: 1,000 of 1,000 words.' });
    expect(verdict(report(986, 1000))).toMatchObject({ complete: false, headline: '14 words not recorded' });
    expect(verdict(report(0, 1)).headline).toBe('1 word not recorded');
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
});
