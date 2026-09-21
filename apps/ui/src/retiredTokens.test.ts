// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

// ADR 0059: `--text-faint` is retired as a text colour. Every place that drew text with it is being triaged by area into
// muted text (it reads as text) or the non-text token (an icon, a status dot, a decorative glyph), and the token is deleted
// with the last slice. This scan counts the mentions of it per file and pins the count, so it can only go down: a file with
// more mentions than its entry fails, an entry higher than the real count fails (lower it, or delete it at zero, in the same
// change), and a file with no entry may have none. Swapping one mention for another in the same file keeps the count, so
// that part is the reviewer's.
const RETIRED = '--text-faint';

// Mentions per file, after the primitives, the app shell and the stylesheet were migrated (slice 2a). Each later slice
// deletes its files' entries; the last one deletes the `styles.css` entry with the token itself.
const CEILING: Record<string, number> = {
  'src/components/home/AudiobookEstimatePanel.tsx': 4,
  'src/components/home/Home.tsx': 5,
  'src/components/manuscript/ChapterNav.tsx': 4,
  'src/components/manuscript/EntitySummary.tsx': 8,
  'src/components/manuscript/Manuscript.tsx': 7,
  'src/components/manuscript/ParagraphView.tsx': 2,
  'src/components/project/ProjectPicker.tsx': 1,
  'src/components/proofing/InlineDiffRow.tsx': 3,
  'src/components/proofing/Results.tsx': 1,
  'src/components/proofing/Transcript.tsx': 4,
  'src/components/settings/Settings.tsx': 1,
  'src/components/storybible/Guide.tsx': 4,
  'src/components/storybible/GuideDetail.tsx': 9,
  'src/components/teleprompter/ReaderText.tsx': 1,
  'src/components/teleprompter/TeleprompterPage.tsx': 2,
  'src/components/tracks/TracksPage.tsx': 2,
  'src/styles.css': 2,
};

const uiRoot = join(__dirname, '..');
const NOT_UNDER_TEST = /\.test\.tsx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(entry.name) && !NOT_UNDER_TEST.test(entry.name) ? [path] : [];
  });
}

function mentions(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of sourceFiles(join(uiRoot, 'src'))) {
    const count = readFileSync(file, 'utf8').split(RETIRED).length - 1;
    if (count > 0) counts[relative(uiRoot, file).split(sep).join('/')] = count;
  }
  return counts;
}

describe('the retired text token (ADR 0059)', () => {
  test('mentions only go down: lower the ceiling with the file you migrated, and add none', () => {
    expect(mentions()).toEqual(CEILING);
  });
});
