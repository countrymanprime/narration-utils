import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { REPO_ROOT } from '../ci/layout.mjs';
import { BEGIN, END, checkDocument, generateDocument, loadCatalogs, renderTables, replaceGenerated } from './models.mjs';

const whisper = {
  models: [
    {
      id: 'tiny',
      provider: 'faster-whisper',
      displayName: 'Tiny',
      version: 'd90ca5fe260221311c53c58e660288d3deb8d356',
      publisher: 'Systran',
      license: 'MIT',
      licenseUrl: 'https://huggingface.co/Systran/faster-whisper-tiny',
      provenanceUrl: 'https://huggingface.co/Systran/faster-whisper-tiny/tree/d90ca5fe',
      files: [
        { name: 'config.json', url: 'https://x/config.json', sha256: 'a'.repeat(64), size: 2249 },
        { name: 'model.bin', url: 'https://x/model.bin', sha256: 'b'.repeat(64), size: 75538270 },
      ],
    },
  ],
};
const review = {
  catalogued: { 'faster-whisper/tiny': { commercialUse: 'Yes (MIT)', status: 'in the catalog', note: 'CTranslate2 conversion of OpenAI Whisper.' } },
  uncatalogued: [{ name: 'Moonshine', source: 'moonshine-ai', license: 'unclear', commercialUse: 'unclear', status: 'unclear: not in the catalog', note: 'Per-model text unconfirmed.' }],
};

test('renderTables lists each artifact with its licence, its pinned revision and its total size', () => {
  const text = renderTables([{ ...whisper.models[0], kind: 'whisper' }], review);

  assert.match(text, /\| faster-whisper\/tiny \|/);
  assert.match(text, /Systran/);
  assert.match(text, /\[MIT\]\(https:\/\/huggingface.co\/Systran\/faster-whisper-tiny\)/);
  assert.match(text, /d90ca5fe2602/);
  assert.match(text, /72\.\d MiB/);
  assert.match(text, /Yes \(MIT\)/);
});

test('renderTables lists every file with its size and SHA-256', () => {
  const text = renderTables([{ ...whisper.models[0], kind: 'whisper' }], review);

  assert.match(text, /\| faster-whisper\/tiny \| `model\.bin` \| 75,538,270 \| `b{64}` \|/);
  assert.match(text, /\| faster-whisper\/tiny \| `config\.json` \| 2,249 \| `a{64}` \|/);
});

test('renderTables lists what is not in the catalog with its status, so an unclear licence is written down', () => {
  const text = renderTables([{ ...whisper.models[0], kind: 'whisper' }], review);

  assert.match(text, /\| Moonshine \| moonshine-ai \| unclear \| unclear \| unclear: not in the catalog \|/);
});

test('renderTables refuses a catalog artifact that nobody reviewed', () => {
  assert.throws(() => renderTables([{ ...whisper.models[0], kind: 'whisper' }], { catalogued: {}, uncatalogued: [] }), /faster-whisper\/tiny/);
});

test('renderTables refuses a review row for an artifact that is not in the catalog any more', () => {
  const stale = { ...review, catalogued: { ...review.catalogued, 'piper/gone': { commercialUse: 'x', status: 'y', note: 'z' } } };

  assert.throws(() => renderTables([{ ...whisper.models[0], kind: 'whisper' }], stale), /piper\/gone/);
});

test('replaceGenerated swaps only what is between the markers', () => {
  const document = `intro\n${BEGIN}\nold\n${END}\noutro\n`;

  assert.equal(replaceGenerated(document, 'new'), `intro\n${BEGIN}\nnew\n${END}\noutro\n`);
});

test('replaceGenerated says so when a marker is missing', () => {
  assert.throws(() => replaceGenerated('no markers here', 'x'), /markers/);
});

test('checkDocument reports a table that no longer matches the catalogs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'models-'));
  mkdirSync(join(dir, 'config'));
  writeFileSync(join(dir, 'config', 'whisper-assets.json'), JSON.stringify(whisper));
  writeFileSync(join(dir, 'config', 'tts-assets.json'), JSON.stringify({ voices: [] }));
  writeFileSync(join(dir, 'config', 'spacy-assets.json'), JSON.stringify({ models: [] }));
  writeFileSync(join(dir, 'config', 'moonshine-assets.json'), JSON.stringify({ models: [] }));
  const generated = generateDocument(`${BEGIN}\n${END}\n`, loadCatalogs(join(dir, 'config')), review);

  assert.equal(checkDocument(generated, loadCatalogs(join(dir, 'config')), review), true);
  assert.equal(checkDocument(generated.replace('Systran', 'Somebody Else'), loadCatalogs(join(dir, 'config')), review), false);
});

test('the committed provenance document matches the four catalogs (run `node scripts/licenses/models.mjs` to rewrite it)', async () => {
  const { readFileSync } = await import('node:fs');
  const document = readFileSync(join(REPO_ROOT, 'docs/architecture/model-provenance.md'), 'utf8');
  const reviewFile = JSON.parse(readFileSync(join(REPO_ROOT, 'scripts/licenses/model-review.json'), 'utf8'));

  assert.equal(checkDocument(document, loadCatalogs(join(REPO_ROOT, 'config')), reviewFile), true, 'docs/architecture/model-provenance.md is out of date');
});
