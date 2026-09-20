import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// ADR 0047: Base UI is an implementation detail of the primitives. Pages, feature components, tests and the stories that
// sit outside `components/primitives/` reach it only through a primitive, so the library can be upgraded or replaced by
// editing that folder alone. A type import counts (a Base UI type in a page's props would leak the library, and the
// primitives export their own prop types), and so do a dynamic `import()`, a `require()`, an `export ... from` and an
// `import('...')` type. Read with the TypeScript parser, so a comment or a string that only mentions the package is fine.
//
// Why a test and not an ESLint rule: the same check as a `no-restricted-imports` block in eslint.config.js is the obvious
// form, but that file is protected against agent edits in this repository's tooling, and ADR 0046 already puts
// mechanically checkable rules in the Vitest and pytest runs. The rule is proven to fire on a deliberately bad fixture below.
const BASE_UI = /^@base-ui(\/|$)/;

function baseUiSpecifiers(source: string): string[] {
  const file = ts.createSourceFile('probe.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const consider = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node) && BASE_UI.test(node.text)) found.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) consider(node.moduleSpecifier);
    else if (ts.isExternalModuleReference(node)) consider(node.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) consider(node.argument.literal);
    else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      consider(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const uiRoot = join(__dirname, '..');
const primitivesDir = join('src', 'components', 'primitives');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'wailsjs') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

describe('the Base UI import boundary (ADR 0047)', () => {
  test('no file outside components/primitives imports Base UI', () => {
    const offenders = ['src', 'tests', '.storybook']
      .flatMap((dir) => sourceFiles(join(uiRoot, dir)))
      .map((file) => relative(uiRoot, file))
      .filter((file) => !file.startsWith(primitivesDir + sep))
      .filter((file) => baseUiSpecifiers(readFileSync(join(uiRoot, file), 'utf8')).length > 0);
    expect(offenders, 'Base UI is used only inside src/components/primitives/ (ADR 0047): import the primitive instead, or add one').toEqual([]);
  });

  test('the scan sees every way of importing it (a bad fixture per form)', () => {
    expect(baseUiSpecifiers("import { Dialog } from '@base-ui/react/dialog';")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("import type { DialogRootProps } from '@base-ui/react/dialog';")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("import { Dialog } from '@base-ui/react';")).toEqual(['@base-ui/react']);
    expect(baseUiSpecifiers("export { Dialog } from '@base-ui/react/dialog';")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("export const load = () => import('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("const { Dialog } = require('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("import Dialog = require('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("type Root = typeof import('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
  });

  test('the scan ignores other packages, comments and strings', () => {
    expect(baseUiSpecifiers("import { useState } from 'react';")).toEqual([]);
    expect(baseUiSpecifiers("import x from '@base-ui-components/react';")).toEqual([]);
    expect(baseUiSpecifiers('// import { Dialog } from \'@base-ui/react/dialog\';\nexport const s = "@base-ui/react";')).toEqual([]);
  });
});
