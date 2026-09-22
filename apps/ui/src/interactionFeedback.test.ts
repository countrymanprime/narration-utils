// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';
import { FEEDBACK_CATALOG, SILENT_CATCHES } from './interactionFeedback.catalog';

// ADR 0075: every place the UI calls the host has a row in the interaction feedback catalog, with a verdict against the standard, and no failure
// of a narrator's action is swallowed without a reviewed reason. This test keeps that inventory honest. It reads the contracts and the source with
// the TypeScript parser (a comment or a string that mentions a method is not a call), so it needs no build.

const uiRoot = join(__dirname, '..');
const srcRoot = join(__dirname);
const contractsDir = join(srcRoot, 'api', 'contracts');
const NOT_UNDER_TEST = /\.(test|stories)\.tsx?$/;

const relativePath = (path: string) => relative(uiRoot, path).split(sep).join('/');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !NOT_UNDER_TEST.test(entry.name) ? [path] : [];
  });
}

function parse(source: string, fileName: string) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

/** The members of every `...Api` interface in the contracts: the methods the UI can call on the host. */
function apiMethods(): Set<string> {
  const methods = new Set<string>();
  for (const name of readdirSync(contractsDir)) {
    const file = parse(readFileSync(join(contractsDir, name), 'utf8'), name);
    file.forEachChild((node) => {
      if (!ts.isInterfaceDeclaration(node) || !node.name.text.endsWith('Api')) return;
      for (const member of node.members) if (ts.isMethodSignature(member) && ts.isIdentifier(member.name)) methods.add(member.name.text);
    });
  }
  return methods;
}

/** `<method>#<n>` for every call `x.<method>(...)` of an API method, n counting from 1 in source order. */
function callSites(source: string, methods: Set<string>, fileName = 'probe.tsx'): string[] {
  const file = parse(source, fileName);
  const counts = new Map<string, number>();
  const sites: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && methods.has(node.expression.name.text)) {
      const name = node.expression.name.text;
      const n = (counts.get(name) ?? 0) + 1;
      counts.set(name, n);
      sites.push(`${name}#${n}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return sites;
}

const isEmptyBlock = (block: ts.Block) => block.statements.length === 0;

/** A failure handler that does nothing with the failure: `catch {}` (a comment does not count), `.catch(() => {})` and `.catch(() => undefined)`. */
function silentCatches(source: string, fileName = 'probe.tsx'): number[] {
  const file = parse(source, fileName);
  const lines: number[] = [];
  const line = (node: ts.Node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && isEmptyBlock(node.block)) lines.push(line(node));
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch') {
      const handler = node.arguments[0];
      if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
        const body = handler.body;
        const nothing = ts.isBlock(body) ? isEmptyBlock(body) : ts.isIdentifier(body) ? body.text === 'undefined' : ts.isVoidExpression(body);
        if (nothing) lines.push(line(node));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return lines;
}

const methods = apiMethods();

/** Every site outside src/api, keyed `<file>::<method>#<n>`. */
const actualSites = new Set(
  sourceFiles(srcRoot)
    .map((path) => ({ path, name: relativePath(path) }))
    .filter(({ name }) => !name.startsWith('src/api/'))
    .flatMap(({ path, name }) => callSites(readFileSync(path, 'utf8'), methods, name).map((site) => `${name}::${site}`)),
);

const rows = Object.entries(FEEDBACK_CATALOG);
const PLAN = /^(P[3-7]|#\d+)$/;

describe('the scan itself', () => {
  test('finds a call on any object, numbers repeats, and ignores a comment, a string and a non-API method', () => {
    const source = `
      // api.guideEdit(x) is only mentioned here
      const text = 'api.guideEdit(x)';
      async function run(api: Api) {
        await api.guideEdit(1);
        await api.guideEdit(2);
        other.notAnApiMethod();
        void host.guideRescan(3);
      }`;
    expect(callSites(source, new Set(['guideEdit', 'guideRescan']))).toEqual(['guideEdit#1', 'guideEdit#2', 'guideRescan#1']);
  });

  test('reads the API methods out of the contracts', () => {
    expect(methods.has('guideEdit')).toBe(true);
    expect(methods.has('subscribeNotices')).toBe(true);
    expect(methods.size).toBeGreaterThan(70);
  });

  test('flags an empty catch, an empty handler and one that returns undefined, and nothing that does something', () => {
    const source = [
      'try { a(); } catch {}',
      'try { a(); } catch (e) { /* ignored */ }',
      'p.catch(() => {});',
      'p.catch(() => undefined);',
      'p.catch(function () {});',
      'try { a(); } catch (e) { report(e); }',
      'p.catch((e) => notify(e));',
      'p.catch(() => setValue(undefined));',
    ].join('\n');
    expect(silentCatches(source)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('the interaction feedback catalog', () => {
  test('has a row for every call the UI makes to the host', () => {
    const missing = [...actualSites].filter((site) => !(site in FEEDBACK_CATALOG)).sort();
    expect(missing, 'add a row (trigger, cost, acknowledgment, guard, completion, failure, navigation, verdict) for each call site').toEqual([]);
  });

  test('has no row for a call that is gone', () => {
    const stale = Object.keys(FEEDBACK_CATALOG)
      .filter((site) => !actualSites.has(site))
      .sort();
    expect(stale, 'delete the row, or rename its number: sites are counted in source order per file').toEqual([]);
  });

  test('every row says why in a sentence', () => {
    const short = rows.filter(([, row]) => row.note.trim().length < 10).map(([site]) => site);
    expect(short).toEqual([]);
  });

  test('a gap names who fixes it, an owned row names its owner, and nothing else carries a plan', () => {
    const wrong = rows.filter(([, row]) => {
      if (row.verdict === 'gap') return !PLAN.test(row.plan ?? '');
      if (row.verdict === 'owned') return !row.plan || row.plan.trim().length < 5;
      return row.plan !== undefined;
    });
    expect(wrong.map(([site]) => site)).toEqual([]);
  });

  test('a row that meets the standard does not fail silently and does not leave a Python call unacknowledged or unguarded', () => {
    const dishonest = rows
      .filter(([, row]) => row.verdict === 'ok')
      .filter(
        ([, row]) =>
          row.failure === 'silent' || row.failure === 'unhandled' || (row.cost === 'python' && (row.acknowledgment === 'none' || row.guard === 'none')),
      )
      .map(([site]) => site);
    expect(dishonest, 'an ok row must show its failures, and a Python-backed action must acknowledge and guard').toEqual([]);
  });
});

describe('swallowed errors', () => {
  const found = sourceFiles(srcRoot).flatMap((path) => {
    const name = relativePath(path);
    return silentCatches(readFileSync(path, 'utf8'), name).map((line, index) => ({ key: `${name}#${index + 1}`, line }));
  });

  test('every bare catch is on the reviewed list, with its reason', () => {
    const unreviewed = found.filter(({ key }) => !(key in SILENT_CATCHES)).map(({ key, line }) => `${key} (line ${line})`);
    expect(unreviewed, 'handle the failure, or add the site to SILENT_CATCHES with the reason it is safe to ignore').toEqual([]);
  });

  test('the reviewed list has no entry for a catch that is gone, and every entry says why', () => {
    const keys = new Set(found.map(({ key }) => key));
    expect(Object.keys(SILENT_CATCHES).filter((key) => !keys.has(key))).toEqual([]);
    expect(Object.entries(SILENT_CATCHES).filter(([, reason]) => reason.trim().length < 15)).toEqual([]);
  });
});
