// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// ADR 0361 (input-commands-and-pedals.prd.md Phase 1): a command is registered with `useCommand`, never heard with a
// feature's own `keydown` listener - the rule that made three listeners quietly disagree on modifiers, dialogs and
// fields in the first place. This scan (in the style of rawNatives.test.ts) fails on `<target>.addEventListener('keydown', ...)`
// outside `src/input/`, unless the file is in ALLOWLIST below, and each entry there must say why. A file dropped from
// the allowlist here has its keydown listener removed elsewhere in the same change, so the entry is deleted too.
type Reason = { readonly note: string };

// Permanent: not a command, so never migrated onto the registry.
const PERMANENT: Record<string, Reason> = {
  'src/components/primitives/inputModality.ts': { note: 'tracks the last input modality (keyboard vs pointer), not a command' },
  'src/components/primitives/Tooltip.tsx': { note: 'Escape closes the tooltip (WCAG 1.4.13), a widget key owned by the primitive, not a command' },
  'src/components/manuscript/SelectionMenu.tsx': { note: 'Escape closes the selection menu, a widget key owned by the primitive, not a command' },
  'src/components/teleprompter/useFollowCursor.ts': { note: 'isScrollKey detects a hand scroll (ADR 0119), not a command' },
};

// Temporary: today's three command listeners this PRD replaces. Each entry names the phase that migrates it onto
// `useCommand` and is deleted in that phase's pull request.
const TEMPORARY: Record<string, Reason> = {
  'src/components/workspace/WorkspacePage.tsx': { note: 'Space, arrows, [ ] - migrated in Phase 3 (input-commands-and-pedals.prd.md)' },
};

const ALLOWLIST: Record<string, Reason> = { ...PERMANENT, ...TEMPORARY };

const uiRoot = join(__dirname, '..');
const srcRoot = join(uiRoot, 'src');
const inputDir = join('src', 'input');
const SOURCE = /\.(ts|tsx)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

// Reads with the TypeScript parser (like rawNatives.test.ts), so a comment or a string mentioning "keydown" is not a
// hit, and only `<expr>.addEventListener('keydown', ...)` counts, whatever the target expression is (`document`,
// `window`, an injected target, ...).
function keydownListenerCount(source: string, fileName: string): number {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addEventListener' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      node.arguments[0].text === 'keydown'
    ) {
      count++;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

describe('command listeners stay inside src/input/ (ADR 0361)', () => {
  const files = sourceFiles(srcRoot)
    .map((file) => relative(uiRoot, file))
    .filter((file) => !file.startsWith(inputDir + sep))
    .map((file) => file.split(sep).join('/'));
  const counts = new Map(files.map((file) => [file, keydownListenerCount(readFileSync(join(uiRoot, file), 'utf8'), file)]));

  test('no file outside the allowlist adds a keydown listener', () => {
    const offenders = files.filter((file) => (counts.get(file) ?? 0) > 0 && !(file in ALLOWLIST));
    expect(
      offenders,
      'register a command with useCommand (src/input/useCommand.ts) instead of listening for keydown yourself; ' +
        'if this really is not a command, add a reasoned entry to listenerGuard.test.ts',
    ).toEqual([]);
  });

  test('every allowlist entry still has a keydown listener (delete a stale entry)', () => {
    const stale = Object.keys(ALLOWLIST).filter((file) => (counts.get(file) ?? 0) === 0);
    expect(stale, 'this file no longer adds a keydown listener - delete its listenerGuard.test.ts entry').toEqual([]);
  });

  test('the scan sees the call however it is written (a bad fixture per form)', () => {
    expect(keydownListenerCount("document.addEventListener('keydown', onKeyDown);", 'probe.ts')).toBe(1);
    expect(keydownListenerCount('window.addEventListener("keydown", onKeyDown, true);', 'probe.ts')).toBe(1);
    expect(keydownListenerCount("target.current!.addEventListener('keydown', onKeyDown);", 'probe.ts')).toBe(1);
  });

  test('the scan ignores a comment or a string that only mentions keydown, and a different event', () => {
    expect(keydownListenerCount('// document.addEventListener(\'keydown\', x)\nconst a = "keydown";', 'probe.ts')).toBe(0);
    expect(keydownListenerCount("document.addEventListener('keyup', onKeyUp);", 'probe.ts')).toBe(0);
  });
});
