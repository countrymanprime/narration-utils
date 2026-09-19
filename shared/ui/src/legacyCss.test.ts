// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR-0016: unlayered legacy CSS silently beats Tailwind utilities, and class
// names whose CSS was deleted silently render unstyled. These guards fail the
// build when either comes back.

const SRC = join(__dirname);
const REMOVED_CLASSES = ['overlay-panel', 'overlay-open', 'sheet-backdrop', 'note-overlay', 'source-flash', 'reader-control-band', 'alias-match-'];
// Reviewed exceptions from ADR-0009 that may stay as plain (unlayered) class rules.
const UNLAYERED_ALLOW_LIST = new Set([
  'manuscript-reader',
  'progress-segment',
  'scroll-chrome-hidden',
  'guide-list-scroll',
  'reader-page',
  'reader-chapters',
  'source-line-number',
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css)$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx') ? [path] : [];
  });
}

// Strips @layer blocks, @keyframes, @media and :root so only top-level
// unlayered rules remain.
function unlayeredCss(css: string): string {
  let out = '';
  let depth = 0;
  let skipDepth = -1;
  for (let index = 0; index < css.length; index++) {
    const char = css[index];
    if (char === '{') {
      const header = css.slice(out.length > 0 ? Math.max(0, css.lastIndexOf('}', index) + 1) : 0, index).trim();
      if (skipDepth < 0 && /^@(layer|keyframes|media)|^:root/.test(header.split('\n').pop()!.trim() || header)) skipDepth = depth;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === skipDepth) skipDepth = -1;
      continue;
    }
    if (skipDepth < 0) out += char;
  }
  return out;
}

describe('legacy CSS guards (ADR-0016)', () => {
  it('no source file references a removed legacy class name', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => !file.endsWith('legacyCss.test.ts'))
      .flatMap((file) => {
        const text = readFileSync(file, 'utf8');
        return REMOVED_CLASSES.filter((name) => new RegExp(`(^|[\\s"'\`.])${name}`).test(text)).map((name) => `${file}: ${name}`);
      });
    expect(offenders).toEqual([]);
  });

  it('styles.css only keeps reviewed unlayered class rules', () => {
    const css = readFileSync(join(SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const classes = new Set([...unlayeredCss(css).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1]));
    const unexpected = [...classes].filter((name) => !UNLAYERED_ALLOW_LIST.has(name) && !name.startsWith('type-'));
    expect(unexpected).toEqual([]);
  });
});
