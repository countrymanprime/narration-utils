#!/usr/bin/env node

// Wails embeds assets from inside its Go module. Copy the already-built React
// distribution immediately before a desktop build; do not make releases read
// apps/ui/dist from an adjacent checkout path.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'apps/ui/dist');
const destination = resolve(root, 'apps/desktop/cmd/narration-utils/frontend/dist');

if (!existsSync(resolve(source, 'index.html'))) {
  throw new Error('Build apps/ui before copying Wails frontend assets.');
}
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
