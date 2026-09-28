import assert from 'node:assert/strict';
import test from 'node:test';

import { isMarkdownFile, parseChangedFiles, resolveBase } from './changed-markdown.mjs';

test('parseChangedFiles reads an added and a modified file', () => {
  const output = ['A', 'docs/adr/0415-new.md', 'M', 'README.md'].join('\0') + '\0';

  assert.deepEqual(parseChangedFiles(output), ['docs/adr/0415-new.md', 'README.md']);
});

test('parseChangedFiles takes the new path of a rename, not the old one', () => {
  const output = ['R100', 'docs/old-name.md', 'docs/new-name.md'].join('\0') + '\0';

  assert.deepEqual(parseChangedFiles(output), ['docs/new-name.md']);
});

test('parseChangedFiles takes the new path of a copy', () => {
  const output = ['C75', 'docs/source.md', 'docs/copy.md'].join('\0') + '\0';

  assert.deepEqual(parseChangedFiles(output), ['docs/copy.md']);
});

test('parseChangedFiles reports nothing for empty output', () => {
  assert.deepEqual(parseChangedFiles(''), []);
});

test('isMarkdownFile matches .md case-insensitively and rejects everything else', () => {
  assert.equal(isMarkdownFile('docs/adr/0415-new.md'), true);
  assert.equal(isMarkdownFile('README.MD'), true);
  assert.equal(isMarkdownFile('apps/desktop/app.go'), false);
  assert.equal(isMarkdownFile('docs/adr/0415-new.md.bak'), false);
});

// A pull request stacked on another branch: the checkout holds origin/main but not origin/<base>. The pull request's
// merge commit (HEAD) has the base's tip as its first parent, so HEAD^1 stands in for it.
test('resolveBase uses origin/<base ref> when the checkout has it', () => {
  assert.equal(resolveBase({ baseRef: 'main', hasRef: (ref) => ref === 'origin/main' }), 'origin/main');
});

test("resolveBase falls back to the merge commit's first parent when origin/<base ref> is missing", () => {
  assert.equal(resolveBase({ baseRef: 'feat/stacked', hasRef: (ref) => ref === 'origin/main' }), 'HEAD^1');
});

test('resolveBase is origin/main outside a pull request', () => {
  assert.equal(resolveBase({ baseRef: undefined, hasRef: () => true }), 'origin/main');
});
