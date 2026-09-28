// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

// Every pill is THE pill (mock-fidelity-primitives-and-components.prd.md Phase 2, ADR 0600): a status pill, a type tag, a
// speaker tag, a summary chip and a status dot are drawn by `StatusBadge`/`Badge`/`Dot` (primitives/StatusBadge.tsx),
// `SpeakerTag` or `Pill`, never by pasting the classes. The owner saw pills of 18 to 26 px side by side because each page
// drew its own. The header's chips are `HeaderChip` (Phase 8, ADR 0635). This scan reads every class string outside the primitives and counts the three shapes a copy leaves
// behind, per file:
// - a chip: `rounded-full` with side padding;
// - a dot: `rounded-full` at a dot's size (6-8 px);
// - a tag: a small fixed radius (0.1-0.29 rem) with side padding.
// A file may only go down: a ceiling above its real count fails, so an entry is lowered (or deleted at zero) in the same
// change. The entries left are the page-component copies the PRD gives to each page's own phase.
type Shape = 'chip' | 'dot' | 'tag';

const PENDING: Record<string, Partial<Record<Shape, number>> & { owner: string }> = {
  // The Booth's control-bar chip.
  'src/components/booth/ReadingControlBar.tsx': { chip: 1, owner: 'Phase 13' },
  // The Proof notes header's sources line and the legend's dots.
  'src/components/proof/NotesHeader.tsx': { chip: 1, owner: 'Phase 12' },
  'src/components/proof/NotesStrip.tsx': { dot: 1, owner: 'Phase 12' },
  // Not a copy to migrate: the script mark's character tag is CSS generated content (`before:`), never an element, so the
  // selection offsets see only the manuscript's text (ADR 0382); it is sized in em to ride the reading text.
  'src/components/manuscript/MarkupMark.tsx': { tag: 1, owner: 'none: generated content, ADR 0382' },
};

const DOT_SIZES = new Set(['size-1.5', 'size-2', 'size-[6px]', 'size-[7px]', 'size-[8px]', 'size-[0.5rem]']);
const TAG_RADIUS = /^rounded-\[(0\.[12]\d*rem|[2-4]px)\]$/;

function shapeOf(classes: string): Shape | undefined {
  const tokens = classes.split(/\s+/).map((token) => token.replace(/^[a-z-]+:/, ''));
  // A text highlight pads a word by a hair (`px-[0.05em]`, `px-[0.15em]`: under 0.2 em); a chip or tag pads its label.
  const padded = tokens.some((token) => /^px-/.test(token) && !/^px-\[0\.[01]\d*em\]$/.test(token));
  if (tokens.includes('rounded-full')) {
    if (tokens.some((token) => DOT_SIZES.has(token))) return 'dot';
    if (padded) return 'chip';
  }
  if (padded && tokens.some((token) => TAG_RADIUS.test(token))) return 'tag';
  return undefined;
}

const root = join(__dirname, '..');
const componentsDir = join(__dirname, 'components');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'primitives' ? [] : sources(path);
    return /\.tsx$/.test(entry.name) && !/\.(test|stories)\.tsx$/.test(entry.name) ? [path] : [];
  });
}

function count(source: string): Partial<Record<Shape, number>> {
  const counts: Partial<Record<Shape, number>> = {};
  // Every string literal: a className, a template's static parts, a class constant.
  for (const [, literal] of source.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
    const shape = shapeOf(literal);
    if (shape) counts[shape] = (counts[shape] ?? 0) + 1;
  }
  return counts;
}

const found = Object.fromEntries(
  sources(componentsDir)
    .map((path) => [relative(root, path).split(sep).join('/'), count(readFileSync(path, 'utf8'))] as const)
    .filter(([, counts]) => Object.keys(counts).length > 0),
);

describe('every pill is THE pill (ADR 0600)', () => {
  test('recognises the three copies and not the primitive-shaped things around them', () => {
    expect(shapeOf('inline-flex rounded-full border px-2 py-0.5 text-[0.72rem] uppercase')).toBe('chip');
    expect(shapeOf('size-2 flex-none rounded-full')).toBe('dot');
    expect(shapeOf('rounded-[0.2rem] px-1.5 py-0.5 text-xs')).toBe('tag');
    // A progress track, a card, a button.
    expect(shapeOf('mt-2 h-2 rounded-full')).toBeUndefined();
    expect(shapeOf('rounded-lg border p-4')).toBeUndefined();
    expect(shapeOf('rounded-md border px-4 py-2')).toBeUndefined();
    // A highlighted word in running text.
    expect(shapeOf('rounded-[0.15rem] px-[0.05em]')).toBeUndefined();
  });

  test('no file outside the primitives draws a pill, tag or dot of its own, beyond its phase allowance', () => {
    const over = Object.entries(found).flatMap(([file, counts]) =>
      (Object.entries(counts) as [Shape, number][])
        .filter(([shape, n]) => n > (PENDING[file]?.[shape] ?? 0))
        .map(([shape, n]) => `${file}: ${n} ${shape}(s), allowed ${PENDING[file]?.[shape] ?? 0}`),
    );
    expect(over, 'draw it with StatusBadge, Badge, Dot, SpeakerTag or Pill (primitives/StatusBadge.tsx)').toEqual([]);
  });

  test('an allowance only shrinks: lower it (or delete it) when its copy is migrated', () => {
    const stale = Object.entries(PENDING).flatMap(([file, { owner: _owner, ...allowed }]) =>
      (Object.entries(allowed) as [Shape, number][])
        .filter(([shape, n]) => (found[file]?.[shape] ?? 0) < n)
        .map(([shape, n]) => `${file}: allowed ${n} ${shape}(s), found ${found[file]?.[shape] ?? 0}`),
    );
    expect(stale).toEqual([]);
  });
});
