#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
const reaperMissing = ['NarrationUtils_Launcher.lua', 'reaper_common_core.lua', 'reaper_common_process.lua', 'narration_ui_bridge.lua']
  .filter((name) => !existsSync(resolve(resources, 'reaper', name)));
if (reaperMissing.length) {
  throw new Error(`Release REAPER package is incomplete: ${reaperMissing.join(', ')}.`);
}
console.log(`Verified packaged runtime at ${runtime}.`);
