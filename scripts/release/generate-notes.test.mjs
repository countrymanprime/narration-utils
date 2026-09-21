import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./generate-notes.mjs', import.meta.url));

function releaseNotes(env) {
  const dir = mkdtempSync(join(tmpdir(), 'notes-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'feat: a thing');
  git('tag', 'v0.1.0-rc');
  const destination = join(dir, 'notes.md');
  const result = spawnSync(process.execPath, [script, 'v0.1.0-rc'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, RELEASE_NOTES_FILE: destination, GITHUB_STEP_SUMMARY: '', ...env },
  });
  assert.equal(result.status, 0, result.stderr);
  return readFileSync(destination, 'utf8');
}

test('the release notes tell a narrator how to verify a download against the repository that built it', () => {
  const notes = releaseNotes({ GITHUB_REPOSITORY: 'countrymanprime/narration-utils' });

  assert.match(notes, /## Verifying this download/);
  assert.match(notes, /gh attestation verify <file> --repo countrymanprime\/narration-utils/);
});

test('the changes still come first and the verification section last', () => {
  const notes = releaseNotes({ GITHUB_REPOSITORY: 'countrymanprime/narration-utils' });

  assert.ok(notes.indexOf('## Features') > 0);
  assert.ok(notes.indexOf('## Features') < notes.indexOf('## Verifying this download'));
});

test('the verification section names a placeholder when the repository is not known', () => {
  const notes = releaseNotes({ GITHUB_REPOSITORY: '' });

  assert.match(notes, /--repo <owner>\/<repo>/);
});
