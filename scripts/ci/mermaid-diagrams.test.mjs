import assert from 'node:assert/strict';
import test from 'node:test';

import { readTrackedText, trackedFiles } from './layout.mjs';
import { extractMermaidBlocks, parseDiagram } from './mermaid-diagrams.mjs';

const fence = '`'.repeat(3);

test('extractMermaidBlocks finds each mermaid fence with its line and leaves other fences alone', () => {
  const markdown = ['# Title', '', `${fence}mermaid`, 'flowchart LR', '  A --> B', fence, '', `${fence}go`, 'package main', fence, '', `${fence}mermaid`, 'sequenceDiagram', '  A->>B: hi', fence, ''].join('\n');

  const blocks = extractMermaidBlocks(markdown);

  assert.deepEqual(
    blocks.map((block) => block.line),
    [4, 13],
  );
  assert.equal(blocks[0].source, 'flowchart LR\n  A --> B\n');
  assert.match(blocks[1].source, /^sequenceDiagram/);
});

test('extractMermaidBlocks reads an indented fence and CRLF line ends', () => {
  const markdown = `- item\r\n\r\n  ${fence}mermaid\r\n  flowchart LR\r\n    A --> B\r\n  ${fence}\r\n`;

  const blocks = extractMermaidBlocks(markdown);

  assert.equal(blocks.length, 1);
  assert.match(blocks[0].source, /flowchart LR/);
});

test('parseDiagram accepts a flowchart and a sequence diagram, both without a browser', async () => {
  assert.deepEqual(await parseDiagram('flowchart LR\n  A[one] --> B[two]\n'), { ok: true, type: 'flowchart-v2' });
  assert.deepEqual(await parseDiagram('sequenceDiagram\n  A->>B: hi\n'), { ok: true, type: 'sequence' });
});

test('parseDiagram refuses a malformed diagram and says where', async () => {
  const flowchart = await parseDiagram('flowchart LR\n  A[one --> \n');
  const sequence = await parseDiagram('sequenceDiagram\n  A->>B\n  not a statement\n');

  assert.equal(flowchart.ok, false);
  assert.match(flowchart.message, /Parse error on line/);
  assert.equal(sequence.ok, false);
});

// The diagrams this repository draws on purpose (docs-security-and-hygiene PRD, phases 4 and 5): one container view and four flows, each
// beside the doc that owns it. A doc that loses its diagram is a regression the parse check would otherwise not notice.
const OWNERS = [
  'docs/architecture/codebase-map.md',
  'docs/architecture/first-use-dependency-provisioning.md',
  'docs/architecture/manuscript-teleprompter.md',
  'docs/architecture/reaper-bridge.md',
  'docs/architecture/in-app-update.md',
];

test('every Mermaid diagram in the repository parses, and the five owning docs still have theirs', async () => {
  const documents = readTrackedText(trackedFiles().filter((file) => file.endsWith('.md')));
  const problems = [];
  const owners = new Set();
  for (const [file, text] of documents) {
    for (const block of extractMermaidBlocks(text)) {
      owners.add(file);
      const result = await parseDiagram(block.source);
      if (!result.ok) problems.push(`${file}:${block.line} ${result.message}`);
    }
  }

  assert.deepEqual(problems, [], `A Mermaid diagram does not parse (GitHub and the docs site would show an error box):\n${problems.join('\n')}`);
  assert.deepEqual(
    OWNERS.filter((file) => !owners.has(file)),
    [],
    "These docs lost their diagram: if it moved on purpose, update OWNERS in this test",
  );
});
