#!/usr/bin/env node
/* global console, process */
// Writes docs/ui/ from the Storybook build: one page per Storybook title under docs/ui/atlas/, a light-theme image of
// each from the atlas screenshots under docs/ui/images/, and docs/ui/inventory.json. Run `pnpm --dir apps/ui atlas`
// first (it builds Storybook and takes the screenshots), then `pnpm --dir apps/ui docs:atlas`.
//
// Everything under docs/ui/atlas and docs/ui/images is generated and pruned; inventory.json keeps the fields a person
// added (tier, depth, atlasExempt) and the components that have no stories. Dependency-free Node apart from sharp (an
// apps/ui dev dependency), which only the images need.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const posix = (p) => p.split(sep).join('/');
const readText = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const stripExt = (file) => basename(file).replace(/\.(tsx|jsx)$/, '');

function walk(dir, keep = () => true) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full, keep) : keep(full) ? [full] : [];
  });
}

const SOURCE_SKIP = /(^|[\\/])(node_modules|dist|storybook-static|screenshots|test-results|docs|\.git)([\\/]|$)/;

/**
 * @param {string} uiDir the UI project (holds storybook-static/, screenshots/atlas/, src/, tests/atlas/a11y-debt.ts)
 * @param {string} outDir where docs/ui lives
 */
export async function atlasDocs(uiDir, outDir) {
  const indexPath = join(uiDir, 'storybook-static', 'index.json');
  if (!existsSync(indexPath)) throw new Error(`no ${posix(relative(process.cwd(), indexPath))}: run the storybook build (pnpm atlas) first`);
  const entries = Object.values(readJson(indexPath).entries).filter((e) => e.type === 'story');
  // One page per Storybook title: two story files for one component file stay two pages.
  const groups = new Map();
  for (const entry of entries) groups.set(entry.title, [...(groups.get(entry.title) ?? []), entry]);

  const imgDir = join(outDir, 'images');
  mkdirSync(join(outDir, 'atlas'), { recursive: true });
  mkdirSync(imgDir, { recursive: true });
  let sharp;
  try {
    sharp = createRequire(join(uiDir, 'package.json'))('sharp');
  } catch {
    sharp = undefined;
  }
  const isBlank = async (file) => {
    if (!sharp) return false;
    const { channels } = await sharp(file).stats();
    return Math.max(...channels.slice(0, 3).map((c) => c.stdev)) < 1;
  };

  const sources = walk(uiDir, (f) => /\.(tsx?|jsx?)$/.test(f) && !/\.(stories|test|spec)\./.test(f) && !SOURCE_SKIP.test(posix(relative(uiDir, f))));
  const debtPath = join(uiDir, 'tests', 'atlas', 'a11y-debt.ts');
  const debtText = existsSync(debtPath) ? readText(debtPath) : '';
  const inventoryPath = join(outDir, 'inventory.json');
  const prior = existsSync(inventoryPath) ? (readJson(inventoryPath).components ?? []) : [];
  const norm = (n) => n.toLowerCase().replace(/[-_\s]/g, '');
  const used = new Set();
  const writtenPages = new Set(['index.md']);
  const writtenImages = new Set();
  const inventory = [];
  const ordered = [...groups.values()].sort((a, b) => a[0].title.localeCompare(b[0].title));
  const fileNameOf = (stories) => (stories[0].componentPath ? stripExt(posix(stories[0].componentPath)) : stories[0].title.split('/').pop());
  const sharedFile = new Map();
  for (const stories of ordered) sharedFile.set(norm(fileNameOf(stories)), (sharedFile.get(norm(fileNameOf(stories))) ?? 0) + 1);
  for (const stories of ordered) {
    const first = stories[0];
    const componentPath = first.componentPath ? posix(first.componentPath).replace(/^\.\//, '') : undefined;
    const titleTail = first.title.split('/').pop();
    const fileName = componentPath ? stripExt(componentPath) : titleTail;
    // Two titles for one component file: the title that IS the file's name keeps it, the others are named by their title,
    // so page names do not depend on Storybook's index order.
    const collides = (sharedFile.get(norm(fileName)) ?? 0) > 1;
    const pageBase = collides && norm(titleTail) !== norm(fileName) ? titleTail : fileName;
    // Adopt the casing of a hand-curated inventory entry rather than duplicating it.
    let name = prior.find((p) => norm(p.name) === norm(pageBase))?.name ?? pageBase;
    if (used.has(norm(name))) name = `${name}-${slug(titleTail)}`;
    used.add(norm(name));
    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importer = new RegExp(`from ['"][^'"]*/${escaped}(?:/index)?['"]`);
    const consumers = sources.filter((f) => importer.test(readText(f))).map((f) => posix(relative(uiDir, f)));
    let image = '';
    for (const story of stories) {
      const file = join(uiDir, 'screenshots', 'atlas', slug(story.title), `${slug(story.name)}--light-wide.png`);
      if (!existsSync(file) || (await isBlank(file))) continue;
      image = `images/${slug(name)}.webp`;
      writtenImages.add(`${slug(name)}.webp`);
      if (sharp) await sharp(file).resize({ width: 960, withoutEnlargement: true }).webp({ quality: 80 }).toFile(join(outDir, image));
      else image = '';
      break;
    }
    const debt = stories.some((s) => debtText.includes(`title: '${s.title}'`));
    const source = componentPath ?? (first.importPath ? posix(first.importPath).replace(/^\.\//, '') : undefined);
    inventory.push({ title: first.title, name, source, stories: stories.map((s) => s.name), consumers, a11yDebt: debt });
    const lines = [`# ${name}`, '', `Storybook title: \`${first.title}\`. Source: \`${source ?? 'n/a'}\`.`, ''];
    if (image) lines.push(`![${name}, ${first.name}, light theme](../${image})`, '');
    lines.push('## Stories', '', ...stories.map((s) => `- ${s.name}`), '');
    lines.push('## Used by', '', ...(consumers.length ? consumers.map((c) => `- \`${c}\``) : ['- nothing outside its own stories and tests yet']), '');
    if (debt) lines.push('## Known accessibility debt', '', 'This component has a recorded, reasoned exemption in `tests/atlas/a11y-debt.ts`.', '');
    writeFileSync(join(outDir, 'atlas', `${name}.md`), lines.join('\n'));
    writtenPages.add(`${name}.md`);
  }
  // Everything under docs/ui/atlas and docs/ui/images is generated: drop what this run did not produce.
  for (const [folder, ext, keep] of [
    ['atlas', '.md', writtenPages],
    ['images', '.webp', writtenImages],
  ]) {
    for (const file of readdirSync(join(outDir, folder))) if (file.endsWith(ext) && !keep.has(file)) unlinkSync(join(outDir, folder, file));
  }
  inventory.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(
    join(outDir, 'atlas', 'index.md'),
    [
      '# Component atlas',
      '',
      'Generated by `pnpm --dir apps/ui docs:atlas` from the Storybook build. Do not edit by hand.',
      '',
      ...inventory.map((c) => `- [${c.name}](${c.name}.md): ${c.stories.length} ${c.stories.length === 1 ? 'story' : 'stories'}`),
      '',
    ].join('\n'),
  );
  // Regenerate what Storybook knows; keep what a person wrote.
  const merged = inventory.map((generated) => ({ ...prior.find((p) => p.name === generated.name), ...generated }));
  const kept = prior.filter((p) => !inventory.some((generated) => generated.name === p.name));
  const components = [...merged, ...kept].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(inventoryPath, JSON.stringify({ generatedBy: 'apps/ui scripts/atlas-docs.mjs', components }, null, 2) + '\n');
  return { components: inventory.length, stories: entries.length, outDir, images: Boolean(sharp) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const uiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  atlasDocs(uiDir, resolve(uiDir, '..', '..', 'docs', 'ui'))
    .then((result) =>
      console.log(
        `docs: ${result.components} components, ${result.stories} stories -> ${posix(relative(process.cwd(), result.outDir))}${result.images ? '' : ' (no sharp: images skipped)'}`,
      ),
    )
    .catch((error) => {
      console.error(`atlas-docs: ${error.message}`);
      process.exitCode = 1;
    });
}
