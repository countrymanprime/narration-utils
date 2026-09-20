import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { readRootVersion, syncVersion, updateJson, updateWailsJsonVersion } from './sync-version.mjs';

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function tempFile(name, value) {
  const dir = mkdtempSync(join(tmpdir(), 'sync-version-'));
  const file = join(dir, name);
  writeJson(file, value);
  return file;
}

test('readRootVersion accepts valid SemVer and rejects malformed versions', () => {
  assert.equal(readRootVersion(tempFile('package.json', { version: '1.2.3' })), '1.2.3');
  assert.throws(() => readRootVersion(tempFile('package.json', { version: 'not-semver' })), /not valid SemVer/);
});

test('updateJson writes the new top-level version and reports whether it changed', () => {
  const file = tempFile('package.json', { version: '0.1.0' });
  assert.equal(updateJson(file, '0.2.0', false), true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, '0.2.0');
  assert.equal(updateJson(file, '0.2.0', false), false);
});

test('updateJson in check mode throws on mismatch and never writes', () => {
  const file = tempFile('package.json', { version: '0.1.0' });
  assert.throws(() => updateJson(file, '0.2.0', true), /is 0\.1\.0; expected 0\.2\.0/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, '0.1.0');
  assert.equal(updateJson(file, '0.1.0', true), false);
});

test('updateWailsJsonVersion syncs the nested info.productVersion field', () => {
  const file = tempFile('wails.json', { name: 'Narration Utils', info: { companyName: 'Narration Utils', productVersion: '0.1.0' } });
  assert.equal(updateWailsJsonVersion(file, '0.2.0', false), true);
  const written = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(written.info.productVersion, '0.2.0');
  assert.equal(written.info.companyName, 'Narration Utils');
  assert.equal(updateWailsJsonVersion(file, '0.2.0', false), false);
});

test('updateWailsJsonVersion in check mode throws on mismatch and never writes', () => {
  const file = tempFile('wails.json', { info: { productVersion: '0.1.0' } });
  assert.throws(() => updateWailsJsonVersion(file, '0.2.0', true), /is 0\.1\.0; expected 0\.2\.0/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).info.productVersion, '0.1.0');
});

test('syncVersion synchronizes apps/ui, shell package.json, and apps/desktop/wails.json together', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'sync-version-repo-'));
  mkdirSync(join(dir, 'apps', 'ui'), { recursive: true });
  mkdirSync(join(dir, 'apps', 'desktop'), { recursive: true });
  writeJson(join(dir, 'package.json'), { version: '0.3.0' });
  writeJson(join(dir, 'apps', 'ui', 'package.json'), { version: '0.1.0' });
  writeJson(join(dir, 'apps', 'desktop', 'package.json'), { version: '0.1.0' });
  writeJson(join(dir, 'apps', 'desktop', 'wails.json'), { info: { productVersion: '0.1.0' } });

  const previousCwd = process.cwd();
  process.chdir(dir);
  t.after(() => process.chdir(previousCwd));

  syncVersion(false);

  assert.equal(JSON.parse(readFileSync(join(dir, 'apps', 'ui', 'package.json'), 'utf8')).version, '0.3.0');
  assert.equal(JSON.parse(readFileSync(join(dir, 'apps', 'desktop', 'package.json'), 'utf8')).version, '0.3.0');
  assert.equal(JSON.parse(readFileSync(join(dir, 'apps', 'desktop', 'wails.json'), 'utf8')).info.productVersion, '0.3.0');

  assert.doesNotThrow(() => syncVersion(true));
});
