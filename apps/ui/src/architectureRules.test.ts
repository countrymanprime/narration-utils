import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cruise, type ICruiseOptions, type IRuleSetType } from 'dependency-cruiser';
import { afterAll, describe, expect, test } from 'vitest';

// ADR 0062: the import-graph rules in `.dependency-cruiser.mjs` are run over
// the real tree by `pnpm --dir apps/ui architecture` (an Nx target in the gate). This file proves that each rule fires:
// it writes a tiny tree with deliberate violations and legal look-alikes, cruises it with the same rule set and the same
// options, and expects exactly the named rules to be reported. A rule that can no longer see anything (a renamed folder, a
// changed path pattern, a dropped option) then fails here instead of passing for ever on the real tree.
const uiRoot = join(__dirname, '..');
// The path is built at run time so TypeScript does not ask for a declaration file for a plain .mjs config.
const configUrl = pathToFileURL(join(uiRoot, '.dependency-cruiser.mjs')).href;
const config = ((await import(/* @vite-ignore */ configUrl)) as { default: { forbidden: NonNullable<IRuleSetType['forbidden']>; options: ICruiseOptions } })
  .default;
// Under node_modules so `@base-ui/react` resolves through the package's own install, and so git, ESLint and Knip never
// see the fixtures.
const cacheDir = join(uiRoot, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const fixtureRoot = mkdtempSync(join(cacheDir, 'architecture-'));
afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function write(path: string, source: string): void {
  const file = join(fixtureRoot, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

// The config's own options too (type-only imports, what not to follow, how packages resolve): a fixture that passes with
// different options than the real run proves nothing about the real run.
async function cruiseFixture(entry: string) {
  const result = await cruise([entry], { ...config.options, baseDir: fixtureRoot, ruleSet: { forbidden: config.forbidden }, validate: true });
  if (typeof result.output === 'string') throw new Error('expected an object result');
  return result.output;
}

async function violations(entry: string): Promise<string[]> {
  return (await cruiseFixture(entry)).summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`).sort();
}

describe('the import-graph rules (ADR 0062)', () => {
  test('a primitive may not import a feature component, in a story, a test or a type import either', async () => {
    write('src/components/manuscript/Chapters.ts', 'export const STATUS = 1;\nexport type Chapter = { id: string };\n');
    write('src/components/primitives/Leaky.ts', "import { STATUS } from '../manuscript/Chapters';\nexport const leaky = STATUS;\n");
    write('src/components/primitives/Leaky.stories.ts', "import { STATUS } from '../manuscript/Chapters';\nexport default { STATUS };\n");
    write('src/components/primitives/Leaky.test.ts', "import { STATUS } from '../manuscript/Chapters';\nexport const t = STATUS;\n");
    // A type-only import is compiled away, so it is seen only with `tsPreCompilationDeps`: it needs its own case.
    write('src/components/primitives/LeakyType.ts', "import type { Chapter } from '../manuscript/Chapters';\nexport type Leaky = Chapter;\n");
    expect(await violations('src/components/primitives')).toEqual([
      'primitives-are-leaves: src/components/primitives/Leaky.stories.ts -> src/components/manuscript/Chapters.ts',
      'primitives-are-leaves: src/components/primitives/Leaky.test.ts -> src/components/manuscript/Chapters.ts',
      'primitives-are-leaves: src/components/primitives/Leaky.ts -> src/components/manuscript/Chapters.ts',
      'primitives-are-leaves: src/components/primitives/LeakyType.ts -> src/components/manuscript/Chapters.ts',
    ]);
  });

  test('a primitive may import another primitive and the shared types', async () => {
    write('src/types.ts', 'export type Shared = string;\n');
    write('src/components/primitives/Base.ts', 'export const base = 1;\n');
    write(
      'src/components/primitives/Fine.ts',
      "import type { Shared } from '../../types';\nimport { base } from './Base';\nexport const fine: Shared = String(base);\n",
    );
    const output = await cruiseFixture('src/components/primitives/Fine.ts');
    // Both imports are really followed, so an empty list means "allowed" and not "never looked at".
    expect(
      output.modules
        .find((m) => m.source === 'src/components/primitives/Fine.ts')
        ?.dependencies.map((d) => d.resolved)
        .sort(),
    ).toEqual(['src/components/primitives/Base.ts', 'src/types.ts']);
    expect(output.summary.violations).toEqual([]);
  });

  test('only the API layer may reach the generated Wails bindings', async () => {
    write('wailsjs/go/main/Host.ts', 'export const Ping = () => 1;\n');
    write('src/api/client.ts', "import { Ping } from '../../wailsjs/go/main/Host';\nexport const ping = Ping;\n");
    write('src/components/home/Direct.ts', "import { Ping } from '../../../wailsjs/go/main/Host';\nexport const direct = Ping;\n");
    expect(await violations('src/api/client.ts')).toEqual([]);
    expect(await violations('src/components/home/Direct.ts')).toEqual(['wails-bindings-only-in-api: src/components/home/Direct.ts -> wailsjs/go/main/Host.ts']);
  });

  test('Base UI is imported only by a primitive (the second guard behind baseUiBoundary.test.ts)', async () => {
    write('src/components/primitives/Popup.ts', "import { Dialog } from '@base-ui/react/dialog';\nexport const popup = Dialog;\n");
    write('src/components/settings/Popup.ts', "import { Dialog } from '@base-ui/react/dialog';\nexport const popup = Dialog;\n");
    expect(await violations('src/components/primitives/Popup.ts')).toEqual([]);
    const found = await violations('src/components/settings/Popup.ts');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^base-ui-only-in-primitives: src\/components\/settings\/Popup\.ts -> .*@base-ui\/react/);
  });

  test('Zod is imported only under src/api (ADR 0069)', async () => {
    write('src/api/schemas/thing.ts', "import { z } from 'zod';\nexport const thing = z.string();\n");
    write('src/components/settings/Validate.ts', "import { z } from 'zod';\nexport const validate = z.string();\n");
    expect(await violations('src/api/schemas/thing.ts')).toEqual([]);
    const found = await violations('src/components/settings/Validate.ts');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^zod-only-in-api: src\/components\/settings\/Validate\.ts -> .*node_modules\/zod\//);
  });
});
