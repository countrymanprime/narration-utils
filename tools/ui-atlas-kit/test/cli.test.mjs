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
    assert.match(readFileSync(join(dir, 'playwright.config.ts'), 'utf8'), /command: 'pnpm run dev'/);
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
