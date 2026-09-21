import assert from 'node:assert/strict';
import test from 'node:test';

import { buildArguments, versionFlag } from './wails-build.mjs';

test('the version flag stamps a bare semver into the Go variable the app reports', () => {
  assert.equal(versionFlag('0.2.7'), '-X main.version=0.2.7');
});

test('a release candidate and its promotion are the same bytes, so a version with a suffix is refused', () => {
  for (const bad of ['0.2.7-rc', 'v0.2.7', '0.2', '', '0.2.7 ', '1.2.3; rm -rf /', '0.2.7\n']) {
    assert.throws(() => versionFlag(bad), /bare semver/, JSON.stringify(bad));
  }
});

test('the build always stamps the version and passes the caller arguments through', () => {
  assert.deepEqual(buildArguments('0.2.7', ['-s', '-tags', 'webkit2_41']), ['build', '-ldflags', '-X main.version=0.2.7', '-s', '-tags', 'webkit2_41']);
  assert.deepEqual(buildArguments('0.2.7', []), ['build', '-ldflags', '-X main.version=0.2.7']);
});

test('a leading separator that a package script leaves in front of the arguments is dropped', () => {
  assert.deepEqual(buildArguments('0.2.7', ['--', '-platform', 'windows/amd64']), ['build', '-ldflags', '-X main.version=0.2.7', '-platform', 'windows/amd64']);
});

test('the caller may not replace the version stamp with ldflags of its own', () => {
  assert.throws(() => buildArguments('0.2.7', ['-ldflags', '-X main.version=9.9.9']), /ldflags/);
});
