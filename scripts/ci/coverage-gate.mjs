#!/usr/bin/env node
/**
 * The coverage ratchet (ADR 0043). Runs a project's tests with coverage on and compares each
 * logic directory with its floor in scripts/ci/coverage-floors.json:
 *
 *   node scripts/ci/coverage-gate.mjs go <projectRoot> [go test args]
 *   node scripts/ci/coverage-gate.mjs vitest <projectRoot>
 *   node scripts/ci/coverage-gate.mjs pytest <projectRoot> [pytest args]
 *
 * A directory below its floor fails the run, and so does one with no coverage data at all (a
 * renamed or deleted directory must be edited out of the floors file on purpose). Floors only go
 * up: `--update` rewrites them to the rounded-down measurement and never lowers one. The floor for
 * a new logic directory is TARGET (80); a lower floor needs a written `reason` in the file.
 * UI, glue and sidecar-launch code are not listed and so are not gated.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TARGET = 80;
/** A floor is only suggested for raising once coverage clears it by this many points. */
export const RAISE_MARGIN = 2;
export const FLOORS_PATH = fileURLToPath(new URL('./coverage-floors.json', import.meta.url));
const TOOLS = new Set(['go', 'vitest', 'pytest']);

const slash = (value) => value.split('\\').join('/');
const label = (entry) => `${entry.tool} ${entry.project} ${entry.path}`;

/** Per-package statement coverage from `go test -cover` output, as module-relative directories. */
export function parseGoCover(output, modulePath) {
  const packages = [];
  for (const line of output.split(/\r?\n/)) {
    const coverage = /coverage:\s*([\d.]+)% of statements/.exec(line);
    const pkg = line.split(/\s+/).find((token) => token === modulePath || token.startsWith(`${modulePath}/`));
    if (!coverage || !pkg) continue;
    packages.push({ path: pkg === modulePath ? '.' : pkg.slice(modulePath.length + 1), pct: Number(coverage[1]) });
  }
  return packages;
}

function relativeTo(root, file) {
  const base = slash(root).replace(/\/+$/, '');
  const path = slash(file);
  return path.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? path.slice(base.length + 1) : path;
}

/** Vitest `json-summary` (absolute file paths, line coverage) as project-relative files. */
export function normalizeVitestSummary(summary, projectRoot) {
  return Object.entries(summary)
    .filter(([file]) => file !== 'total')
    .map(([file, data]) => ({ path: relativeTo(projectRoot, file), covered: data.lines.covered, total: data.lines.total }));
}

/** A coverage.py `json` report as repository-relative files with forward slashes. */
export function normalizePytestReport(report) {
  return Object.entries(report.files).map(([file, data]) => ({ path: slash(file), covered: data.summary.covered_lines, total: data.summary.num_statements }));
}

/** Line coverage of a file or of every file under a directory; null when nothing matches. */
export function aggregateFiles(files, path) {
  const matched = files.filter((file) => file.path === path || file.path.startsWith(`${path}/`));
  if (matched.length === 0) return null;
  const total = matched.reduce((sum, file) => sum + file.total, 0);
  const covered = matched.reduce((sum, file) => sum + file.covered, 0);
  return total === 0 ? 100 : (100 * covered) / total;
}

/** A Go package is measured whole; there is no roll-up of its children. */
export function aggregatePackages(packages, path) {
  return packages.find((entry) => entry.path === path)?.pct ?? null;
}

export function validateFloors(doc) {
  const problems = [];
  const seen = new Set();
  for (const entry of doc.entries ?? []) {
    const id = label(entry);
    if (!TOOLS.has(entry.tool)) problems.push(`${id}: unknown tool "${entry.tool}"`);
    if (!entry.project || !entry.path) problems.push(`${id}: needs a project and path`);
    if (seen.has(id)) problems.push(`${id}: duplicate entry`);
    seen.add(id);
    if (!Number.isInteger(entry.floor)) problems.push(`${id}: floor must be a whole number`);
    else if (entry.floor < 0 || entry.floor > 100) problems.push(`${id}: floor must be between 0 and 100`);
    else if (entry.floor < TARGET && !entry.reason) problems.push(`${id}: floor ${entry.floor}% is below the ${TARGET}% target and has no reason`);
  }
  return problems;
}

/** `measure(entry)` returns the current percentage or null when there is no data. */
export function evaluate(entries, measure) {
  const failures = [];
  const notes = [];
  for (const entry of entries) {
    const pct = measure(entry);
    if (pct === null || pct === undefined) {
      failures.push(`${label(entry)}: no coverage data. If it was renamed or removed, edit scripts/ci/coverage-floors.json in the same change.`);
    } else if (pct + 1e-9 < entry.floor) {
      failures.push(`${label(entry)}: ${pct.toFixed(1)}% is below the floor ${entry.floor}%. Add tests; do not lower the floor to pass.`);
    } else if (pct >= entry.floor + RAISE_MARGIN) {
      notes.push(`${label(entry)}: ${pct.toFixed(1)}% clears the ${entry.floor}% floor; raise it to ${Math.floor(pct)} (run with --update).`);
    }
  }
  return { failures, notes };
}

/** A copy of the floors with each one raised to the rounded-down measurement; never lowered. */
export function raiseFloors(doc, measure) {
  return { ...doc, entries: doc.entries.map((entry) => ({ ...entry, floor: Math.max(entry.floor, Math.floor(measure(entry) ?? 0)) })) };
}

function readFloors() {
  const doc = JSON.parse(readFileSync(FLOORS_PATH, 'utf8'));
  const problems = validateFloors(doc);
  if (problems.length) {
    console.error(`scripts/ci/coverage-floors.json is invalid:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
    process.exit(2);
  }
  return doc;
}

/** Prints the verdict and returns the exit code; writes raised floors to `floorsPath` when `update` is set. */
export function report(doc, entries, measure, { update = false, floorsPath = FLOORS_PATH, log = console.log, error = console.error } = {}) {
  const { failures, notes } = evaluate(entries, measure);
  for (const note of notes) log(`coverage: ${note}`);
  if (update) {
    const next = raiseFloors(doc, (entry) => (entries.includes(entry) ? measure(entry) : entry.floor));
    writeFileSync(floorsPath, `${JSON.stringify(next, null, 2)}\n`);
    log('coverage: floors raised where coverage had risen.');
  }
  if (failures.length) {
    error(`\nCoverage gate failed:\n${failures.map((failure) => `  ${failure}`).join('\n')}`);
    return 1;
  }
  log(`coverage: ${entries.length} logic ${entries.length === 1 ? 'entry' : 'entries'} at or above their floors.`);
  return 0;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32' && command === 'pnpm', maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error) {
    console.error(`coverage: could not run ${command}: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

function runGo(projectRoot, extra) {
  const goMod = readFileSync(join(projectRoot, 'go.mod'), 'utf8');
  const modulePath = /^module\s+(\S+)/m.exec(goMod)?.[1];
  const result = run('go', ['-C', projectRoot, 'test', '-cover', ...extra, './...'], { stdio: ['inherit', 'pipe', 'inherit'] });
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0) process.exit(result.status ?? 1);
  const packages = parseGoCover(result.stdout, modulePath);
  return (entry) => aggregatePackages(packages, entry.path);
}

function reportsDir(name) {
  const dir = resolve('.cache', 'coverage', name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runVitest(projectRoot, entries) {
  const dir = reportsDir(`vitest-${projectRoot.replaceAll('/', '-')}`);
  // Only the listed logic files are instrumented: components and glue are not gated.
  const includes = entries.map((entry) => (/\.[a-z]+$/i.test(entry.path) ? entry.path : `${entry.path}/**`));
  const args = [
    '--dir',
    projectRoot,
    'exec',
    'vitest',
    'run',
    '--coverage.enabled',
    '--coverage.provider=v8',
    '--coverage.reporter=json-summary',
    `--coverage.reportsDirectory=${dir}`,
    ...includes.map((include) => `--coverage.include=${include}`),
  ];
  const result = run('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const files = normalizeVitestSummary(JSON.parse(readFileSync(join(dir, 'coverage-summary.json'), 'utf8')), resolve(projectRoot));
  return (entry) => aggregateFiles(files, entry.path);
}

function runPytest(projectRoot, extra) {
  const dir = reportsDir(`pytest-${projectRoot.replaceAll('/', '-')}`);
  const json = join(dir, 'coverage.json');
  const quality = fileURLToPath(new URL('../quality.mjs', import.meta.url));
  // quality.mjs picks the repository's Python and isolates pytest's temp directory.
  const result = run('node', [quality, 'pytest', ...extra, `--cov=${projectRoot}`, `--cov-report=json:${json}`], { stdio: 'inherit', env: { ...process.env, COVERAGE_FILE: join(dir, '.coverage') } });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const files = normalizePytestReport(JSON.parse(readFileSync(json, 'utf8')));
  return (entry) => aggregateFiles(files, entry.path);
}

function main(argv) {
  const update = argv.includes('--update');
  const [tool, projectRoot, ...rest] = argv.filter((argument) => argument !== '--update');
  if (!TOOLS.has(tool) || !projectRoot) {
    console.error('Usage: coverage-gate.mjs <go|vitest|pytest> <projectRoot> [tool args] [--update]');
    process.exit(2);
  }
  const doc = readFloors();
  const entries = doc.entries.filter((entry) => entry.tool === tool && entry.project === projectRoot);
  if (entries.length === 0) {
    console.error(`No coverage floors are listed for ${tool} ${projectRoot} in scripts/ci/coverage-floors.json.`);
    process.exit(2);
  }
  const measure = tool === 'go' ? runGo(projectRoot, rest) : tool === 'vitest' ? runVitest(projectRoot, entries) : runPytest(projectRoot, rest);
  process.exit(report(doc, entries, measure, { update }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
