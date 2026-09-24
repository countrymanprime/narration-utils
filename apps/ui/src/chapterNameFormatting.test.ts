// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// chapter-title-display-consistency.prd.md: one formatter (chapterName.ts) and one component (primitives/TitleSubtitle)
// draw a chapter's name everywhere. This ratchet (in the style of rawNatives.test.ts, ADR 0053) counts every other read
// of `.subtitle` inside a JSX expression or a template literal in src/components/** - the two places text actually
// reaches the screen - and fails when a file's count goes up. A file's count may only go down; lower its entry (or
// delete it at zero) in the same change that moves the site onto chapterName()/TitleSubtitle. A plain `.subtitle` read
// outside JSX or a template (deciding which subtitle to keep, matching a word span) is not display text and is not
// counted.
const ALLOW_LIST = new Set([
  join('src', 'components', 'primitives', 'TitleSubtitle.tsx'),
  // Decides which subtitle survives the import review's own choices (join it, drop it, keep it) - not a display site.
  join('src', 'components', 'home', 'importReviewModel.ts'),
  // Fits the sidecar's tracked title tokens - not a display site (chapter-title-display-consistency.prd.md, Q9).
  join('src', 'components', 'teleprompter', 'readerModel.ts'),
]);

// Phase 1's snapshot of today's count, one entry per file that still reads `.subtitle` directly. Phase 2 moves Home,
// Manuscript and Chapters & Search onto TitleSubtitle (lowering these); Phase 3 moves the rest, including the Read
// aloud heading and the Teleprompter select, and the ceiling reaches zero.
const CEILING: Record<string, number> = {
  [join('src', 'components', 'home', 'AudiobookEstimatePanel.tsx')]: 5,
  [join('src', 'components', 'home', 'ImportReview.tsx')]: 4,
  [join('src', 'components', 'manuscript', 'ChapterNav.tsx')]: 2,
  [join('src', 'components', 'manuscript', 'Manuscript.tsx')]: 2,
  [join('src', 'components', 'teleprompter', 'TeleprompterPage.tsx')]: 1,
};

const uiRoot = join(__dirname, '..');
const componentsRoot = join(uiRoot, 'src', 'components');
const SOURCE = /\.tsx?$/;
const NOT_UNDER_TEST = /\.(test|stories)\.tsx?$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE.test(entry.name) && !NOT_UNDER_TEST.test(entry.name) ? [path] : [];
  });
}

// A `.subtitle` property read while inside a JSX expression ({...}, in a child or an attribute) or a template literal
// span - where the read reaches the screen as text - counts. A plain `.subtitle` read elsewhere (a ternary condition
// that only decides which case to take, an object literal field) does not.
export function countSubtitleReads(source: string, fileName = 'probe.tsx'): number {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  const visit = (node: ts.Node, insideDisplay: boolean): void => {
    const inside =
      insideDisplay ||
      ts.isJsxExpression(node) ||
      ts.isTemplateExpression(node) ||
      ts.isTaggedTemplateExpression(node) ||
      ts.isNoSubstitutionTemplateLiteral(node);
    if (inside && ts.isPropertyAccessExpression(node) && node.name.text === 'subtitle') count += 1;
    ts.forEachChild(node, (child) => visit(child, inside));
  };
  visit(file, false);
  return count;
}

describe('a chapter name is drawn through chapterName()/TitleSubtitle, not a raw .subtitle read (ADR 0053-style ratchet)', () => {
  const files = sourceFiles(componentsRoot)
    .map((file) => relative(uiRoot, file))
    .filter((file) => !ALLOW_LIST.has(file));
  const counts = new Map(files.map((file) => [file, countSubtitleReads(readFileSync(join(uiRoot, file), 'utf8'), file)]));

  test('no file gained a raw .subtitle read outside the allow-list', () => {
    const grew = [...counts].filter(([file, count]) => count > (CEILING[file] ?? 0));
    expect(grew, 'draw the name through chapterName()/TitleSubtitle instead, or add the site to CEILING with a reason').toEqual([]);
  });

  test('no ceiling entry is stale', () => {
    const stale = Object.entries(CEILING).filter(([file, allowed]) => (counts.get(file) ?? 0) < allowed);
    expect(stale, 'a file lost a raw .subtitle read: lower its ceiling (delete the entry at zero)').toEqual([]);
  });

  test('the scan finds a .subtitle read inside JSX and inside a template literal, and ignores one outside both', () => {
    expect(countSubtitleReads('const a = <p>{chapter.subtitle}</p>;')).toBe(1);
    expect(countSubtitleReads('const a = <p title={chapter.subtitle} />;')).toBe(1);
    expect(countSubtitleReads('const a = `${chapter.subtitle}`;')).toBe(1);
    expect(countSubtitleReads('const a = chapter.subtitle ? chapter.subtitle : "";')).toBe(0);
    expect(countSubtitleReads('const a = { subtitle: chapter.subtitle };')).toBe(0);
  });
});

describe('the allow-list still holds', () => {
  test.each([...ALLOW_LIST])('%s exists', (file) => {
    expect(() => readFileSync(join(uiRoot, file), 'utf8')).not.toThrow();
  });
});
