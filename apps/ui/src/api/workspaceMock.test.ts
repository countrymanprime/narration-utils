import { describe, expect, it } from 'vitest';
import { createWorkspaceMock } from './workspaceMock';
import { judgeMock } from './coverageMock';
import { WIRE_CHAPTERS, WIRE_PARAGRAPHS, WIRE_TRACKS_PROJECT } from './mockFixtures';
import type { CoverageResult, TrackMapping } from '../types';

const chapter = WIRE_CHAPTERS[0];
const paragraphs = WIRE_PARAGRAPHS.filter((paragraph) => paragraph.chapterId === chapter.id);

function currentResult(): CoverageResult {
  const bodyTokens = chapter.wordCount;
  const report = {
    model: 'small' as const,
    alignment: { maxMisreadRun: 8, minAnchorRun: 3 },
    bodyTokens,
    presentTokens: bodyTokens,
    missingTokens: 0,
    extraTokens: 0,
    longestMissingRun: 0,
    playedSeconds: 60,
    items: [],
    paragraphs: paragraphs.map((paragraph) => ({ id: paragraph.id, tokens: 10, present: 10, longestMissingRun: 0 })),
    regions: [],
  };
  return { chapterId: chapter.id, state: 'current', reasons: [], result: report, judgement: judgeMock(report) };
}

describe('createWorkspaceMock', () => {
  it('reads never for a chapter with no coverage result yet', async () => {
    const workspace = createWorkspaceMock({
      chapters: () => WIRE_CHAPTERS,
      paragraphs: () => WIRE_PARAGRAPHS,
      coverageResult: () => ({ chapterId: chapter.id, state: 'never', reasons: [] }),
      project: WIRE_TRACKS_PROJECT,
      mappings: () => [],
    });
    const alignment = await workspace.workspaceAlignment(chapter.id);
    expect(alignment.state).toBe('never');
    expect(alignment.tokens).toEqual([]);
  });

  it('gives every paragraph word a token, in order, when current', async () => {
    const workspace = createWorkspaceMock({
      chapters: () => WIRE_CHAPTERS,
      paragraphs: () => WIRE_PARAGRAPHS,
      coverageResult: currentResult,
      project: WIRE_TRACKS_PROJECT,
      mappings: () => [],
    });
    const alignment = await workspace.workspaceAlignment(chapter.id);
    const expectedWordCount = paragraphs.reduce((sum, paragraph) => sum + paragraph.text.split(/\s+/).filter(Boolean).length, 0);
    expect(alignment.tokens).toHaveLength(expectedWordCount);
    expect(alignment.tokens.map((token) => token.i)).toEqual(alignment.tokens.map((_, index) => index));
  });

  it('gives the chapter a live, playable item once its track is confirmed', async () => {
    const trackGuid = WIRE_TRACKS_PROJECT.tracks[0].guid;
    const mapping: TrackMapping = { trackGuid, chapterId: chapter.id, chapterTitle: chapter.title, confirmedAt: '2026-01-01T00:00:00Z' };
    const workspace = createWorkspaceMock({
      chapters: () => WIRE_CHAPTERS,
      paragraphs: () => WIRE_PARAGRAPHS,
      coverageResult: currentResult,
      project: WIRE_TRACKS_PROJECT,
      mappings: () => [mapping],
    });
    const alignment = await workspace.workspaceAlignment(chapter.id);
    expect(alignment.items).toHaveLength(1);
    expect(alignment.items[0]).toMatchObject({ live: true, itemGuid: WIRE_TRACKS_PROJECT.tracks[0].items[0].guid });
    // At least one token carries the live item's time, so the player has something to highlight.
    expect(alignment.tokens.some((token) => token.item === 0 && token.start !== undefined)).toBe(true);
  });

  it('has no live item when the chapter has no confirmed track link', async () => {
    const workspace = createWorkspaceMock({
      chapters: () => WIRE_CHAPTERS,
      paragraphs: () => WIRE_PARAGRAPHS,
      coverageResult: currentResult,
      project: WIRE_TRACKS_PROJECT,
      mappings: () => [],
    });
    const alignment = await workspace.workspaceAlignment(chapter.id);
    expect(alignment.items).toEqual([]);
    expect(alignment.tokens.every((token) => token.item === undefined)).toBe(true);
  });
});
