import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { ADR_DIR, INDEX_END, INDEX_START, adrEntry, readAdrs, renderIndex, replaceIndex } from './adr-index.mjs';
import { REPO_ROOT } from './layout.mjs';

test('adrEntry reads the number and title from the heading and the status line as written', () => {
  const text = '# 0042. A decision with `code` in it\n\n**Status:** Accepted\n**Date:** 2026-09-20\n\n## Context\n';

  assert.deepEqual(adrEntry('0042-a-decision.md', text), {
    number: '0042',
    file: '0042-a-decision.md',
    title: 'A decision with `code` in it',
    status: 'Accepted',
  });
});

test('adrEntry reads the older list-style header and capitalises its status', () => {
  const text = '# 0011. Screenshots are curated\n\n- Status: accepted\n- Date: 2026-09-18\n';

  assert.equal(adrEntry('0011-screenshots.md', text).status, 'Accepted');
});

test('adrEntry turns a link into its text and escapes a pipe, so the cell stays one table cell', () => {
  const text =
    '# 0009. Complete the migration | for real\n\n**Status:** Accepted (its exception is superseded by [ADR 0056](0056-a-table.md))\n**Date:** 2026-09-18\n';

  const entry = adrEntry('0009-complete.md', text);

  assert.equal(entry.title, 'Complete the migration \\| for real');
  assert.equal(entry.status, 'Accepted (its exception is superseded by ADR 0056)');
});

test('adrEntry escapes a backslash too, so a backslash before a pipe cannot unescape it and split the cell', () => {
  const entry = adrEntry('0042-x.md', '# 0042. A path C:\\| and more\n\n**Status:** Accepted\n');
  // GFM splits a row at every pipe that an even number of backslashes (none included) precedes.
  const cells = renderIndex([entry])
    .split('\n')[2]
    .split(/(?<=(?:^|[^\\])(?:\\\\)*)\|/);

  assert.equal(entry.title, 'A path C:\\\\\\| and more');
  assert.equal(cells.length, 5, 'the row has three cells between its outer pipes');
});

test('adrEntry refuses a file whose heading number is not its file number, or that has no status', () => {
  assert.throws(() => adrEntry('0042-x.md', '# 0043. X\n\n**Status:** Accepted\n'), /0042-x\.md: its heading says 0043/);
  assert.throws(() => adrEntry('0042-x.md', '# 0042. X\n\n**Date:** 2026-09-20\n'), /0042-x\.md has no Status line/);
  assert.throws(() => adrEntry('0042-x.md', 'no heading\n\n**Status:** Accepted\n'), /0042-x\.md has no "# 0042\. Title" heading/);
});

test('renderIndex lists the ADRs in number order, one linked row each', () => {
  const table = renderIndex([
    { number: '0002', file: '0002-b.md', title: 'B', status: 'Proposed' },
    { number: '0001', file: '0001-a.md', title: 'A', status: 'Accepted' },
  ]);

  assert.equal(
    table,
    ['| # | Title | Status |', '| --- | --- | --- |', '| [0001](0001-a.md) | A | Accepted |', '| [0002](0002-b.md) | B | Proposed |'].join('\n'),
  );
});

test('replaceIndex swaps only what is between the markers, and refuses a README without them', () => {
  const readme = `# ADRs\n\n## Index\n\n${INDEX_START}\nold table\n${INDEX_END}\n\nAfter.\n`;

  assert.equal(replaceIndex(readme, 'new table'), `# ADRs\n\n## Index\n\n${INDEX_START}\nnew table\n${INDEX_END}\n\nAfter.\n`);
  assert.throws(() => replaceIndex('# ADRs\n', 'new table'), /has no index markers/);
});

test('readAdrs reads every numbered ADR and nothing else (the README and the template are not ADRs)', () => {
  const adrs = readAdrs(join(REPO_ROOT, ADR_DIR));

  assert.ok(adrs.length > 200);
  assert.ok(adrs.every((adr) => /^\d{4}-.+\.md$/.test(adr.file)));
  assert.equal(new Set(adrs.map((adr) => adr.number)).size, adrs.length, 'two ADRs share a number');
});

test('the index in docs/adr/README.md is the one the ADR files make (run `node scripts/ci/adr-index.mjs --write`)', () => {
  const path = join(REPO_ROOT, ADR_DIR, 'README.md');
  const readme = readFileSync(path, 'utf8');

  assert.equal(
    readme,
    replaceIndex(readme, renderIndex(readAdrs(join(REPO_ROOT, ADR_DIR)))),
    'docs/adr/README.md is stale: run `node scripts/ci/adr-index.mjs --write`',
  );
});
