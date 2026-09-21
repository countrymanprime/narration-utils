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

// The program is AGPL-3.0-or-later and bundles GPL-family code (owner decision D17): the licences and the source offer travel as their own
// release asset, so the notes point at it.
test('the release notes point at the third-party notices and the source offer', () => {
  const notes = releaseNotes({});

  assert.match(notes, /## Licences and source/);
  assert.match(notes, /THIRD-PARTY-NOTICES\.txt/);
  assert.match(notes, /AGPL-3\.0-or-later/);
});

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

// The first stable release is unsigned (owner decision D7): the notes say so and say what a narrator will see, instead of leaving the
// SmartScreen warning to look like a fault.
test('the release notes say how to install on Windows and that the download is unsigned', () => {
  const notes = releaseNotes({ GITHUB_REPOSITORY: 'countrymanprime/narration-utils' });

  assert.match(notes, /## Installing on Windows/);
  assert.match(notes, /narration-utils-windows-x64-setup\.exe/);
  assert.match(notes, /unsigned/i);
  assert.match(notes, /More info/);
  assert.match(notes, /Run anyway/);
  assert.match(notes, /narration-utils-windows-x64\.zip/);
});

test('the install section comes after the changes and before the verification section', () => {
  const notes = releaseNotes({ GITHUB_REPOSITORY: 'countrymanprime/narration-utils' });

  assert.ok(notes.indexOf('## Features') < notes.indexOf('## Installing on Windows'));
  assert.ok(notes.indexOf('## Installing on Windows') < notes.indexOf('## Verifying this download'));
});
