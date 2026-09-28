// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

// ADR 0640 (mock-fidelity-primitives-and-components.prd.md Phase 4): a card is a `Panel`, a card inside a card an
// `InsetCard`, an eyebrow a `SectionLabel` and a page title a `Heading`, so each looks one way. This scan counts the copies
// written outside `components/primitives/`, per file, and a file's count may only go down: a ceiling higher than the real
// count fails, so the entry is lowered (or deleted at zero) in the same change, and a file with no entry may have none.
//
// The entries left are files other phases own (the PRD's ownership rule): the page-specific components (Phases 11 to 15)
// and the shell (Phase 8). Each lowers its own when it composes the primitives.
const COPIES = {
  // A hand-drawn card: the frame Panel draws (`PANEL_FRAME_CLASS`).
  card: /rounded-lg border/g,
  // A hand-drawn inset card.
  inset: /rounded-md border(?! border-transparent)/g,
  // The eyebrow's class string, or the global class that draws it.
  eyebrow: /tracking-\[0\.08em\][^"'`]*uppercase|uppercase[^"'`]*tracking-\[0\.08em\]|\bsection-label\b/g,
  // A page title that is not a Heading.
  h1: /<h1[\s>]/g,
} as const;
type Copy = keyof typeof COPIES;

const CEILING: Record<Copy, Record<string, number>> = {
  card: {
    // Page components the page phases own: the Booth's rail (13), Production (11), Proof's findings (12). The
    // companion panel's own card dropped to 0 in the same phase (ADR 0659: full-bleed sections, not cards).
    'src/components/booth/ReaderRail.tsx': 1,
    'src/components/proof/FindingsList.tsx': 1,
    'src/components/proof/NotesStrip.tsx': 1,
    // Not cards. A warning on a tinted fill, which neither Panel nor InsetCard draws.
    'src/components/booth/UnresolvedCreditsWarning.tsx': 1,
    // A card that is a button (the .rpp picker's rows, the recent projects): a Panel is a section, not a control.
    'src/components/engine/EnginePanel.tsx': 1,
    'src/components/project/ProjectPicker.tsx': 1,
    // The chapter card's sticky header rounds its own top corners (`rounded-lg border-b-0`); the card is PANEL_FRAME_CLASS.
    'src/components/manuscript/ReaderCard.tsx': 1,
    // The waveform's frame, with its own tight padding round the drawing.
    'src/components/proof/WaveformStrip.tsx': 1,
  },
  inset: {
    // Proof's finding detail (Phase 12).
    'src/components/proof/FindingDetail.tsx': 1,
    // The disagree choice's card, which is a button (the source and the sentence it names).
    'src/components/booth/ResumePrompt.tsx': 1,
  },
  eyebrow: {
    // The shell's nav group headings and the header's Project label (Phase 8, which owns AppShell.tsx).
    'src/components/layout/AppShell.tsx': 3,
    // Page components the page phases own: the Booth (13), Master (14) and Script (15).
    'src/components/booth/BoothView.tsx': 1,
    'src/components/booth/CompanionShell.tsx': 1,
    'src/components/booth/ReaderRail.tsx': 1,
    'src/components/master/BookConsistency.tsx': 1,
    'src/components/master/DeliveryPackagePanel.tsx': 1,
    'src/components/script/ScriptChapterList.tsx': 2,
    'src/components/script/ScriptPage.tsx': 6,
  },
  h1: {
    // The Booth's page title is visually hidden (`sr-only`): the reading surface is the page, and a Heading would show.
    'src/components/booth/BoothPage.tsx': 1,
  },
};

const SRC = join(__dirname);
const PRIMITIVES = join(SRC, 'components', 'primitives');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return path === PRIMITIVES ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name) ? [path] : [];
  });
}

function counts(): Record<Copy, Record<string, number>> {
  const found: Record<Copy, Record<string, number>> = { card: {}, inset: {}, eyebrow: {}, h1: {} };
  for (const path of sourceFiles(join(SRC, 'components'))) {
    const text = readFileSync(path, 'utf8');
    const file = ['src', ...relative(SRC, path).split(sep)].join('/');
    for (const copy of Object.keys(COPIES) as Copy[]) {
      const n = text.match(COPIES[copy])?.length ?? 0;
      if (n > 0) found[copy][file] = n;
    }
  }
  return found;
}

describe('panel, inset card, eyebrow and page-title copies outside the primitives (ADR 0640)', () => {
  const found = counts();
  test.each(Object.keys(COPIES) as Copy[])('no file has more %s copies than its ceiling, and no ceiling is higher than its count', (copy) => {
    expect(found[copy]).toEqual(CEILING[copy]);
  });
});
