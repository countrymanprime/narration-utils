import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { trackedFiles } from './layout.mjs';

// `nx run-many -t lint` replaced the repo-wide `ruff .`, `staticcheck ./...` and `stylua --check`,
// so a source file that no project lints would slip through silently. This keeps that from happening.
const projects = trackedFiles()
  .filter((file) => file.endsWith('/project.json') || file === 'project.json')
  .map((file) => ({ root: file === 'project.json' ? '' : file.slice(0, -'/project.json'.length), config: JSON.parse(readFileSync(file, 'utf8')) }));

function owner(file) {
  return projects.filter((project) => project.root === '' || file.startsWith(`${project.root}/`)).sort((a, b) => b.root.length - a.root.length)[0];
}

const LINTED = [
  { extension: '.py', tool: 'ruff' },
  { extension: '.go', tool: 'go-lint' },
  { extension: '.lua', tool: 'stylua' },
  // The UI's ESLint config covers apps/ui only; the atlas kit's template .ts files were never linted.
  { extension: '.ts', tool: 'lint:ci', within: 'apps/' },
  { extension: '.tsx', tool: 'lint:ci', within: 'apps/' },
];

for (const { extension, tool, within = '' } of LINTED) {
  test(`every ${extension} file belongs to a project whose lint target runs ${tool}`, () => {
    const unlinted = trackedFiles()
      .filter((file) => file.endsWith(extension) && file.startsWith(within))
      .filter((file) => !JSON.stringify(owner(file)?.config.targets?.lint ?? {}).includes(tool));

    assert.deepEqual(unlinted, [], `add a lint target that runs ${tool} to the project that owns these files`);
  });
}

test('project names are unique and the release project keeps its name', () => {
  const names = projects.map((project) => project.config.name);

  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('narration-utils'), 'nx.json release.projects names narration-utils');
});
