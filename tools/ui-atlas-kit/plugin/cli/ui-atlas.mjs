#!/usr/bin/env node
// ui-atlas: bootstrap, audit, document and keep in sync the visual component library of a React UI repo.
// Dependency-free Node ESM (>= 20). See tools/ui-atlas-kit/docs/design.md for the contract.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
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
    typescript: has('typescript') || existsSync(join(dir, 'tsconfig.json')) || walk(join(dir, 'src'), (f) => f.endsWith('.tsx')).length > 0,
    typesNode: has('@types/node'),
    lockfiles: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'].filter(up),
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
const COMPONENT_DIR_CANDIDATES = ['components/primitives', 'components/ui', 'components', '../components'];

// Path of the components directory relative to <ui-root>/src (the base the coverage test resolves from).
export function detectComponentsDir(dir) {
  return COMPONENT_DIR_CANDIDATES.find((rel) => existsSync(join(dir, 'src', rel))) ?? 'components/primitives';
}

function gitRoot(dir) {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, '.git'))) return current;
    if (dirname(current) === current) return dir;
  }
}

const isComponentFile = (file) => /\.(tsx|jsx)$/.test(file) && !/\.(stories|test|spec)\./.test(file) && !/^index\./.test(basename(file));
const stripExt = (file) => basename(file).replace(/\.(tsx|jsx)$/, '');

export function init(dir, flags = {}) {
  const stack = detectStack(dir);
  const tier = flags.tier !== undefined ? Number(flags.tier) : stack.tier;
  const dry = Boolean(flags['dry-run']);
  const report = { dir, tier, stack, written: [], skipped: [], notes: [], vars: {} };
  if (tier > 0 && stack.tier === 0) report.notes.push(`tier ${tier} requested but blocked: ${stack.blockers.join('; ')}`);

  const cmd = pmCommands(stack.pm);
  const themeAttr = flags['theme-attr'] ?? 'data-theme';
  const vars = {
    THEME_ATTR: themeAttr,
    THEME_APPLY: flags['theme-class']
      ? `document.documentElement.classList.toggle('${flags['theme-class']}', theme === 'dark');`
      : `document.documentElement.setAttribute('${themeAttr}', theme);`,
    PRIMITIVES_DIR: flags['primitives-dir'] ?? detectComponentsDir(dir),
    PM_RUN: cmd.run,
    PM_EXEC: cmd.exec,
    UI_ROOT: posix(relative(gitRoot(dir), dir)) || '.',
  };
  report.vars = vars;
  const appConfig = flags['app-config'] ? String(flags['app-config']) : 'playwright.config.ts';

  const place = (rel, content) => {
    const target = join(dir, rel);
    if (existsSync(target)) return report.skipped.push(rel);
    report.written.push(rel);
    if (dry) return;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  };
  for (const file of templateFiles('core', CORE_TIER)) if (file.tier <= tier) place(file.rel, readText(file.full));
  for (const file of templateFiles('scaffold', SCAFFOLD_TIER)) {
    if (file.tier > tier) continue;
    if (file.rel === 'src/visualSuite.test.ts' && tier === 0 && !stack.vitest) {
      report.notes.push('no vitest: src/visualSuite.test.ts (catalog integrity) skipped; the runtime validators in tests/visual/global-setup.ts still run');
      continue;
    }
    place(file.rel === 'playwright.config.ts' ? appConfig : file.rel, render(readText(file.full), vars));
  }
  if (tier >= 2) {
    place('.ui-atlas/ci-jobs.yml', render(readText(join(TEMPLATES, 'ci', 'ui-atlas-jobs.yml')), vars));
    place('.ui-atlas/CLAUDE.snippet.md', render(readText(join(TEMPLATES, 'CLAUDE.snippet.md')), vars));
  }

  // package.json scripts, only where absent
  const pkgPath = join(dir, 'package.json');
  const scripts = { screenshots: appConfig === 'playwright.config.ts' ? 'playwright test' : `playwright test -c ${appConfig}` };
  if (tier >= 1) Object.assign(scripts, { storybook: 'storybook dev --port 6006', 'build-storybook': 'storybook build --output-dir storybook-static', atlas: `${cmd.run} build-storybook && playwright test -c playwright.atlas.config.ts` });
  if (tier >= 1 || stack.vitest) scripts.test = 'vitest run';
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
  const wanted = ['storybook-static/', 'screenshots/', 'test-results/', 'playwright-report/', '.ui-atlas/', '*.tsbuildinfo'];
  const current = existsSync(ignorePath) ? readText(ignorePath) : '';
  const missing = wanted.filter((line) => !current.split('\n').includes(line));
  if (missing.length && !dry) writeFileSync(ignorePath, `${current.replace(/\n*$/, '\n')}${missing.join('\n')}\n`);
  if (missing.length) report.notes.push(`.gitignore lines added: ${missing.join(', ')}`);

  // Install hints are split: one giant resolve crashed npm 10 ("edgesOut") in two repos.
  const verb = { npm: 'npm install -D', pnpm: 'pnpm add -D', yarn: 'yarn add -D', bun: 'bun add -D' }[stack.pm];
  const groups = [];
  const tooling = [];
  if (tier >= 1 && !stack.vitest) tooling.push('vitest@^3', 'jsdom');
  if (tier >= 1 && !stack.testingLibrary) tooling.push('@testing-library/react', '@testing-library/dom');
  if (!stack.typesNode) tooling.push('@types/node');
  if (tooling.length) groups.push(tooling);
  const browser = [];
  if (!stack.playwright) browser.push('@playwright/test');
  if (!stack.sharp) browser.push('sharp');
  if (browser.length) groups.push(browser);
  if (tier >= 1) groups.push(['storybook@10', '@storybook/react-vite@10', '@storybook/addon-a11y@10']);
  for (const group of groups) report.notes.push(`install (not run): ${verb} ${group.join(' ')}`);

  if (stack.lockfiles.length > 1) report.notes.push(`both ${stack.lockfiles.join(' and ')} exist: commands use ${stack.pm}; fix PM_RUN/PM_EXEC in ui-atlas.config.json if that is wrong`);
  report.notes.push("add 'tests/visual/**' and 'tests/atlas/**' to the unit-test runner's exclude list (Playwright specs are not Vitest tests)");
  report.notes.push(`the app is served for captures by playwright.config: set UI_APP_PORT (default 5173) if the dev server runs elsewhere; the atlas uses UI_ATLAS_PORT (default 6106)`);
  if (stack.vitest && stack.vitest < 3 && tier >= 1) report.notes.push('Vitest < 3: do not add @storybook/addon-vitest; stories run as unit tests through composeStories (src/stories.test.tsx)');
  if (tier >= 1) {
    report.notes.push("edit .storybook/preview.tsx: import the app's global stylesheet and wrap stories in its providers (marked TODO), and copy the app's web-font <link> tags into .storybook/preview-head.html");
    if (stack.tailwind && stack.tailwind < 4) report.notes.push("Tailwind < 4: add './.storybook/**/*.{ts,tsx}' to tailwind.config content, or classes used only in the preview decorator are silently missing");
    const tsconfig = join(dir, 'tsconfig.json');
    if (existsSync(tsconfig) && /"moduleResolution"\s*:\s*"(node|node10)"/i.test(readText(tsconfig))) report.notes.push('tsconfig moduleResolution is "node": Storybook 10 packages use `exports` maps, so typecheck needs "bundler"');
  }

  if (!dry) {
    const config = { kit: KIT_VERSION, tier, stack: { pm: stack.pm, react: stack.react, vite: stack.vite, tailwind: stack.tailwind }, vars: { THEME_ATTR: vars.THEME_ATTR, PRIMITIVES_DIR: vars.PRIMITIVES_DIR, PM_RUN: vars.PM_RUN, PM_EXEC: vars.PM_EXEC, UI_ROOT: vars.UI_ROOT } };
    if (!existsSync(join(dir, 'ui-atlas.config.json'))) writeFileSync(join(dir, 'ui-atlas.config.json'), JSON.stringify(config, null, 2) + '\n');
  }
  return report;
}

// ---- audit -------------------------------------------------------------------------------------
function readConfig(dir) {
  const p = join(dir, 'ui-atlas.config.json');
  return existsSync(p) ? readJson(p) : undefined;
}

function countMatches(file, regex) {
  return existsSync(file) ? (readText(file).match(regex) ?? []).length : 0;
}

export function audit(dir) {
  const config = readConfig(dir);
  const tier = config?.tier ?? 0;
  const primitivesDir = join(dir, 'src', config?.vars?.PRIMITIVES_DIR ?? detectComponentsDir(dir));
  const all = walk(primitivesDir);
  const components = [...new Set(all.filter(isComponentFile).map(stripExt))].sort();
  const storied = new Set(all.filter((f) => /\.stories\.(tsx|jsx)$/.test(f)).map((f) => basename(f).replace(/\.stories\.(tsx|jsx)$/, '')));
  const coveragePath = join(dir, 'src', 'atlasCoverage.test.ts');
  const exemptBlock = existsSync(coveragePath) ? (readText(coveragePath).match(/ATLAS_EXEMPT[^=]*=\s*\{([\s\S]*?)\};/) ?? [])[1] ?? '' : '';
  const exempt = [...exemptBlock.matchAll(/^\s*['"]?([\w/.-]+)['"]?\s*:/gm)].map((m) => m[1]);
  const withStories = components.filter((name) => storied.has(name));
  const uncovered = components.filter((name) => !storied.has(name) && !exempt.includes(name));

  const visualDir = join(dir, 'tests', 'visual');
  const catalogRows = countMatches(join(visualDir, 'state-catalog.ts'), /^\s*(?:\{\s*)?page:\s*'/gm);
  const undriven = countMatches(join(visualDir, 'state-catalog.ts'), /\bundriven:/g);
  const sameAs = countMatches(join(visualDir, 'state-catalog.ts'), /\bsameAs:/g);
  const debt = countMatches(join(dir, 'tests', 'atlas', 'a11y-debt.ts'), /\btitle:\s*['"]/g);

  // Only `run:` lines count: a comment or a job name that mentions "atlas" is not running it.
  const workflows = walk(resolve(gitRoot(dir), '.github', 'workflows'), (f) => /\.ya?ml$/.test(f));
  const runs = workflows.flatMap((f) => readText(f).split('\n')).filter((line) => /^\s*(?:-\s*)?run:/.test(line)).join('\n');
  const ciVisual = /screenshots|playwright test/.test(runs);
  const ciAtlas = /\batlas\b/.test(runs);

  const inventoryPath = [join(dir, 'docs', 'ui', 'inventory.json'), join(gitRoot(dir), 'docs', 'ui', 'inventory.json')].find(existsSync);
  const newestStory = Math.max(0, ...walk(join(dir, 'src'), (f) => /\.stories\.(tsx|jsx)$/.test(f)).map((f) => statSync(f).mtimeMs));
  const docsFresh = Boolean(inventoryPath) && statSync(inventoryPath).mtimeMs >= newestStory;
  const drift = sync(dir, { check: true }).drift;

  const contractFiles = ['tests/visual/lib/validators.ts', 'tests/visual/global-setup.ts', 'tests/visual/state-catalog.ts', ...(tier >= 1 ? ['tests/atlas/atlas.spec.ts', 'src/stories.test.tsx'] : [])];
  const contractShare = 15 / contractFiles.length;
  const parts = [
    { name: 'component coverage', max: 35, applies: tier >= 1, got: components.length ? Math.round((35 * (components.length - uncovered.length)) / components.length) : 0, detail: `${withStories.length} with stories, ${exempt.length} exempt, ${components.length} components` },
    { name: 'CI runs the suites', max: tier >= 1 ? 20 : 10, applies: true, got: (ciVisual ? 10 : 0) + (tier >= 1 && ciAtlas ? 10 : 0), detail: `app visual ${ciVisual ? 'yes' : 'no'}${tier >= 1 ? `, atlas ${ciAtlas ? 'yes' : 'no'}` : ''}` },
    { name: 'capture contract present', max: 15, applies: true, got: Math.round(contractFiles.filter((rel) => existsSync(join(dir, rel))).length * contractShare), detail: contractFiles.map((rel) => basename(rel)).join(', ') },
    { name: 'escape hatches bounded', max: 10, applies: true, got: undriven === 0 && debt <= 3 ? 10 : undriven === 0 || debt <= 3 ? 5 : 0, detail: `${undriven} undriven, ${sameAs} sameAs, ${debt} a11y debt` },
    { name: 'generated docs fresh', max: 10, applies: tier >= 2, got: docsFresh ? 10 : inventoryPath ? 4 : 0, detail: inventoryPath ? (docsFresh ? 'docs/ui/inventory.json is current' : 'docs/ui/inventory.json is older than the newest story') : 'no docs/ui/inventory.json' },
    { name: 'kit files in sync', max: 10, applies: true, got: drift.length === 0 && config ? 10 : 0, detail: config ? (drift.length ? `${drift.length} vendored file(s) drifted` : 'vendored files match the kit') : 'no ui-atlas.config.json (run init)' },
  ].filter((part) => part.applies);
  const maxTotal = parts.reduce((sum, p) => sum + p.max, 0);
  const score = Math.round((100 * parts.reduce((sum, p) => sum + p.got, 0)) / maxTotal);
  const gaps = [
    ...(tier >= 1 ? uncovered.map((name) => `add ${name}.stories.tsx (or exempt ${name} with a reason)`) : []),
    ...(ciVisual ? [] : ['run the app visual suite in CI']),
    ...(tier >= 1 && !ciAtlas ? ['run the atlas in CI'] : []),
    ...drift.map((d) => `vendored file drifted: ${d} (run: ui-atlas sync)`),
    ...(tier >= 2 && !docsFresh ? ['regenerate docs: ui-atlas docs'] : []),
  ];
  return { dir, kit: KIT_VERSION, tier: config?.tier ?? null, score, parts, gaps, counts: { components: components.length, withStories: withStories.length, exempt, uncovered, catalogRows, undriven, sameAs, debt } };
}

// ---- docs --------------------------------------------------------------------------------------
const SOURCE_SKIP = /(^|[\\/])(node_modules|dist|storybook-static|screenshots|test-results|docs|\.git)([\\/]|$)/;

export async function docs(dir) {
  const indexPath = join(dir, 'storybook-static', 'index.json');
  if (!existsSync(indexPath)) throw new Error(`no ${posix(relative(process.cwd(), indexPath))}: run the storybook build (pnpm atlas) first`);
  const entries = Object.values(readJson(indexPath).entries).filter((e) => e.type === 'story');
  // One page per Storybook title: two story files for one component file stay two pages.
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.title;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const outDir = join(gitRoot(dir), 'docs', 'ui');
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
  const isBlank = async (file) => {
    if (!sharp) return false;
    const { channels } = await sharp(file).stats();
    return Math.max(...channels.slice(0, 3).map((c) => c.stdev)) < 1;
  };

  const sources = walk(dir, (f) => /\.(tsx?|jsx?)$/.test(f) && !/\.(stories|test|spec)\./.test(f) && !SOURCE_SKIP.test(posix(relative(dir, f))));
  const debtPath = join(dir, 'tests', 'atlas', 'a11y-debt.ts');
  const debtText = existsSync(debtPath) ? readText(debtPath) : '';
  const inventoryPath = join(outDir, 'inventory.json');
  const prior = existsSync(inventoryPath) ? (readJson(inventoryPath).components ?? []) : [];
  const norm = (n) => n.toLowerCase().replace(/[-_\s]/g, '');
  const used = new Set();
  const writtenPages = new Set(['index.md']);
  const writtenImages = new Set();
  const inventory = [];
  for (const [, stories] of groups) {
    const first = stories[0];
    const componentPath = first.componentPath ? posix(first.componentPath).replace(/^\.\//, '') : undefined;
    const titleTail = first.title.split('/').pop();
    const fileName = componentPath ? stripExt(componentPath) : titleTail;
    // Adopt the casing of a hand-curated inventory entry rather than duplicating it.
    let name = prior.find((p) => norm(p.name) === norm(fileName))?.name ?? fileName;
    if (used.has(norm(name))) name = `${name}-${slug(titleTail)}`;
    used.add(norm(name));
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importer = new RegExp(`from ['"][^'"]*/${escaped}(?:/index)?['"]`);
    const consumers = sources.filter((f) => importer.test(readText(f))).map((f) => posix(relative(dir, f)));
    let image = '';
    for (const story of stories) {
      const file = join(dir, 'screenshots', 'atlas', slug(story.title), `${slug(story.name)}--light-wide.png`);
      if (!existsSync(file) || (await isBlank(file))) continue;
      image = `images/${slug(name)}.webp`;
      writtenImages.add(`${slug(name)}.webp`);
      if (sharp) await sharp(file).resize({ width: 960, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(outDir, image));
      else image = '';
      break;
    }
    const debt = stories.some((s) => debtText.includes(`title: '${s.title}'`));
    const source = componentPath ?? (first.importPath ? posix(first.importPath).replace(/^\.\//, '') : undefined);
    inventory.push({ title: first.title, name, source, stories: stories.map((s) => s.name), consumers, a11yDebt: debt });
    const lines = [`# ${name}`, '', `Storybook title: \`${first.title}\`. Source: \`${source ?? 'n/a'}\`.`, ''];
    if (image) lines.push(`![${name}, ${first.name}, light theme](../${image})`, '');
    lines.push('## Stories', '', ...stories.map((s) => `- ${s.name}`), '');
    lines.push('## Used by', '', ...(consumers.length ? consumers.map((c) => `- \`${c}\``) : ['- nothing outside its own stories and tests yet']), '');
    if (debt) lines.push('## Known accessibility debt', '', 'This component has a recorded, reasoned exemption in `tests/atlas/a11y-debt.ts`.', '');
    writeFileSync(join(outDir, 'atlas', `${name}.md`), lines.join('\n'));
    writtenPages.add(`${name}.md`);
  }
  // Everything under docs/ui/atlas and docs/ui/images is generated: drop what this run did not produce.
  for (const [folder, ext, keep] of [['atlas', '.md', writtenPages], ['images', '.webp', writtenImages]]) {
    for (const file of readdirSync(join(outDir, folder))) if (file.endsWith(ext) && !keep.has(file)) unlinkSync(join(outDir, folder, file));
  }
  inventory.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(join(outDir, 'atlas', 'index.md'), ['# Component atlas', '', 'Generated by `ui-atlas docs` from the Storybook build. Do not edit by hand.', '', ...inventory.map((c) => `- [${c.name}](${c.name}.md): ${c.stories.length} stories`), ''].join('\n'));
  // inventory.json is shared with the ui-component-inventory skill, which adds tier/depth/atlasExempt
  // and lists components that have no stories. Regenerate what Storybook knows; keep what a person wrote.
  const merged = inventory.map((generated) => ({ ...prior.find((p) => p.name === generated.name), ...generated }));
  const kept = prior.filter((p) => !inventory.some((generated) => generated.name === p.name));
  const components = [...merged, ...kept].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(inventoryPath, JSON.stringify({ generatedBy: `ui-atlas ${KIT_VERSION}`, components }, null, 2) + '\n');
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
  if (!flags.check && config.kit !== KIT_VERSION) writeFileSync(join(dir, 'ui-atlas.config.json'), JSON.stringify({ ...config, kit: KIT_VERSION }, null, 2) + '\n');
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
