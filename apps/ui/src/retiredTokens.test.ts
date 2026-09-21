// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

// ADR 0059: `--text-faint` is gone. It carried section labels, counts and helper text at 2.2 to 3.7:1, so every place that
// drew something with it was triaged into muted text (it reads as text) or the non-text token (an icon, a status dot, a
// decorative glyph), one area per slice, and the token was deleted from both theme blocks. A reference left or added
// anywhere would draw nothing (an undefined custom property), so this scan fails on any mention in what the UI package
// ships or tests, not only under src/.
const RETIRED = '--text-faint';

const uiRoot = join(__dirname, '..');
const SCANNED = ['src', 'tests', '.storybook', 'index.html'];
const SOURCE = /\.(tsx?|css|html|m?js|json|mdx?)$/;
const NOT_UNDER_TEST = /\.test\.tsx?$/;

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => filesUnder(join(path, entry.name)));
}

function mentions(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const root of SCANNED) {
    for (const file of filesUnder(join(uiRoot, root))) {
      if (!SOURCE.test(file) || NOT_UNDER_TEST.test(file)) continue;
      const count = readFileSync(file, 'utf8').split(RETIRED).length - 1;
      if (count > 0) counts[relative(uiRoot, file).split(sep).join('/')] = count;
    }
  }
  return counts;
}

describe('the retired text token (ADR 0059)', () => {
  test('nothing mentions it: text is --text-muted, an icon or a dot is --non-text', () => {
    expect(mentions()).toEqual({});
  });

  test('scans the places a reference could hide', () => {
    // The scan must find files: an empty walk (a wrong root) would pass the test above for the wrong reason.
    const scanned = SCANNED.flatMap((root) => filesUnder(join(uiRoot, root))).filter((file) => SOURCE.test(file));
    expect(scanned.some((file) => file.endsWith('styles.css'))).toBe(true);
    expect(scanned.some((file) => file.endsWith('index.html'))).toBe(true);
    expect(scanned.some((file) => file.includes(`${sep}.storybook${sep}`))).toBe(true);
    expect(scanned.some((file) => file.includes(`${sep}tests${sep}visual${sep}`))).toBe(true);
  });
});
