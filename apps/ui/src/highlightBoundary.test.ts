import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// ADR 0016: `Highlight` is the only way to render highlighted text, so the `<mark>` element is written in
// `components/primitives/Highlight.tsx` and nowhere else (ADR 0062 makes that a check). A `<mark>` written by hand gets
// the browser's default yellow, not the entry's colour. The scan reads the TypeScript syntax tree, so a comment or a
// string that only mentions `<mark>` is fine, and it sees `createElement('mark')` and the compiled `jsx('mark')` calls as well
// as JSX. A tag held in a variable (`const Tag = 'mark'`) or passed as a prop (`as="mark"`) is not seen.
//
// A test and not an ESLint `no-restricted-syntax` rule: the PRD planned the lint rule, but the config-protection hook of
// the tooling refuses edits to `eslint.config.js`, and ADR 0047 already keeps the Base UI boundary in this style, with a
// bad fixture per form of the violation. Should the lint rule be wanted later, the selector is
// `JSXOpeningElement[name.name='mark']`.
const HOME = 'src/components/primitives/Highlight.tsx';

// The one deliberate exception. `InlineDiffRow` marks the words that differ between the script and what was heard, in the
// colour of the discrepancy kind, not of a story-bible entry: it is not highlighted entry text, so it does not go through
// `highlightKind`. Whether ADR 0016 should say so, or `Highlight` should take a kind, is a question for the owner (ADR
// 0063, Proposed). The entry goes when that is settled.
// The count is pinned too, so a second `<mark>` with another meaning cannot ride on the entry.
const ALLOWED: Record<string, { marks: number; reason: string }> = {
  'src/components/proofing/InlineDiffRow.tsx': { marks: 1, reason: 'marks differing words in the discrepancy colour, not an entry category (ADR 0063)' },
};

function scriptKind(fileName: string): ts.ScriptKind {
  if (/\.[cm]?tsx?$/.test(fileName)) return fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return fileName.endsWith('x') ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
}

/** The number of `<mark>` elements (JSX, `createElement('mark')` or `jsx('mark')`) a source file writes. */
function markElements(source: string, fileName = 'probe.tsx'): number {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  let count = 0;
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'mark') count += 1;
    else if (ts.isCallExpression(node) && /(^|\.)(createElement|_?jsxs?|jsxDEV)$/.test(node.expression.getText(file))) {
      const tag = node.arguments[0];
      if (tag && ts.isStringLiteralLike(tag) && tag.text === 'mark') count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

const uiRoot = join(__dirname, '..');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

// Forward slashes so the paths read the same on Windows and in the allowlist.
const marksByFile = new Map(
  ['src', 'tests', '.storybook']
    .flatMap((dir) => sourceFiles(join(uiRoot, dir)))
    .map((file) => [relative(uiRoot, file).split('\\').join('/'), markElements(readFileSync(file, 'utf8'), file)] as const)
    .filter(([, count]) => count > 0),
);

describe('one Highlight for highlighted text (ADR 0016)', () => {
  test('no file writes <mark> except Highlight and the allowlisted exception', () => {
    const offenders = [...marksByFile.keys()].filter((file) => file !== HOME && !(file in ALLOWED));
    expect(offenders, 'Render highlighted text with the Highlight primitive, not <mark> (ADR 0016)').toEqual([]);
  });

  test('Highlight still writes the mark, and every allowlist entry is still needed and says why', () => {
    expect(marksByFile.get(HOME), `${HOME} is where <mark> lives`).toBeGreaterThan(0);
    for (const [file, { marks, reason }] of Object.entries(ALLOWED)) {
      expect(marksByFile.get(file), `${file} no longer writes exactly ${marks} <mark>: delete or update its allowlist entry`).toBe(marks);
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(10);
    }
  });

  test('the scan sees a <mark> however it is written (a bad fixture per form)', () => {
    expect(markElements('export const A = () => <mark>x</mark>;')).toBe(1);
    expect(markElements('export const A = () => <mark className="a" />;')).toBe(1);
    expect(markElements("export const a = createElement('mark', null, 'x');")).toBe(1);
    expect(markElements("export const a = React.createElement('mark');")).toBe(1);
    expect(markElements("import { jsx as _jsx } from 'react/jsx-runtime'; export const a = _jsx('mark', { children: 'x' });")).toBe(1);
    expect(markElements("export const a = jsxs('mark', { children: [] });", 'probe.js')).toBe(1);
    expect(markElements('export const A = () => <mark />;', 'probe.jsx')).toBe(1);
    expect(markElements('export const A = () => <><mark>a</mark><mark>b</mark></>;')).toBe(2);
  });

  test('the scan ignores other elements, components, comments and strings', () => {
    expect(markElements('export const A = () => <Mark>x</Mark>;')).toBe(0);
    expect(markElements('export const A = () => <span data-kind="mark">x</span>;')).toBe(0);
    expect(markElements("export const s = '<mark>x</mark>'; // <mark>")).toBe(0);
    expect(markElements("export const a = createElement('span');")).toBe(0);
    expect(markElements('export const a = document.querySelector("mark");', 'probe.ts')).toBe(0);
  });
});
