#!/usr/bin/env node
// ui-atlas: bootstrap, audit, document and keep in sync the visual component library of a React UI repo.
// Dependency-free Node ESM (>= 20). See tools/ui-atlas-kit/docs/design.md for the contract.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates');
const KIT_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(HERE, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
})();

// ---- small helpers -----------------------------------------------------------------------------
const posix = (p) => p.split(sep).join('/');
const readText = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const major = (range) => Number.parseInt(String(range ?? '').replace(/^[^\d]*/, ''), 10) || 0;
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function walk(dir, keep = () => true) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full, keep) : keep(full) ? [full] : [];
  });
}

function parseArgs(argv) {
  const [cmd = 'help', ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else flags[key] = rest[++i];
  }
  return { cmd, flags };
}

// ---- stack detection ---------------------------------------------------------------------------
export function detectStack(dir) {
  const pkg = existsSync(join(dir, 'package.json')) ? readJson(join(dir, 'package.json')) : {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (name) => name in deps;
  const up = (file) => [dir, dirname(dir), dirname(dirname(dir))].some((d) => existsSync(join(d, file)));
  const pm = up('pnpm-lock.yaml') ? 'pnpm' : up('yarn.lock') ? 'yarn' : up('bun.lock') || up('bun.lockb') ? 'bun' : 'npm';
  const stack = {
    pm,
    react: major(deps.react),
    vite: major(deps.vite),
    tailwind: major(deps.tailwindcss),
    typescript: has('typescript'),
    playwright: has('@playwright/test'),
    vitest: major(deps.vitest),
    storybook: major(deps.storybook),
    testingLibrary: has('@testing-library/react'),
    sharp: has('sharp'),
  };
  const blockers = [];
  if (!stack.react) blockers.push('no React dependency found in package.json');
  if (!stack.vite) blockers.push('no Vite: the atlas serves storybook-static with `vite preview` and Storybook 10 needs Vite >= 5');
  else if (stack.vite < 5) blockers.push(`Vite ${stack.vite} is too old for Storybook 10 (needs >= 5): use tier 0 or upgrade Vite`);
  if (!stack.typescript) blockers.push('no TypeScript: the templates are .ts/.tsx');
  const storybookOk = stack.react && stack.vite >= 5 && stack.typescript;
  return { ...stack, blockers, tier: storybookOk ? 2 : 0 };
}

function pmCommands(pm) {
  return { npm: { run: 'npm run', exec: 'npx' }, pnpm: { run: 'pnpm run', exec: 'pnpm exec' }, yarn: { run: 'yarn', exec: 'yarn' }, bun: { run: 'bun run', exec: 'bunx' } }[pm];
}

const render = (text, vars) => text.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key) => (key in vars ? vars[key] : whole));

// Which tier first needs each file (paths relative to the templates kind dir).
const CORE_TIER = (rel) => (rel.startsWith('tests/atlas/') || rel === 'playwright.atlas.config.ts' ? 1 : 0);
const SCAFFOLD_TIER = (rel) => (['tests/visual/state-catalog.ts', 'tests/visual/app.drivers.ts', 'tests/visual/viewports.ts', 'playwright.config.ts', 'src/visualSuite.test.ts'].includes(rel) ? 0 : 1);

function templateFiles(kind, tierOf) {
  const root = join(TEMPLATES, kind);
  return walk(root).map((full) => {
    const rel = posix(relative(root, full));
    return { rel, full, tier: tierOf(rel) };
  });
}

// ---- init --------------------------------------------------------------------------------------
export function init(dir, flags = {}) {
  const stack = detectStack(dir);
  const tier = flags.tier !== undefined ? Number(flags.tier) : stack.tier;
  const dry = Boolean(flags['dry-run']);
  const report = { dir, tier, stack, written: [], skipped: [], notes: [] };
  if (tier > 0 && stack.tier === 0) report.notes.push(`tier ${tier} requested but blocked: ${stack.blockers.join('; ')}`);

  const cmd = pmCommands(stack.pm);
  const vars = {
    THEME_ATTR: flags['theme-attr'] ?? 'data-theme',
    PRIMITIVES_DIR: flags['primitives-dir'] ?? 'components/primitives',
    BASE_URL: flags['base-url'] ?? 'http://localhost:5173',
    DEV_COMMAND: flags['dev-command'] ?? `${cmd.run} dev`,
    PM_RUN: cmd.run,
    PM_EXEC: cmd.exec,
    UI_ROOT: posix(relative(process.cwd(), dir)) || '.',
  };

  const place = (rel, content) => {
    const target = join(dir, rel);
    if (existsSync(target)) return report.skipped.push(rel);
    report.written.push(rel);
    if (dry) return;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  for (const file of templateFiles('core', CORE_TIER)) if (file.tier <= tier) place(file.rel, readText(file.full));
  for (const file of templateFiles('scaffold', SCAFFOLD_TIER)) if (file.tier <= tier) place(file.rel, render(readText(file.full), vars));
  if (tier >= 2) {
    place('.ui-atlas/ci-jobs.yml', render(readText(join(TEMPLATES, 'ci', 'ui-atlas-jobs.yml')), vars));
    place('.ui-atlas/CLAUDE.snippet.md', render(readText(join(TEMPLATES, 'CLAUDE.snippet.md')), vars));
  }

  // package.json scripts, only where absent
  const pkgPath = join(dir, 'package.json');
  const scripts = { screenshots: 'playwright test' };
  if (tier >= 1) Object.assign(scripts, { storybook: 'storybook dev --port 6006', 'build-storybook': 'storybook build --output-dir storybook-static', atlas: `${cmd.run} build-storybook && playwright test -c playwright.atlas.config.ts` });
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    const added = Object.keys(scripts).filter((name) => !pkg.scripts?.[name]);
    if (added.length) {
      report.notes.push(`package.json scripts added: ${added.join(', ')}`);
      if (!dry) writeFileSync(pkgPath, JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, ...Object.fromEntries(added.map((n) => [n, scripts[n]])) } }, null, 2) + '\n');
    }
  }
  // .gitignore lines
  const ignorePath = join(dir, '.gitignore');
  const wanted = ['storybook-static/', 'screenshots/', 'test-results/', 'playwright-report/', '.ui-atlas/'];
  const current = existsSync(ignorePath) ? readText(ignorePath) : '';
  const missing = wanted.filter((line) => !current.split('\n').includes(line));
  if (missing.length && !dry) writeFileSync(ignorePath, `${current.replace(/\n*$/, '\n')}${missing.join('\n')}\n`);
  if (missing.length) report.notes.push(`.gitignore lines added: ${missing.join(', ')}`);

  const install = [];
  if (!stack.playwright) install.push('@playwright/test');
  if (!stack.sharp) install.push('sharp');
  if (tier >= 1) install.push('storybook@10', '@storybook/react-vite@10', '@storybook/addon-a11y@10');
  if (!stack.vitest) install.push('vitest', 'jsdom');
  if (!stack.testingLibrary) install.push('@testing-library/react');
  if (install.length) report.notes.push(`install (not run): ${stack.pm} add -D ${install.join(' ')}`);
  report.notes.push("add 'tests/visual/**' and 'tests/atlas/**' to the unit-test runner's exclude list (Playwright specs are not Vitest tests)");
  if (stack.vitest && stack.vitest < 3 && tier >= 1) report.notes.push('Vitest < 3: do not add @storybook/addon-vitest; stories run as unit tests through composeStories (src/stories.test.tsx)');
  if (tier >= 1) report.notes.push("edit .storybook/preview.tsx: import the app's global stylesheet and wrap stories in its providers (marked TODO)");

  if (!dry) {
    const config = { kit: KIT_VERSION, tier, stack: { pm: stack.pm, react: stack.react, vite: stack.vite, tailwind: stack.tailwind }, vars };
    if (!existsSync(join(dir, 'ui-atlas.config.json'))) writeFileSync(join(dir, 'ui-atlas.config.json'), JSON.stringify(config, null, 2) + '\n');
  }
  return report;
}

// ---- audit -------------------------------------------------------------------------------------
const PRIMITIVE_FILE = /^[A-Z][A-Za-z]*\.tsx$/;

function readConfig(dir) {
  const p = join(dir, 'ui-atlas.config.json');
  return existsSync(p) ? readJson(p) : undefined;
}

function countMatches(file, regex) {
  return existsSync(file) ? (readText(file).match(regex) ?? []).length : 0;
}

export function audit(dir) {
  const config = readConfig(dir);
  const primitivesRel = config?.vars?.PRIMITIVES_DIR ?? 'components/primitives';
  const primitivesDir = join(dir, 'src', primitivesRel);
  const files = existsSync(primitivesDir) ? readdirSync(primitivesDir) : [];
  const components = files.filter((f) => PRIMITIVE_FILE.test(f)).map((f) => f.replace('.tsx', ''));
  const coveragePath = join(dir, 'src', 'atlasCoverage.test.ts');
  const exemptBlock = existsSync(coveragePath) ? (readText(coveragePath).match(/ATLAS_EXEMPT[^=]*=\s*\{([\s\S]*?)\};/) ?? [])[1] ?? '' : '';
  const exempt = (exemptBlock.match(/^\s*['"]?[A-Z]\w*['"]?\s*:/gm) ?? []).map((line) => line.replace(/[\s'":]/g, ''));
  const withStories = components.filter((name) => files.includes(`${name}.stories.tsx`));
  const uncovered = components.filter((name) => !withStories.includes(name) && !exempt.includes(name));

  const visualDir = join(dir, 'tests', 'visual');
  const catalogRows = countMatches(join(visualDir, 'state-catalog.ts'), /^\s*(?:\{\s*)?page:\s*'/gm);
  const undriven = countMatches(join(visualDir, 'state-catalog.ts'), /\bundriven:/g);
  const sameAs = countMatches(join(visualDir, 'state-catalog.ts'), /\bsameAs:/g);
  const debt = countMatches(join(dir, 'tests', 'atlas', 'a11y-debt.ts'), /^\s*\{\s*title:/gm);

  const workflows = walk(resolve(dir, '..', '..', '.github', 'workflows'), (f) => /\.ya?ml$/.test(f)).concat(walk(join(dir, '.github', 'workflows'), (f) => /\.ya?ml$/.test(f)));
  const ci = workflows.map(readText).join('\n');
  const ciVisual = /screenshots|playwright test/.test(ci);
  const ciAtlas = /\batlas\b/.test(ci);

  const inventory = join(dir, '..', '..', 'docs', 'ui', 'inventory.json');
  const inventoryPath = [join(dir, 'docs', 'ui', 'inventory.json'), inventory].find(existsSync);
  const newestStory = Math.max(0, ...walk(join(dir, 'src'), (f) => f.endsWith('.stories.tsx')).map((f) => statSync(f).mtimeMs));
  const docsFresh = Boolean(inventoryPath) && statSync(inventoryPath).mtimeMs >= newestStory;

  const drift = sync(dir, { check: true }).drift;

  const parts = [
    { name: 'component coverage', max: 35, got: components.length ? Math.round((35 * (components.length - uncovered.length)) / components.length) : 0, detail: `${components.length - uncovered.length}/${components.length} primitives covered, ${exempt.length} exempt` },
    { name: 'CI runs the suites', max: 20, got: (ciVisual ? 10 : 0) + (ciAtlas ? 10 : 0), detail: `app visual ${ciVisual ? 'yes' : 'no'}, atlas ${ciAtlas ? 'yes' : 'no'}` },
    { name: 'capture contract present', max: 15, got: ['tests/visual/lib/validators.ts', 'tests/visual/global-setup.ts', 'tests/visual/state-catalog.ts', 'tests/atlas/atlas.spec.ts', 'src/stories.test.tsx']
        .reduce((sum, rel) => sum + (existsSync(join(dir, rel)) ? 3 : 0), 0), detail: 'validators, global setup, catalog, atlas spec, stories test' },
    { name: 'escape hatches bounded', max: 10, got: undriven === 0 && debt <= 3 ? 10 : undriven === 0 || debt <= 3 ? 5 : 0, detail: `${undriven} undriven, ${sameAs} sameAs, ${debt} a11y debt` },
    { name: 'generated docs fresh', max: 10, got: docsFresh ? 10 : inventoryPath ? 4 : 0, detail: inventoryPath ? (docsFresh ? 'docs/ui/inventory.json is current' : 'docs/ui/inventory.json is older than the newest story') : 'no docs/ui/inventory.json' },
    { name: 'kit files in sync', max: 10, got: drift.length === 0 && config ? 10 : 0, detail: config ? (drift.length ? `${drift.length} vendored file(s) drifted` : 'vendored files match the kit') : 'no ui-atlas.config.json (run init)' },
  ];
  const score = parts.reduce((sum, p) => sum + p.got, 0);
  const gaps = [
    ...uncovered.map((name) => `add ${name}.stories.tsx (or exempt ${name} with a reason)`),
    ...(ciVisual ? [] : ['run the app visual suite in CI']),
    ...(ciAtlas ? [] : ['run the atlas in CI']),
    ...drift.map((d) => `vendored file drifted: ${d} (run: ui-atlas sync)`),
    ...(docsFresh ? [] : ['regenerate docs: ui-atlas docs']),
  ];
  return { dir, kit: KIT_VERSION, tier: config?.tier ?? null, score, parts, gaps, counts: { components: components.length, withStories: withStories.length, exempt, uncovered, catalogRows, undriven, sameAs, debt } };
}

// ---- docs --------------------------------------------------------------------------------------
export async function docs(dir) {
  const indexPath = join(dir, 'storybook-static', 'index.json');
  if (!existsSync(indexPath)) throw new Error(`no ${posix(relative(process.cwd(), indexPath))}: run the storybook build (pnpm atlas) first`);
  const entries = Object.values(readJson(indexPath).entries).filter((e) => e.type === 'story');
  const byTitle = new Map();
  for (const entry of entries) byTitle.set(entry.title, [...(byTitle.get(entry.title) ?? []), entry]);

  const repoRoot = existsSync(join(dir, '..', '..', '.git')) ? resolve(dir, '..', '..') : dir;
  const outDir = join(repoRoot, 'docs', 'ui');
  const imgDir = join(outDir, 'images');
  mkdirSync(join(outDir, 'atlas'), { recursive: true });
  mkdirSync(imgDir, { recursive: true });
  // sharp belongs to the consumer's dependencies, not the kit's.
  let sharp;
  try {
    sharp = createRequire(join(dir, 'package.json'))('sharp');
  } catch {
    sharp = undefined;
  }

  const sources = walk(join(dir, 'src'), (f) => /\.(tsx?|jsx?)$/.test(f) && !/\.(stories|test)\./.test(f));
  const debtPath = join(dir, 'tests', 'atlas', 'a11y-debt.ts');
  const debtText = existsSync(debtPath) ? readText(debtPath) : '';
  const inventory = [];
  for (const [title, stories] of [...byTitle].sort(([a], [b]) => a.localeCompare(b))) {
    const name = title.split('/').pop();
    const first = stories[0];
    const consumers = sources.filter((f) => new RegExp(`from ['"][^'"]*/${name}['"]`).test(readText(f))).map((f) => posix(relative(dir, f)));
    const shots = join(dir, 'screenshots', 'atlas', slug(title));
    const wanted = `${slug(first.name)}--light-wide.png`;
    let image = '';
    if (existsSync(join(shots, wanted))) {
      image = `images/${slug(title)}.webp`;
      if (sharp) await sharp(join(shots, wanted)).resize({ width: 960, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(outDir, image));
      else image = '';
    }
    const debt = debtText.includes(`title: '${title}'`);
    inventory.push({ title, name, source: (first.componentPath ?? first.importPath) ? posix(first.componentPath ?? first.importPath).replace(/^\.\//, '') : undefined, stories: stories.map((s) => s.name), consumers, a11yDebt: debt });
    const lines = [`# ${name}`, '', `Storybook title: \`${title}\`. Source: \`${inventory.at(-1).source ?? 'n/a'}\`.`, ''];
    if (image) lines.push(`![${name}, ${first.name}, light theme](../${image})`, '');
    lines.push('## Stories', '', ...stories.map((s) => `- ${s.name}`), '');
    lines.push('## Used by', '', ...(consumers.length ? consumers.map((c) => `- \`${c}\``) : ['- nothing outside its own stories and tests yet']), '');
    if (debt) lines.push('## Known accessibility debt', '', 'This component has a recorded, reasoned exemption in `tests/atlas/a11y-debt.ts`.', '');
    writeFileSync(join(outDir, 'atlas', `${name}.md`), lines.join('\n'));
  }
  writeFileSync(join(outDir, 'atlas', 'index.md'), ['# Component atlas', '', 'Generated by `ui-atlas docs` from the Storybook build. Do not edit by hand.', '', ...inventory.map((c) => `- [${c.name}](${c.name}.md): ${c.stories.length} stories`), ''].join('\n'));
  // inventory.json is shared with the ui-component-inventory skill, which adds tier/depth/atlasExempt
  // and lists components that have no stories. Regenerate what Storybook knows; keep what a person wrote.
  const inventoryPath = join(outDir, 'inventory.json');
  const prior = existsSync(inventoryPath) ? (readJson(inventoryPath).components ?? []) : [];
  const merged = inventory.map((generated) => ({ ...prior.find((p) => p.name === generated.name), ...generated }));
  const kept = prior.filter((p) => !inventory.some((generated) => generated.name === p.name));
  writeFileSync(inventoryPath, JSON.stringify({ generatedBy: `ui-atlas ${KIT_VERSION}`, components: [...merged, ...kept] }, null, 2) + '\n');
  return { components: inventory.length, stories: entries.length, outDir, images: Boolean(sharp) };
}

// ---- sync --------------------------------------------------------------------------------------
export function sync(dir, flags = {}) {
  const config = readConfig(dir);
  const tier = config?.tier ?? 0;
  const drift = [];
  const refreshed = [];
  if (!config) return { drift, refreshed, tier };
  for (const file of templateFiles('core', CORE_TIER)) {
    if (file.tier > tier) continue;
    const target = join(dir, file.rel);
    const wanted = readText(file.full);
    if (existsSync(target) && readText(target) === wanted) continue;
    drift.push(file.rel);
    if (!flags.check) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, wanted);
      refreshed.push(file.rel);
    }
  }
  return { drift, refreshed, tier };
}

// ---- CLI ---------------------------------------------------------------------------------------
function printAudit(result) {
  console.log(`ui-atlas audit  ${result.dir}  kit ${result.kit}  tier ${result.tier ?? 'not initialised'}`);
  for (const p of result.parts) console.log(`  ${String(p.got).padStart(3)}/${String(p.max).padEnd(3)} ${p.name}: ${p.detail}`);
  console.log(`  score ${result.score}/100`);
  if (result.gaps.length) console.log('gaps:\n' + result.gaps.map((g) => `  - ${g}`).join('\n'));
}

async function main() {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const dir = resolve(String(flags.dir ?? process.cwd()));
  if (cmd === 'init') {
    const report = init(dir, flags);
    console.log(`${flags['dry-run'] ? '[dry run] ' : ''}ui-atlas init  ${dir}  tier ${report.tier}`);
    console.log(`stack: ${JSON.stringify({ ...report.stack, blockers: undefined })}`);
    for (const rel of report.written) console.log(`  + ${rel}`);
    for (const rel of report.skipped) console.log(`  = ${rel} (exists, left alone)`);
    for (const note of report.notes) console.log(`note: ${note}`);
    if (report.stack.blockers.length) console.log(`blockers: ${report.stack.blockers.join('; ')}`);
  } else if (cmd === 'audit') {
    const result = audit(dir);
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else printAudit(result);
    if (flags.min !== undefined && result.score < Number(flags.min)) process.exitCode = 1;
  } else if (cmd === 'docs') {
    const result = await docs(dir);
    console.log(`docs: ${result.components} components, ${result.stories} stories -> ${posix(relative(process.cwd(), result.outDir))}${result.images ? '' : ' (no sharp: images skipped)'}`);
  } else if (cmd === 'sync') {
    const result = sync(dir, flags);
    if (flags.check) {
      console.log(result.drift.length ? `drift:\n${result.drift.map((d) => `  - ${d}`).join('\n')}` : 'in sync');
      if (result.drift.length) process.exitCode = 1;
    } else console.log(result.refreshed.length ? `refreshed:\n${result.refreshed.map((d) => `  - ${d}`).join('\n')}` : 'already in sync');
  } else {
    console.log('usage: ui-atlas <init|audit|docs|sync> [--dir <ui-root>] [--tier 0|1|2] [--dry-run] [--json] [--min N] [--check]');
    if (cmd !== 'help') process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ui-atlas: ${error.message}`);
    process.exitCode = 1;
  });
}
