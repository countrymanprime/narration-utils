// Reads the Mermaid diagrams of the Markdown files and asks Mermaid's own parser whether each one is valid.
//
// GitHub and the docs site draw a fenced ```mermaid block in the reader's browser, so a typo shows up there as an error box and
// nowhere earlier: lychee sees text, MkDocs sees a code block. `mermaid.parse` runs in Node without a browser once it has a DOM to
// hand its sanitizer (jsdom, which the UI's tests already use), so the check is cheap and local. It proves the syntax, not that the
// names in the picture are still true: that is the reviewer's check and the `feature-cleanup` line.

import { JSDOM } from 'jsdom';

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*mermaid[^\n]*\r?\n([\s\S]*?)^\1\2[ \t]*$/gm;

/** Every ```mermaid block of a Markdown text, with the 1-based line its first diagram line is on. */
export function extractMermaidBlocks(markdown) {
  const blocks = [];
  for (const match of markdown.matchAll(FENCE)) {
    const line = markdown.slice(0, match.index).split('\n').length + 1;
    blocks.push({ line, source: match[3].replace(/\r\n/g, '\n') });
  }
  return blocks;
}

let mermaidPromise;

/** Mermaid loaded once, after a DOM exists for its sanitizer (a flowchart fails with "DOMPurify.addHook is not a function" without one). */
function loadMermaid() {
  mermaidPromise ??= (async () => {
    const { window } = new JSDOM('<!doctype html><html><body></body></html>');
    globalThis.window = window;
    globalThis.document = window.document;
    const { default: mermaid } = await import('mermaid');
    return mermaid;
  })();
  return mermaidPromise;
}

/** `{ ok: true, type }` for a valid diagram, `{ ok: false, message }` with the parser's first lines otherwise. */
export async function parseDiagram(source) {
  const mermaid = await loadMermaid();
  try {
    const { diagramType } = await mermaid.parse(source);
    return { ok: true, type: diagramType };
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error).split('\n').slice(0, 4).join(' | ') };
  }
}
