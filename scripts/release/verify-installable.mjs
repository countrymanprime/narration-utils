#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The Rust HTTP host is embedded, but the two analysis tools still launch
// Python. A release must provide platform-native equivalents before it can be
// advertised as installable. This guard deliberately blocks publication until
// the runtime build places both executables in Tauri resources.
const runtime = resolve(process.env.NARRATION_UTILS_RUNTIME_DIR ?? 'shell/src-tauri/resources/runtime');
const executable = (name) => process.platform === 'win32' ? `${name}.exe` : name;
const missing = ['manuscript-guide', 'transcript-compare']
  .filter((name) => !existsSync(resolve(runtime, name, executable(name))));
if (missing.length) {
  throw new Error(`Release runtime is incomplete: ${missing.join(', ')}. Build the native Python tool sidecars before publishing.`);
}
console.log(`Verified packaged runtime at ${runtime}.`);
