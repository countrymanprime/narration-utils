#!/usr/bin/env node

import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { REAPER_FILES } from './reaper-files.mjs';

// The Go/Wails host embeds the two analysis tools and launches
// Python. A release must provide platform-native equivalents before it can be
// advertised as installable. This guard deliberately blocks publication until
// the runtime build places both executables in Wails embedded resources.
const runtime = resolve(process.env.NARRATION_UTILS_RUNTIME_DIR ?? 'apps/desktop/cmd/narration-utils/resources/runtime');
const resources = resolve(runtime, '..');
const executable = (name) => process.platform === 'win32' ? `${name}.exe` : name;
const missing = ['manuscript-guide', 'transcript-compare', 'manuscript-teleprompter']
  .filter((name) => !existsSync(resolve(runtime, name, executable(name))));
if (missing.length) {
  throw new Error(`Release runtime is incomplete: ${missing.join(', ')}. Build the native Python tool sidecars before publishing.`);
}
const guideInternal = resolve(runtime, 'manuscript-guide', '_internal');
const previewRuntimeMissing = ['piper', 'onnxruntime'].filter((name) => !existsSync(resolve(guideInternal, name)));
if (previewRuntimeMissing.length) {
  throw new Error(`Release preview runtime is incomplete: ${previewRuntimeMissing.join(', ')}. Manuscript Guide must embed Piper and ONNX Runtime.`);
}
// The frozen Story Bible sidecar must carry the data its Piper voice and its pronunciations read: PyInstaller has no hook for
// piper/espeak-ng-data or for cmudict (its dictionary and its package metadata), and losing them made previews fail (TTS PRD, cause 4).
// `narration-utils --smoke` proves they load; this proves they are in the tree before it is embedded.
const guideDataMissing = [
  ['piper', 'espeak-ng-data'],
  ['cmudict', 'data'],
]
  .filter((parts) => !existsSync(resolve(guideInternal, ...parts)))
  .map((parts) => parts.join('/'));
if (!(existsSync(guideInternal) && readdirSync(guideInternal).some((name) => /^cmudict-.+\.dist-info$/.test(name)))) {
  guideDataMissing.push('cmudict-<version>.dist-info');
}
if (guideDataMissing.length) {
  throw new Error(`Release Story Bible data is incomplete: ${guideDataMissing.join(', ')}. Manuscript Guide must collect the Piper and cmudict data and the cmudict metadata (scripts/release/prepare-resources.py).`);
}
// The Windows Teleprompter sidecar carries the Moonshine engine (moonshine-voice is pinned for Windows only in pyproject.toml). Its
// package loads moonshine.dll, and the onnxruntime.dll beside it, with ctypes from its own folder, which PyInstaller cannot see:
// prepare-resources.py collects them by hand. `narration-utils --smoke` proves they load (`--check-moonshine`); this proves they are
// in the tree before it is embedded.
if (process.platform === 'win32') {
  const moonshineDir = resolve(runtime, 'manuscript-teleprompter', '_internal', 'moonshine_voice');
  const moonshineMissing = ['moonshine.dll', 'onnxruntime.dll'].filter((name) => !existsSync(resolve(moonshineDir, name)));
  if (moonshineMissing.length) {
    throw new Error(`Release Moonshine engine is incomplete: moonshine_voice/${moonshineMissing.join(', moonshine_voice/')}. Manuscript Teleprompter must collect the moonshine_voice binaries (scripts/release/prepare-resources.py).`);
  }
}
// The five approved asset catalogs travel with the release: the app reads them to know what it may offer to download.
const catalogsMissing = ['tts-assets.json', 'whisper-assets.json', 'spacy-assets.json', 'moonshine-assets.json', 'dictionary-assets.json'].filter((name) => !existsSync(resolve(resources, 'config', name)));
if (catalogsMissing.length) {
  throw new Error(`Release asset catalogs are missing: ${catalogsMissing.join(', ')}. prepare-resources.py copies config/ into the resources.`);
}
const reaperMissing = REAPER_FILES
  .filter((name) => !existsSync(resolve(resources, 'reaper', name)));
if (reaperMissing.length) {
  throw new Error(`Release REAPER package is incomplete: ${reaperMissing.join(', ')}.`);
}
console.log(`Verified packaged runtime at ${runtime}.`);
