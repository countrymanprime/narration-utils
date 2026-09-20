import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// ADR 0047: Base UI is an implementation detail of the primitives. Pages, feature components, tests and the stories that
// sit outside `components/primitives/` reach it only through a primitive, so the library can be upgraded or replaced by
// editing that folder alone. Every way of naming the package counts: an import (a type import too, because a Base UI
// type in a page's props would leak the library and the primitives export their own prop types), an `export ... from`,
// a dynamic `import()`, an `import('...')` type, `declare module`, and any call that takes the package name as its first
// argument (`require`, `vi.mock`, `vi.importActual`). It is read with the TypeScript parser, so a comment or a string
// that only mentions the package is fine.
//
// A test and not a lint rule because ADR 0046 already puts mechanical import rules in the Vitest and pytest runs, and a
// test proves itself on the deliberately bad fixtures below. An ESLint `no-restricted-imports` block is a second guard
// the verification tooling PRD plans (its phase 9).
const BASE_UI = /^@base-ui(\/|$)/;

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?js$/.test(fileName) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

// A file is parsed as its own kind: a `.ts` file that casts with `<T>x` is not JSX, and parsing it as TSX would swallow the
// rest of the file and hide a later import.
function baseUiSpecifiers(source: string, fileName = 'probe.ts'): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  const found: string[] = [];
  const consider = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node) && BASE_UI.test(node.text)) found.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) consider(node.moduleSpecifier);
    else if (ts.isExternalModuleReference(node)) consider(node.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) consider(node.argument.literal);
    else if (ts.isModuleDeclaration(node)) consider(node.name);
    else if (ts.isCallExpression(node)) consider(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const uiRoot = join(__dirname, '..');
const primitivesDir = join('src', 'components', 'primitives');
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;

function sourceFiles(dir: string, recursive: boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'wailsjs') return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return recursive ? sourceFiles(path, true) : [];
    return SOURCE.test(entry.name) ? [path] : [];
  });
}

describe('the Base UI import boundary (ADR 0047)', () => {
  test('no file outside components/primitives imports Base UI', () => {
    // The package's own config files sit at its root (vite.config.ts and friends), the rest in these folders.
    const files = [...sourceFiles(uiRoot, false), ...['src', 'tests', 'scripts', '.storybook'].flatMap((dir) => sourceFiles(join(uiRoot, dir), true))];
    const offenders = files
      .map((file) => relative(uiRoot, file))
      .filter((file) => !file.startsWith(primitivesDir + sep))
      .filter((file) => baseUiSpecifiers(readFileSync(join(uiRoot, file), 'utf8'), file).length > 0);
    expect(offenders, 'Base UI is used only inside src/components/primitives/ (ADR 0047): import the primitive instead, or add one').toEqual([]);
  });

  test('the scan sees every way of naming it (a bad fixture per form)', () => {
    expect(baseUiSpecifiers("import { Dialog } from '@base-ui/react/dialog';")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("import type { DialogRootProps } from '@base-ui/react/dialog';")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("import { Dialog } from '@base-ui/react';")).toEqual(['@base-ui/react']);
    expect(baseUiSpecifiers("export { Dialog } from '@base-ui/react/dialog';")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("export const load = () => import('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("const { Dialog } = require('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("import Dialog = require('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("type Root = typeof import('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("vi.mock('@base-ui/react/dialog', () => ({}));")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("const real = await vi.importActual('@base-ui/react/dialog');")).toEqual(['@base-ui/react/dialog']);
    expect(baseUiSpecifiers("declare module '@base-ui/react/dialog' { export const x: number; }")).toEqual(['@base-ui/react/dialog']);
  });

  test('a .ts file with a type assertion is still read to the end', () => {
    // Parsed as TSX, `<Foo>bar` opens a JSX element and the import below it is never visited.
    const source = "const a = <Foo>bar;\nexport const load = () => import('@base-ui/react/dialog');\n";
    expect(baseUiSpecifiers(source, 'util.ts')).toEqual(['@base-ui/react/dialog']);
  });

  test('the scan ignores other packages, comments and strings', () => {
    expect(baseUiSpecifiers("import { useState } from 'react';")).toEqual([]);
    expect(baseUiSpecifiers("import x from '@base-ui-components/react';")).toEqual([]);
    expect(baseUiSpecifiers('// import { Dialog } from \'@base-ui/react/dialog\';\nexport const s = "@base-ui/react";')).toEqual([]);
    expect(baseUiSpecifiers("console.log('a note about @base-ui/react');")).toEqual([]);
  });
});
