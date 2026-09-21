import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { REAPER_FILES } from './reaper-files.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'verify-installable.mjs');
const executable = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

// A minimal release tree: what prepare-resources.py leaves in resources/ (runtime/ next to config/ and reaper/), with one file for
// each thing verify-installable looks for. Each test removes one thing and requires the script to name it.
function healthyTree() {
  const root = mkdtempSync(join(tmpdir(), 'verify-installable-'));
  const runtime = join(root, 'runtime');
  const touch = (...parts) => {
    const path = join(root, ...parts);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'x');
  };
  for (const name of ['manuscript-guide', 'transcript-compare', 'manuscript-teleprompter']) touch('runtime', name, executable(name));
  const internal = ['runtime', 'manuscript-guide', '_internal'];
  touch(...internal, 'piper', 'espeak-ng-data', 'en_dict');
  touch(...internal, 'onnxruntime', 'capi', 'onnxruntime.dll');
  touch(...internal, 'cmudict', 'data', 'cmudict.dict');
  touch(...internal, 'cmudict-1.1.3.dist-info', 'METADATA');
  for (const catalog of ['tts-assets.json', 'whisper-assets.json', 'spacy-assets.json']) touch('config', catalog);
  for (const file of REAPER_FILES) touch('reaper', file);
  return { root, runtime, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function verify(runtime) {
  const result = spawnSync(process.execPath, [script], { env: { ...process.env, NARRATION_UTILS_RUNTIME_DIR: runtime }, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function withTree(remove, expected) {
  const tree = healthyTree();
  try {
    if (remove) rmSync(join(tree.root, ...remove), { recursive: true, force: true });
    const { status, output } = verify(tree.runtime);
    if (expected) {
      assert.notEqual(status, 0, `a tree without ${remove.join('/')} passed`);
      assert.match(output, expected);
    } else {
      assert.equal(status, 0, output);
    }
  } finally {
    tree.cleanup();
  }
}

test('a complete release tree passes', () => withTree(null, null));

test('a missing sidecar fails and is named', () => withTree(['runtime', 'transcript-compare', executable('transcript-compare')], /transcript-compare/));

test('a frozen guide without the Piper voice runtime fails', () => withTree(['runtime', 'manuscript-guide', '_internal', 'onnxruntime'], /onnxruntime/));

test('a frozen guide without the espeak-ng data fails and names it', () =>
  withTree(['runtime', 'manuscript-guide', '_internal', 'piper', 'espeak-ng-data'], /piper\/espeak-ng-data/));

test('a frozen guide without the CMU dictionary data fails and names it', () =>
  withTree(['runtime', 'manuscript-guide', '_internal', 'cmudict', 'data'], /cmudict\/data/));

test('a frozen guide without the cmudict package metadata fails and names it', () =>
  withTree(['runtime', 'manuscript-guide', '_internal', 'cmudict-1.1.3.dist-info'], /cmudict-<version>\.dist-info/));

test('a release without an approved asset catalog fails and names it', () => withTree(['config', 'spacy-assets.json'], /spacy-assets\.json/));

test('a release without the REAPER launcher fails and names it', () => withTree(['reaper', REAPER_FILES[0]], new RegExp(REAPER_FILES[0])));
