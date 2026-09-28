import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chapterName, context } from './chapterName';

// tests/fixtures/chapter-names.json is written by apps/desktop/internal/chaptername's Go test (UPDATE_CONTRACTS=1);
// never edit it by hand. It pins the Go, Python (narration_common.chapter_names) and TypeScript helpers to the same
// output for the same inputs (chapter-title-display-consistency PRD, Phase 4). This is the TypeScript side of that
// proof: pytest reads it for Python, the Go test both writes and reads it for Go.
const FIXTURE_PATH = fileURLToPath(new URL('../../../tests/fixtures/chapter-names.json', import.meta.url));

interface FixtureCase {
  title: string;
  subtitle: string | null;
  full: string;
  short: string;
  plain: string;
  readAloud: string;
}

interface Fixture {
  about: string;
  cases: FixtureCase[];
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));

describe('chapterName against the shared chapter-names fixture', () => {
  it.each(fixture.cases)('$title / $subtitle', (fixtureCase) => {
    const chapter = { title: fixtureCase.title, subtitle: fixtureCase.subtitle ?? undefined };
    expect(chapterName(chapter, 'full')).toBe(fixtureCase.full);
    expect(chapterName(chapter, 'short')).toBe(fixtureCase.short);
    expect(chapterName(chapter, 'plain')).toBe(fixtureCase.plain);
    expect(chapterName(chapter, context('Read aloud'))).toBe(fixtureCase.readAloud);
  });
});
