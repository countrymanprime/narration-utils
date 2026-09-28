// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// ADR 0595 (mock-fidelity PRD, Phase 1): `Button` owns its look, measured from the approved mocks: its height (`size`), padding,
// type, radius and border. A page picks a `variant` and a `size` and uses `className` for layout only (margin, width, flex,
// visibility). Before this, about 30 call sites shrank the button through `className` in 7 different recipes, so no two small
// buttons matched. This scan reads every `<Button>` outside `components/primitives/` and counts, per file, the ones whose
// `className` sets the look. A file's count may only go down, the same ratchet as `rawNatives.test.ts`.
//
// The files left are owned by a later phase of the same PRD, which composes the fixed primitive when it redraws its page
// ("Ownership rule": a primitive phase does not edit a page-specific component's files).
const CEILING: Record<string, number> = {
  // Phase 13 (the Booth transport and reading surface, mocks 03 and 07): the top bar's Companion and Exit buttons, the companion's
  // Full app and its toolbar recipe.
  'src/components/booth/BoothView.tsx': 2,
  'src/components/booth/CompanionShell.tsx': 4,
  // Phase 15 (the Script prep rail and chapter list, mock 02).
  'src/components/script/ScriptPage.tsx': 2,
  'src/components/script/ScriptRail.tsx': 1,
  // Phase 8 (the header, serial on AppShell.tsx): the zoom readout, a mono number between the zoom buttons.
  'src/components/layout/AppShell.tsx': 1,
  // Phase 2: the Stage summary's chips are chips drawn as buttons, and become StatusBadges.
  'src/components/stages/StageSummary.tsx': 3,
  // Phases 5 and 10: the selection menu's joined buttons become a Toolbar holding a segmented group.
  'src/components/manuscript/SelectionMenu.tsx': 4,
};

// A class that sets what `Button` owns. Variant prefixes (`max-sm:`, `hover:`) and the important mark (`!`) are stripped first.
const LOOK =
  /^-?(p[xytrbl]?|h|min-h|max-h|size|leading|tracking|rounded|font|gap|border)(-|$)|^text-(xs|sm|base|lg|[2-9]?xl|\[\d|\[length)|^(normal-case|uppercase|lowercase)$/;

function lookClasses(classString: string): string[] {
  return classString
    .split(/\s+/)
    .map((token) => token.replace(/^!|!$/g, '').split(':').at(-1) ?? '')
    .filter((token) => LOOK.test(token));
}

// Every string a `className` expression can produce: literals, template parts, both arms of a conditional, and a `const` in the
// same file that holds a string (`className={SMALL}`).
function classStrings(expression: ts.Expression, constants: Map<string, ts.Expression>): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isTemplateExpression(expression)) {
    return [expression.head.text, ...expression.templateSpans.flatMap((span) => [...classStrings(span.expression, constants), span.literal.text])];
  }
  if (ts.isParenthesizedExpression(expression)) return classStrings(expression.expression, constants);
  if (ts.isConditionalExpression(expression)) return [...classStrings(expression.whenTrue, constants), ...classStrings(expression.whenFalse, constants)];
  if (ts.isBinaryExpression(expression)) return [...classStrings(expression.left, constants), ...classStrings(expression.right, constants)];
  if (ts.isIdentifier(expression)) {
    const value = constants.get(expression.text);
    return value ? classStrings(value, constants) : [];
  }
  return [];
}

// The `<Button>`s in a file whose `className` sets part of the look, as `line: classes`.
function scan(source: string, fileName = 'probe.tsx'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const constants = new Map<string, ts.Expression>();
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(file);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(file) === 'Button') {
      // A `link` draws no chrome and takes the type of the sentence it sits in, so a class that sets its type is its to set.
      const isLink = node.attributes.properties.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'variant' && attribute.initializer?.getText(file) === '"link"',
      );
      for (const attribute of isLink ? [] : node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(file) !== 'className' || !attribute.initializer) continue;
        const initializer = attribute.initializer;
        const expression = ts.isJsxExpression(initializer) ? initializer.expression : initializer;
        if (!expression) continue;
        const look = classStrings(expression, constants).flatMap(lookClasses);
        if (look.length > 0) found.push(`${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${look.join(' ')}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const uiRoot = join(__dirname, '..');
const primitivesDir = join('src', 'components', 'primitives');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return /\.tsx$/.test(entry.name) && !/\.(test|stories)\.tsx$/.test(entry.name) ? [path] : [];
  });
}

describe('Button owns its look (ADR 0595)', () => {
  const scans = tsxFiles(join(uiRoot, 'src'))
    .map((path) => relative(uiRoot, path))
    .filter((file) => !file.startsWith(primitivesDir + sep))
    .map((file) => [file.split(sep).join('/'), scan(readFileSync(join(uiRoot, file), 'utf8'), file)] as const)
    .filter(([, found]) => found.length > 0);

  test('no page sets a Button’s padding, type, height, radius or border through className', () => {
    const grew = scans.filter(([file, found]) => found.length > (CEILING[file] ?? 0)).map(([file, found]) => `${file} ${found.join('; ')}`);
    expect(grew, 'pick a `size` (md 32 px, sm 28 px) and a `variant` instead; className is for layout only').toEqual([]);
  });

  test('a ceiling comes down as its file is migrated (delete the entry at zero)', () => {
    const counts = Object.fromEntries(scans.map(([file, found]) => [file, found.length]));
    const stale = Object.entries(CEILING).filter(([file, allowed]) => (counts[file] ?? 0) < allowed);
    expect(stale).toEqual([]);
  });

  test('the scan sees each way of writing an override (a bad fixture per form)', () => {
    expect(scan('const a = <Button className="px-3 py-1">x</Button>;')).toEqual(['1: px-3 py-1']);
    expect(scan('const a = <Button className="text-xs" />;')).toEqual(['1: text-xs']);
    expect(scan('const a = <Button className={`max-sm:px-2! ${b}`} />;')).toEqual(['1: px-2']);
    expect(scan('const SMALL = "px-2 py-0.5 text-[0.75rem]";\nconst a = <Button className={SMALL} />;')).toEqual(['2: px-2 py-0.5 text-[0.75rem]']);
    expect(scan('const a = <Button className={on ? "rounded-none" : "h-6"} />;')).toEqual(['1: rounded-none h-6']);
    expect(scan('const a = <Button className="normal-case gap-1" />;')).toEqual(['1: normal-case gap-1']);
  });

  test('layout, colour and other components pass', () => {
    expect(scan('const a = <Button className="mt-2 ml-auto w-full self-start max-sm:hidden" />;')).toEqual([]);
    expect(scan('const a = <Button className="text-[var(--danger-text)]" />;')).toEqual([]);
    expect(scan('const a = <IconButton className="px-3" />;')).toEqual([]);
    expect(scan('const a = <Button variant="link" className="font-semibold text-[0.75rem]" />;')).toEqual([]);
    expect(scan('const a = <div className="px-3 text-xs" />;')).toEqual([]);
  });
});
