import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import docScreenshots from '../tests/visual/doc-screenshots.json';

// docs/guides/using-the-app/ is a multi-page guide: README.md is the index and
// every other .md file is one page (or one large feature) of the app. Nothing
// else keeps the index, the Previous/Next footers, the cross-links and the
// screenshot embeds consistent when a page is added, renamed or removed, so
// this test does.

const repoRoot = join(__dirname, '..', '..', '..');
const guideDir = join(repoRoot, 'docs', 'guides', 'using-the-app');
const INDEX = 'README.md';
const INDEX_TITLE = 'Using the app';

const LINK_PATTERN = /!?\[[^\]]*\]\(([^)\s]+)\)/g;
const EMBED_PATTERN = /!\[[^\]]*\]\(([^)\s]+\.webp)\)/g;

const guideFiles = existsSync(guideDir) ? readdirSync(guideDir).filter((file) => file.endsWith('.md')) : [];
const pageFiles = guideFiles.filter((file) => file !== INDEX);

const read = (file: string): string => readFileSync(join(guideDir, file), 'utf8');

function linkTargets(markdown: string, pattern: RegExp = LINK_PATTERN): string[] {
  return [...markdown.matchAll(pattern)].map((match) => match[1]);
}

function isLocal(target: string): boolean {
  return !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

// GitHub's heading anchor: lower-case, drop punctuation, spaces become hyphens.
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function headingSlugs(markdown: string): Set<string> {
  const headings = [...markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)].map((match) => slug(match[1]));
  return new Set(headings);
}

function lastLine(markdown: string): string {
  return markdown.trimEnd().split('\n').at(-1) ?? '';
}

function firstLine(markdown: string): string {
  return markdown.trimStart().split('\n')[0] ?? '';
}

// Pages in the order the index lists them: each page's first link in README.md.
function indexOrder(): string[] {
  const seen: string[] = [];
  for (const target of linkTargets(read(INDEX))) {
    const file = target.split('#')[0];
    if (isLocal(target) && pageFiles.includes(file) && !seen.includes(file)) seen.push(file);
  }
  return seen;
}

describe('docs/guides/using-the-app', () => {
  test('has an index and at least one page', () => {
    expect(guideFiles, `${guideDir} needs a ${INDEX}`).toContain(INDEX);
    expect(pageFiles.length).toBeGreaterThan(0);
  });

  test('the index links every page, and only pages that exist', () => {
    expect([...indexOrder()].sort()).toEqual([...pageFiles].sort());
  });

  test('every page opens with a breadcrumb back to the index', () => {
    const missing = pageFiles.filter((file) => !firstLine(read(file)).startsWith(`[${INDEX_TITLE}](${INDEX})`));
    expect(missing, `first line of each page must start with [${INDEX_TITLE}](${INDEX}) › <page>`).toEqual([]);
  });

  test('every page ends with Previous / Index / Next links that follow the index order', () => {
    const order = indexOrder();
    const wrong = order.flatMap((file, position) => {
      const expected = [order[position - 1], INDEX, order[position + 1]].filter((href): href is string => Boolean(href));
      const actual = linkTargets(lastLine(read(file)));
      return JSON.stringify(actual) === JSON.stringify(expected)
        ? []
        : [`${file}: footer links ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`];
    });
    expect(wrong).toEqual([]);
  });

  test('every relative link and image resolves to a real file and heading', () => {
    const broken: string[] = [];
    for (const file of guideFiles) {
      const markdown = read(file);
      for (const target of linkTargets(markdown).filter(isLocal)) {
        const [path, fragment] = target.split('#');
        const resolved = path === '' ? join(guideDir, file) : resolve(guideDir, dirname(file), path);
        if (!existsSync(resolved)) {
          broken.push(`${file}: ${target} does not exist`);
        } else if (fragment && resolved.endsWith('.md')) {
          const source = resolved === join(guideDir, file) ? markdown : readFileSync(resolved, 'utf8');
          if (!headingSlugs(source).has(fragment)) broken.push(`${file}: ${target} has no matching heading`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test('every curated doc screenshot is embedded on exactly one page, and every embed is curated', () => {
    const embeds = pageFiles.flatMap((file) => linkTargets(read(file), EMBED_PATTERN).map((target) => ({ file, name: basename(target, '.webp') })));
    const problems: string[] = [];
    for (const { docName } of docScreenshots) {
      const pages = embeds.filter((embed) => embed.name === docName).map((embed) => embed.file);
      if (pages.length !== 1) problems.push(`${docName} is embedded ${pages.length} times (${pages.join(', ')})`);
    }
    const curated = new Set(docScreenshots.map((entry) => entry.docName));
    for (const embed of embeds) {
      if (!curated.has(embed.name)) problems.push(`${embed.file} embeds ${embed.name}.webp, which is not in doc-screenshots.json`);
    }
    expect(problems).toEqual([]);
  });
});
