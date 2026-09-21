import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// ADR 0069: a value that crossed a boundary is checked by a schema through `parseWire`, and never asserted with `as` or
// trusted after `JSON.parse`. Non-test code under src/api may not contain a type assertion (other than `as const`) or a
// `JSON.parse` outside `wire/`, except the entries in ALLOWED below, each with the reason it is not a boundary payload. The
// list can only shrink: an entry that no longer matches anything fails, so a removed cast has to be removed from it too.
//
// A test and not an ESLint `no-restricted-syntax` rule, because the tooling's config-protection hook refuses edits to
// eslint.config.js (recorded in ADR 0069); like baseUiBoundary.test.ts it reads the TypeScript syntax tree and proves itself
// on the deliberately bad fixtures below.
const apiRoot = __dirname;
const SOURCE = /\.tsx?$/;

type Finding = { file: string; text: string; kind: 'assertion' | 'JSON.parse' };

function findings(source: string, fileName: string): Finding[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const isConst = ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(file) === 'const';
      if (!isConst) found.push({ file: fileName, text: `as ${node.type.getText(file)}`, kind: 'assertion' });
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(file) === 'JSON' &&
      node.expression.name.text === 'parse'
    ) {
      // JSON.parse(JSON.stringify(x)) is a deep copy of a value the UI built, not a payload.
      const argument = node.arguments[0]?.getText(file) ?? '';
      if (!argument.startsWith('JSON.stringify(')) found.push({ file: fileName, text: `JSON.parse(${argument})`, kind: 'JSON.parse' });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function boundaryFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return boundaryFiles(path);
    return SOURCE.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

// What the scan reports: `as <Type>` for an assertion and `JSON.parse(<argument>)` for a parse, keyed by file (relative, forward slashes).
const ALLOWED: Array<{ file: string; text: string; reason: string }> = [
  { file: 'wailsClient.ts', text: 'as Record<string, string>', reason: 'an argument the UI sends to the host, not a payload it receives' },
  { file: 'wire/parseWire.ts', text: 'JSON.parse(text)', reason: 'the one place JSON text is parsed: its result goes straight into the schema' },
  {
    file: 'wailsClient.ts',
    text: 'JSON.parse(payload)',
    reason: 'the string form of a teleprompter event; the result is checked by liveEvent on the next line',
  },
  // Removed with the bindings still on decodeUnchecked (phases 4 and 5 of the boundary PRD).
  { file: 'wailsClient.ts', text: 'JSON.parse(value)', reason: 'decodeUnchecked, replaced binding by binding in phases 4 and 5' },
  { file: 'wailsClient.ts', text: 'as T', reason: 'decodeUnchecked, replaced binding by binding in phases 4 and 5' },
  { file: 'wailsClient.ts', text: 'as T', reason: 'decodeUnchecked (the undefined branch), replaced in phases 4 and 5' },
  // The mock client builds its own answers; the contract tests validate them, and phase 5 gives the casts below a schema.
  { file: 'mockApi.ts', text: 'as HostReady', reason: 'mock answer; validated by wireContracts.test.ts, removed in phase 5' },
  { file: 'mockApi.ts', text: 'as Bootstrap', reason: 'mock answer; validated by wireContracts.test.ts, removed in phase 5' },
  { file: 'mockApi.ts', text: 'as TtsCatalog', reason: 'mock answer; removed when the TTS schemas land in phase 5' },
  { file: 'mockApi.ts', text: 'as TtsInstallJob', reason: 'mock answer; removed when the TTS schemas land in phase 5' },
  { file: 'mockApi.ts', text: 'as WhisperCatalog', reason: 'mock answer; removed when the Whisper schemas land in phase 5' },
  { file: 'mockApi.ts', text: 'as WhisperInstallJob', reason: 'mock answer; removed when the Whisper schemas land in phase 5' },
  { file: 'mockApi.ts', text: 'as ChapterStatus', reason: 'a status the mock UI passes in, narrowed by hand; removed in phase 4' },
  { file: 'schemas/strictness.ts', text: 'as { _zod: { def: Def } }', reason: 'test tooling that reads the schema definition; it never sees a payload' },
  { file: 'schemas/strictness.ts', text: 'as Record<string, unknown>', reason: 'test tooling that reads the schema definition; it never sees a payload' },
  { file: 'schemas/strictness.ts', text: 'as unknown[]', reason: 'test tooling that reads the schema definition; it never sees a payload' },
  { file: 'schemas/strictness.ts', text: 'as Array<z.ZodType>', reason: 'test tooling that reads the schema definition; it never sees a payload' },
];

const relativeName = (path: string) => relative(apiRoot, path).split(sep).join('/');

describe('no boundary payload is asserted or trusted (ADR 0069)', () => {
  test('non-test code under src/api has no cast or JSON.parse beyond the reasoned allowlist', () => {
    const all = boundaryFiles(apiRoot).flatMap((path) => findings(readFileSync(path, 'utf8'), relativeName(path)));
    // A second cast with the same text as an allowed one is not allowed: each entry covers exactly one finding.
    const remaining = [...ALLOWED];
    const unexplained = all.filter((found) => {
      const index = remaining.findIndex((allowed) => allowed.file === found.file && allowed.text === found.text);
      if (index === -1) return true;
      remaining.splice(index, 1);
      return false;
    });
    expect(unexplained.map((found) => `${found.file}: ${found.text}`)).toEqual([]);
  });

  test('every allowlist entry still matches something, so the list only shrinks', () => {
    const all = boundaryFiles(apiRoot).flatMap((path) => findings(readFileSync(path, 'utf8'), relativeName(path)));
    // Two entries for the same text must match two findings, so a removed second cast is not hidden by the first.
    const remaining = [...all];
    const stale = ALLOWED.filter((allowed) => {
      const index = remaining.findIndex((found) => found.file === allowed.file && found.text === allowed.text);
      if (index === -1) return true;
      remaining.splice(index, 1);
      return false;
    });
    expect(stale.map((allowed) => `${allowed.file}: ${allowed.text}`)).toEqual([]);
  });

  test('every allowlist entry says why', () => {
    expect(ALLOWED.filter((allowed) => allowed.reason.trim().length < 10)).toEqual([]);
  });
});

describe('the scan sees each way of trusting a payload', () => {
  test.each([
    ['as T after JSON.parse', 'const v = JSON.parse(text) as Bootstrap;', ['assertion', 'JSON.parse']],
    ['an angle-bracket assertion', 'const v = <Bootstrap>value;', ['assertion']],
    ['as unknown as T', 'const v = raw as unknown as Bootstrap;', ['assertion', 'assertion']],
    ['a cast on an awaited binding', 'const v = (await host.Ready()) as Ready;', ['assertion']],
    ['a cast inside a callback', 'EventsOn("x", (payload) => onUpdate(payload as State));', ['assertion']],
  ])('%s', (_name, source, kinds) => {
    expect(findings(source, 'probe.ts').map((found) => found.kind)).toEqual(kinds);
  });

  test('as const, a plain JSON.stringify and a schema call are fine', () => {
    expect(findings('const a = ["x"] as const; const b = JSON.stringify(a); const c = parseWire(schema, a, ctx);', 'probe.ts')).toEqual([]);
  });
});
