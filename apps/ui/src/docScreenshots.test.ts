import { describe, expect, test } from 'vitest';
import { STATE_CATALOG } from '../tests/visual/state-catalog';
import { VIEWPORTS } from '../tests/visual/viewports';
import docScreenshots from '../tests/visual/doc-screenshots.json';

// The docs/guides/using-the-app/ pages embed a curated subset of
// STATE_CATALOG, listed in tests/visual/doc-screenshots.json and synced into
// docs/images/ui/ by scripts/sync-doc-screenshots.mjs (see the
// doc-screenshot-sync skill). This test is the cheap, deterministic half of
// "keep the docs in sync": if a page/state referenced there is renamed or
// removed from STATE_CATALOG, this fails loudly instead of leaving the docs
// silently pointing at a state that no longer exists. docsGuide.test.ts checks
// the other side: that every manifest entry is embedded on exactly one page.

describe('docs/guides/using-the-app screenshot manifest', () => {
  test('every entry points at a real STATE_CATALOG row', () => {
    for (const entry of docScreenshots) {
      const found = STATE_CATALOG.some((row) => row.page === entry.page && row.state === entry.state);
      expect(found, `${entry.page}/${entry.state} (docName: ${entry.docName}) is not in STATE_CATALOG`).toBe(true);
    }
  });

  test('every entry uses a known viewport', () => {
    for (const entry of docScreenshots) {
      const found = VIEWPORTS.some((viewport) => viewport.name === entry.viewport);
      expect(found, `${entry.docName} references unknown viewport "${entry.viewport}"`).toBe(true);
    }
  });

  test('docNames are unique', () => {
    const names = docScreenshots.map((entry) => entry.docName);
    expect(new Set(names).size).toBe(names.length);
  });
});
