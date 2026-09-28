// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

// The primitive owns the underline-tab and segmented-group look (mock-fidelity-primitives-and-components.prd.md Phase 5).
// The owner saw the Production board's step strip and the Master platform switch drawn as ad hoc spans and Buttons glued
// together with `rounded-none`/`border-l`, instead of `Tabs` or `ToggleGroup look="segmented"`. This scan catches a page
// that goes back to hand-drawing either shape:
// - an underline tab: `border-b-2` paired with `uppercase` (a tab strip fakes Tabs' selected-state border);
// - a segmented group: `rounded-none` paired with `border-l` (Buttons glued edge to edge fake ToggleGroup's container).
// A file may only go down: a ceiling above its real count fails, so an entry is lowered (or deleted at zero) in the change
// that migrates it.
type Shape = 'underline-tab' | 'segmented-group';

const PENDING: Record<string, Partial<Record<Shape, number>> & { owner: string }> = {
  // Four independent actions (Note, Mark up, Story Bible, Look up) glued into one strip by Phase 10's Toolbar wrapper — not
  // a single choice among them, so it is a toolbar's look, not ToggleGroup's. Phase 5 measured this and corrected the PRD's
  // "pretending to be a segmented group" line, which described the file before Phase 10 gave it real toolbar semantics.
  'src/components/manuscript/SelectionMenu.tsx': { 'segmented-group': 3, owner: 'none: independent toolbar actions, not a single-choice group' },
};

function shapesOf(classes: string): Shape[] {
  const tokens = classes.split(/\s+/).map((token) => token.replace(/^[a-z-]+:/, ''));
  const shapes: Shape[] = [];
  if (tokens.includes('border-b-2') && tokens.includes('uppercase')) shapes.push('underline-tab');
  if (tokens.includes('rounded-none') && tokens.some((token) => token === 'border-l' || /^border-l-/.test(token))) shapes.push('segmented-group');
  return shapes;
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
  for (const [, literal] of source.matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
    for (const shape of shapesOf(literal)) counts[shape] = (counts[shape] ?? 0) + 1;
  }
  return counts;
}

const found = Object.fromEntries(
  sources(componentsDir)
    .map((path) => [relative(root, path).split(sep).join('/'), count(readFileSync(path, 'utf8'))] as const)
    .filter(([, counts]) => Object.keys(counts).length > 0),
);

describe('the underline tab and the segmented group are drawn by Tabs and ToggleGroup (Phase 5)', () => {
  test('recognises the two hand-drawn shapes and not the primitive-shaped things around them', () => {
    expect(shapesOf('rounded px-2 py-1 font-semibold tracking-[0.08em] uppercase')).toEqual([]);
    expect(shapesOf('border-b-2 border-transparent px-[0.9rem] py-2 tracking-[0.08em] uppercase')).toEqual(['underline-tab']);
    expect(shapesOf('rounded-none border-0 text-xs')).toEqual([]);
    expect(shapesOf('rounded-none border-0 border-l border-l-[var(--border)] text-xs')).toEqual(['segmented-group']);
    // A card's bottom rule, a plain divider.
    expect(shapesOf('border-b-2 border-[var(--border)]')).toEqual([]);
    expect(shapesOf('rounded-none border-t')).toEqual([]);
  });

  test('no file outside the primitives draws an underline tab or a segmented group of its own, beyond its allowance', () => {
    const over = Object.entries(found).flatMap(([file, counts]) =>
      (Object.entries(counts) as [Shape, number][])
        .filter(([shape, n]) => n > (PENDING[file]?.[shape] ?? 0))
        .map(([shape, n]) => `${file}: ${n} ${shape}(s), allowed ${PENDING[file]?.[shape] ?? 0}`),
    );
    expect(over, 'draw it with Tabs or ToggleGroup look="segmented" (primitives/Tabs.tsx, primitives/ToggleGroup.tsx)').toEqual([]);
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
