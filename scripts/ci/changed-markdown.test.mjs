import assert from 'node:assert/strict';
import test from 'node:test';

import { isMarkdownFile, parseChangedFiles } from './changed-markdown.mjs';

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
