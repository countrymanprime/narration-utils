#!/usr/bin/env node

// Wails embeds assets from inside its Go module. Copy the already-built React
// distribution immediately before a desktop build; do not make releases read
// shared/ui/dist from an adjacent checkout path.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'shared/ui/dist');
const destination = resolve(root, 'shell/cmd/narration-utils/frontend/dist');

if (!existsSync(resolve(source, 'index.html'))) {
  throw new Error('Build shared/ui before copying Wails frontend assets.');
}
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });
