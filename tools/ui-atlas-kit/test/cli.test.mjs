import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { audit, detectStack, docs, init, sync } from '../plugin/cli/ui-atlas.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin', 'cli', 'ui-atlas.mjs');
const roots = [];

function fixture({ vite = '^6.0.0', extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ui-atlas-'));
  roots.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fx', scripts: { dev: 'vite' }, dependencies: { react: '^18.3.1' }, devDependencies: { vite, typescript: '^5.6.0', vitest: '^2.1.0', ...extra } }, null, 2));
  writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
  mkdirSync(join(dir, 'src', 'components', 'primitives'), { recursive: true });
  for (const name of ['Button', 'Panel']) writeFileSync(join(dir, 'src', 'components', 'primitives', `${name}.tsx`), `export function ${name}() { return null; }\n`);
  return dir;
}

after(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('detectStack', () => {
  test('reads the package manager, versions and picks tier 2 for React + Vite 6 + TS', () => {
    const stack = detectStack(fixture());
    assert.equal(stack.pm, 'pnpm');
    assert.equal(stack.react, 18);
    assert.equal(stack.vite, 6);
    assert.equal(stack.tier, 2);
    assert.deepEqual(stack.blockers, []);
  });

  test('Vite 4 blocks the atlas tier and says why', () => {
    const stack = detectStack(fixture({ vite: '^4.4.9' }));
    assert.equal(stack.tier, 0);
    assert.match(stack.blockers.join(' '), /Vite 4 is too old for Storybook 10/);
  });
});

describe('init', () => {
  test('writes tier 2 files, scripts, config and never overwrites', () => {
    const dir = fixture();
    const first = init(dir, {});
    assert.equal(first.tier, 2);
    for (const rel of ['tests/visual/lib/validators.ts', 'tests/atlas/atlas.spec.ts', 'tests/atlas/a11y-debt.ts', '.storybook/preview.tsx', 'src/atlasCoverage.test.ts', 'playwright.config.ts', 'playwright.atlas.config.ts', 'ui-atlas.config.json']) {
      assert.ok(existsSync(join(dir, rel)), `${rel} should exist`);
    }
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.atlas, 'pnpm run build-storybook && playwright test -c playwright.atlas.config.ts');
    assert.equal(pkg.scripts.dev, 'vite');
    assert.match(readFileSync(join(dir, 'playwright.config.ts'), 'utf8'), /UI_APP_PORT/);
    assert.match(readFileSync(join(dir, 'playwright.config.ts'), 'utf8'), /npx --no-install vite/);
    assert.doesNotMatch(readFileSync(join(dir, 'src', 'atlasCoverage.test.ts'), 'utf8'), /\{\{/);

    writeFileSync(join(dir, 'tests/visual/state-catalog.ts'), '// mine\n');
    const second = init(dir, {});
    assert.equal(second.written.length, 0);
    assert.equal(readFileSync(join(dir, 'tests/visual/state-catalog.ts'), 'utf8'), '// mine\n');
  });

  test('--dry-run writes nothing', () => {
    const dir = fixture();
    const report = init(dir, { 'dry-run': true });
    assert.ok(report.written.length > 10);
    assert.equal(existsSync(join(dir, 'tests')), false);
  });

  test('tier 0 skips Storybook files', () => {
    const dir = fixture();
    const report = init(dir, { tier: '0' });
    assert.equal(existsSync(join(dir, '.storybook')), false);
    assert.equal(report.written.some((rel) => rel.startsWith('tests/atlas')), false);
    assert.ok(existsSync(join(dir, 'tests/visual/global-setup.ts')));
  });
});

describe('audit', () => {
  test('lists primitives without stories as gaps and scores coverage', () => {
    const dir = fixture();
    init(dir, {});
    writeFileSync(join(dir, 'src/components/primitives/Button.stories.tsx'), 'export default {};\n');
    const result = audit(dir);
    assert.deepEqual(result.counts.uncovered, ['Panel']);
    assert.equal(result.counts.withStories, 1);
    assert.ok(result.gaps.some((gap) => gap.includes('Panel.stories.tsx')));
    assert.equal(result.parts.find((p) => p.name === 'component coverage').got, 18);
  });

  test('an exemption counts as covered', () => {
    const dir = fixture();
    init(dir, {});
    const file = join(dir, 'src/atlasCoverage.test.ts');
    writeFileSync(file, readFileSync(file, 'utf8').replace('const ATLAS_EXEMPT: Record<string, string> = {};', "const ATLAS_EXEMPT: Record<string, string> = { Panel: 'pure layout wrapper' };"));
    writeFileSync(join(dir, 'src/components/primitives/Button.stories.tsx'), 'export default {};\n');
    assert.deepEqual(audit(dir).counts.uncovered, []);
  });

  test('--json and --min set the exit code', () => {
    const dir = fixture();
    init(dir, {});
    const out = execFileSync('node', [CLI, 'audit', '--dir', dir, '--json'], { encoding: 'utf8' });
    assert.equal(JSON.parse(out).tier, 2);
    assert.throws(() => execFileSync('node', [CLI, 'audit', '--dir', dir, '--min', '100'], { stdio: 'pipe' }));
  });
});

describe('sync', () => {
  test('detects a drifted vendored file and refreshes it', () => {
    const dir = fixture();
    init(dir, {});
    assert.deepEqual(sync(dir, { check: true }).drift, []);
    const file = join(dir, 'tests/visual/lib/validators.ts');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n// local edit\n');
    assert.deepEqual(sync(dir, { check: true }).drift, ['tests/visual/lib/validators.ts']);
    assert.throws(() => execFileSync('node', [CLI, 'sync', '--dir', dir, '--check'], { stdio: 'pipe' }));
    assert.deepEqual(sync(dir, {}).refreshed, ['tests/visual/lib/validators.ts']);
    assert.deepEqual(sync(dir, { check: true }).drift, []);
  });
});

describe('docs', () => {
  test('writes one page per component plus an inventory from index.json', async () => {
    const dir = fixture();
    mkdirSync(join(dir, 'storybook-static'), { recursive: true });
    writeFileSync(
      join(dir, 'storybook-static', 'index.json'),
      JSON.stringify({ v: 5, entries: {
        'primitives-button--primary': { id: 'primitives-button--primary', type: 'story', title: 'Primitives/Button', name: 'Primary', importPath: './src/components/primitives/Button.stories.tsx' },
        'primitives-button--ghost': { id: 'primitives-button--ghost', type: 'story', title: 'Primitives/Button', name: 'Ghost', importPath: './src/components/primitives/Button.stories.tsx' },
        'primitives-panel--default': { id: 'primitives-panel--default', type: 'story', title: 'Primitives/Panel', name: 'Default', importPath: './src/components/primitives/Panel.stories.tsx' },
      } }),
    );
    writeFileSync(join(dir, 'src', 'Home.tsx'), "import { Button } from './components/primitives/Button';\nexport const Home = () => null;\n");
    const result = await docs(dir);
    assert.equal(result.components, 2);
    assert.equal(result.stories, 3);
    const page = readFileSync(join(dir, 'docs', 'ui', 'atlas', 'Button.md'), 'utf8');
    assert.match(page, /# Button/);
    assert.match(page, /- Primary\n- Ghost/);
    assert.match(page, /`src\/Home.tsx`/);
    const inventory = JSON.parse(readFileSync(join(dir, 'docs', 'ui', 'inventory.json'), 'utf8'));
    assert.deepEqual(inventory.components.map((c) => c.name), ['Button', 'Panel']);
  });

  test('keeps hand-authored classification and entries that have no stories', async () => {
    const dir = fixture();
    mkdirSync(join(dir, 'storybook-static'), { recursive: true });
    mkdirSync(join(dir, 'docs', 'ui'), { recursive: true });
    writeFileSync(join(dir, 'storybook-static', 'index.json'), JSON.stringify({ v: 5, entries: { 'primitives-panel--default': { id: 'primitives-panel--default', type: 'story', title: 'Primitives/Panel', name: 'Default', importPath: './src/components/primitives/Panel.stories.tsx' } } }));
    writeFileSync(join(dir, 'docs', 'ui', 'inventory.json'), JSON.stringify({ generatedBy: 'old', components: [{ name: 'Panel', tier: 'primitive', depth: 'full', stories: ['stale'] }, { name: 'Spacer', tier: 'exempt', atlasExempt: 'pure layout wrapper' }] }));
    await docs(dir);
    const { components } = JSON.parse(readFileSync(join(dir, 'docs', 'ui', 'inventory.json'), 'utf8'));
    const panel = components.find((c) => c.name === 'Panel');
    assert.equal(panel.tier, 'primitive');
    assert.equal(panel.depth, 'full');
    assert.deepEqual(panel.stories, ['Default']);
    assert.equal(components.find((c) => c.name === 'Spacer').atlasExempt, 'pure layout wrapper');
  });

  test('says how to fix a missing build', async () => {
    await assert.rejects(docs(fixture()), /run the storybook build/);
  });
});

describe('v0.2: what the six rollouts taught', () => {
  test('TypeScript is detected from tsconfig.json even without the typescript package', () => {
    const dir = fixture({ extra: {} });
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    delete pkg.devDependencies.typescript;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    rmSync(join(dir, 'src'), { recursive: true, force: true });
    assert.match(detectStack(dir).blockers.join(' '), /no TypeScript/);
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    assert.deepEqual(detectStack(dir).blockers, []);
  });

  test('the components directory is detected, including a flat one and kebab-case files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ui-atlas-'));
    roots.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^6.0.0', typescript: '^5.0.0' } }));
    mkdirSync(join(dir, 'src', 'components', 'nav'), { recursive: true });
    writeFileSync(join(dir, 'src', 'components', 'nav', 'mobile-nav.tsx'), 'export const A = 1;\n');
    writeFileSync(join(dir, 'src', 'components', 'Footer.tsx'), 'export const B = 1;\n');
    writeFileSync(join(dir, 'src', 'components', 'Footer.stories.tsx'), 'export default {};\n');
    const report = init(dir, { 'dry-run': true });
    assert.equal(report.vars.PRIMITIVES_DIR, 'components');
    init(dir, {});
    const result = audit(dir);
    assert.deepEqual(result.counts.uncovered, ['mobile-nav']);
    assert.equal(result.counts.components, 2);
  });

  test('a tier 0 repo is scored only on what tier 0 asks for', () => {
    const dir = fixture({ vite: '^4.4.9' });
    init(dir, {});
    const result = audit(dir);
    assert.equal(result.tier, 0);
    assert.ok(!result.parts.some((part) => part.name === 'component coverage'));
    assert.ok(!result.parts.some((part) => part.name === 'generated docs fresh'));
    assert.ok(result.score > 0 && result.score <= 100);
  });

  test('a workflow that merely mentions "ui-atlas" in a comment does not count as running the atlas', () => {
    const dir = fixture();
    init(dir, {});
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), '# ui-atlas soon\njobs:\n  build:\n    steps:\n      - run: npm test\n');
    assert.match(audit(dir).parts.find((part) => part.name === 'CI runs the suites').detail, /atlas no/);
    writeFileSync(join(dir, '.github', 'workflows', 'ci.yml'), 'jobs:\n  a:\n    steps:\n      - run: npm run atlas\n');
    assert.match(audit(dir).parts.find((part) => part.name === 'CI runs the suites').detail, /atlas yes/);
  });

  test('init at tier 0 without vitest does not write the vitest catalog test, and splits the install hint', () => {
    const dir = fixture({ vite: '^4.4.9' });
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    delete pkg.devDependencies.vitest;
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    const report = init(dir, {});
    assert.equal(existsSync(join(dir, 'src', 'visualSuite.test.ts')), false);
    const installs = report.notes.filter((note) => note.startsWith('install'));
    assert.ok(installs.length >= 2, 'install commands are split so npm does not choke on one huge resolve');
    assert.ok(installs.every((note) => !/\bnpm add/.test(note)));
  });

  test('two lockfiles produce a warning', () => {
    const dir = fixture();
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    assert.match(init(dir, { 'dry-run': true }).notes.join('\n'), /both .*lock/i);
  });

  test('the theme decorator can switch a class instead of an attribute', () => {
    const dir = fixture();
    init(dir, { 'theme-class': 'dark' });
    const preview = readFileSync(join(dir, '.storybook', 'preview.tsx'), 'utf8');
    assert.match(preview, /classList\.toggle\('dark'/);
    assert.doesNotMatch(preview, /setAttribute/);
  });

  test('docs names a component after its file and finds kebab-case consumers', async () => {
    const dir = fixture();
    mkdirSync(join(dir, 'storybook-static'), { recursive: true });
    writeFileSync(join(dir, 'storybook-static', 'index.json'), JSON.stringify({ v: 5, entries: { 'x--a': { id: 'x--a', type: 'story', title: 'Composites/No showtimes card/Empty', name: 'Empty', importPath: './src/card.stories.tsx', componentPath: './src/components/movie-card.tsx' } } }));
    writeFileSync(join(dir, 'src', 'page.tsx'), "import { MovieCard } from './components/movie-card';\n");
    await docs(dir);
    const { components } = JSON.parse(readFileSync(join(dir, 'docs', 'ui', 'inventory.json'), 'utf8'));
    assert.equal(components[0].name, 'movie-card');
    assert.deepEqual(components[0].consumers, ['src/page.tsx']);
  });
});

describe('v0.3: what the upgrade round taught', () => {
  const indexWith = (dir, entries) => {
    mkdirSync(join(dir, 'storybook-static'), { recursive: true });
    writeFileSync(join(dir, 'storybook-static', 'index.json'), JSON.stringify({ v: 5, entries }));
  };
  const story = (id, title, name, componentPath) => ({ id, type: 'story', title, name, importPath: './x.stories.tsx', componentPath });

  test('two story files for one component stay two pages instead of merging', async () => {
    const dir = fixture();
    indexWith(dir, {
      'a--one': story('a--one', 'Composites/MovieCard', 'One', './src/MovieCard.tsx'),
      'b--two': story('b--two', 'Composites/MovieCardNoShowtimes', 'Two', './src/MovieCard.tsx'),
    });
    const result = await docs(dir);
    assert.equal(result.components, 2);
    const names = JSON.parse(readFileSync(join(dir, 'docs', 'ui', 'inventory.json'), 'utf8')).components.map((c) => c.name).sort();
    assert.equal(new Set(names).size, 2, 'page names must be unique');
    assert.ok(names.includes('MovieCard'));
  });

  test('docs deletes generated pages and images it no longer produces, but not other files', async () => {
    const dir = fixture();
    indexWith(dir, { 'a--one': story('a--one', 'Primitives/Button', 'One', './src/Button.tsx') });
    mkdirSync(join(dir, 'docs', 'ui', 'atlas'), { recursive: true });
    mkdirSync(join(dir, 'docs', 'ui', 'images'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'ui', 'atlas', 'Gone.md'), '# stale');
    writeFileSync(join(dir, 'docs', 'ui', 'images', 'gone.webp'), 'x');
    writeFileSync(join(dir, 'docs', 'ui', 'README.md'), 'hand written');
    await docs(dir);
    assert.equal(existsSync(join(dir, 'docs', 'ui', 'atlas', 'Gone.md')), false);
    assert.equal(existsSync(join(dir, 'docs', 'ui', 'images', 'gone.webp')), false);
    assert.equal(existsSync(join(dir, 'docs', 'ui', 'README.md')), true);
  });

  test('docs adopts the casing of an existing curated inventory instead of duplicating it', async () => {
    const dir = fixture();
    indexWith(dir, { 'a--one': story('a--one', 'Sections/feature-grid', 'One', './src/feature-grid.tsx') });
    mkdirSync(join(dir, 'docs', 'ui'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'ui', 'inventory.json'), JSON.stringify({ components: [{ name: 'FeatureGrid', tier: 'composite' }] }));
    await docs(dir);
    const { components } = JSON.parse(readFileSync(join(dir, 'docs', 'ui', 'inventory.json'), 'utf8'));
    assert.equal(components.length, 1);
    assert.equal(components[0].name, 'FeatureGrid');
    assert.equal(components[0].tier, 'composite');
    assert.equal(existsSync(join(dir, 'docs', 'ui', 'atlas', 'FeatureGrid.md')), true);
  });

  test('sync stamps the kit version into ui-atlas.config.json', () => {
    const dir = fixture();
    init(dir, {});
    const file = join(dir, 'ui-atlas.config.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/"kit": "[^"]+"/, '"kit": "0.0.1"'));
    sync(dir, {});
    assert.notEqual(JSON.parse(readFileSync(file, 'utf8')).kit, '0.0.1');
  });

  test('exemptions keyed by a path are understood by the audit', () => {
    const dir = fixture();
    init(dir, {});
    const file = join(dir, 'src/atlasCoverage.test.ts');
    writeFileSync(file, readFileSync(file, 'utf8').replace('const ATLAS_EXEMPT: Record<string, string> = {};', "const ATLAS_EXEMPT: Record<string, string> = { 'layout/Panel': 'pure layout wrapper' };"));
    writeFileSync(join(dir, 'src/components/primitives/Button.stories.tsx'), 'export default {};\n');
    assert.ok(audit(dir).counts.exempt.includes('layout/Panel'));
  });
});

describe('v0.3.1: what the second upgrade round taught', () => {
  const story = (id, title, name, componentPath) => ({ id, type: 'story', title, name, importPath: './x.stories.tsx', componentPath });
  const writeIndex = (dir, entries) => {
    mkdirSync(join(dir, 'storybook-static'), { recursive: true });
    writeFileSync(join(dir, 'storybook-static', 'index.json'), JSON.stringify({ v: 5, entries }));
  };

  test('sync --dry-run reports drift and writes nothing', () => {
    const dir = fixture();
    init(dir, {});
    const file = join(dir, 'tests/visual/lib/validators.ts');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n// local edit\n');
    const result = sync(dir, { 'dry-run': true });
    assert.deepEqual(result.drift, ['tests/visual/lib/validators.ts']);
    assert.deepEqual(result.refreshed, []);
    assert.match(readFileSync(file, 'utf8'), /local edit/);
  });

  test('two titles for one component file get stable, title-derived names whatever the index order', async () => {
    for (const order of [0, 1]) {
      const dir = fixture();
      const a = story('a--x', 'Composites/MovieCard', 'X', './src/MovieCard.tsx');
      const b = story('b--x', 'Composites/MovieCardNoShowtimes', 'X', './src/MovieCard.tsx');
      writeIndex(dir, order ? { b: b, a: a } : { a: a, b: b });
      writeFileSync(join(dir, 'src', 'Showtimes.tsx'), "import { MovieCard } from './MovieCard';\n");
      await docs(dir);
      const { components } = JSON.parse(readFileSync(join(dir, 'docs', 'ui', 'inventory.json'), 'utf8'));
      assert.deepEqual(components.map((c) => c.name), ['MovieCard', 'MovieCardNoShowtimes']);
      assert.ok(components.every((c) => c.consumers.includes('src/Showtimes.tsx')), 'both pages find the real importers of the file');
    }
  });

  test('the docs index does not say "1 stories"', async () => {
    const dir = fixture();
    writeIndex(dir, { a: story('a--x', 'Primitives/Button', 'Only', './src/Button.tsx') });
    await docs(dir);
    assert.match(readFileSync(join(dir, 'docs', 'ui', 'atlas', 'index.md'), 'utf8'), /1 story\b/);
  });
});
