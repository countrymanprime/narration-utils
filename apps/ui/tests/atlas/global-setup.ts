// ui-atlas-kit 0.3.1 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// A removed or renamed story would otherwise leave its screenshots behind, looking current in a review.
export default function globalSetup(): void {
  const root = 'screenshots/atlas';
  if (!existsSync(root) || !existsSync('storybook-static/index.json')) return;
  const index = JSON.parse(readFileSync('storybook-static/index.json', 'utf8')) as { entries: Record<string, { type: string; title: string }> };
  const known = new Set(
    Object.values(index.entries)
      .filter((entry) => entry.type === 'story')
      .map((entry) => slug(entry.title)),
  );
  for (const folder of readdirSync(root, { withFileTypes: true })) {
    if (folder.isDirectory() && !known.has(folder.name)) rmSync(join(root, folder.name), { recursive: true, force: true });
  }
}
