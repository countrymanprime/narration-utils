import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { REAPER_FILES } from './reaper-files.mjs';

const reaperDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'integrations', 'reaper');
const topLevelLua = () =>
  readdirSync(reaperDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.lua'))
    .map((entry) => entry.name)
    .sort();

test('the packaged REAPER file list is every top-level Lua file in integrations/reaper', () => {
  assert.deepEqual([...REAPER_FILES].sort(), topLevelLua(), 'add a new Lua file to scripts/release/reaper-files.mjs, or the installer check will not require it');
});

test('every feature file the bridge loads is in the packaged list', () => {
  const bridge = readFileSync(join(reaperDir, 'narration_ui_bridge.lua'), 'utf8');
  const listed = /FEATURE_FILES = \{([^}]*)\}/.exec(bridge)?.[1] ?? '';
  const features = [...listed.matchAll(/'([^']+\.lua)'/g)].map((match) => match[1]);

  assert.ok(features.length >= 2, 'the bridge lists its feature files');
  for (const name of features) {
    assert.ok(REAPER_FILES.includes(name), `${name} is loaded by the bridge but missing from REAPER_FILES`);
  }
});
