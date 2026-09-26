// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

// ADR 0053 (and ADR 0056 for the table parts): a page builds a control from a primitive (`IconButton`, `TextField`, `SearchField`, `Select`, `Field`, ...) and
// not from the native element, so every control looks and behaves one way. This scan counts the native elements written in
// JSX outside `components/primitives/`, per file, and a file's count may only go down: a ceiling that is higher than the real
// count fails, so the entry is lowered (or deleted at zero) in the same change, and a file with no entry may have none. The
// controls the primitives now cover have no entry left: `Select`, `TextField`, `Field` and `Table`.
// No file outside the primitives may paste the icon-button look either (`size-8` with `rounded-md`).
//
// Buttons stay a ratchet rather than a ban ([ui-primitives PRD L10]: text buttons already have `Button`, and the bare ones
// left are a toast's dismiss, a card that is a button, a list row). A new file with a raw `<button>` needs an entry, which is
// a review-visible decision: prefer `Button`, `IconButton` or a new primitive.
const NATIVE_TAGS = ['button', 'select', 'input', 'textarea', 'table', 'thead', 'tbody', 'tr', 'th', 'td'] as const;
type NativeTag = (typeof NATIVE_TAGS)[number];

// Native elements written in JSX per file, outside the primitives, at the time of ADR 0053 (phase 5: no native select, input, textarea or table part is left).
const CEILING: Record<NativeTag, Record<string, number>> = {
  button: {
    // The header pill (PRD project-workspace-and-daw-link.prd.md, W15/W19): a pill shape with a status dot that
    // `Button`'s fixed base classes (rounded-md, border, px-4/py-2) cannot express through an appended className.
    'src/components/layout/AppShell.tsx': 1,
    'src/components/home/Home.tsx': 2,
    'src/components/manuscript/ChapterNav.tsx': 4,
    // The card's bookmark toggle and its whole-header toggle (manuscript-credits-card-parity.prd.md). `CreditsEntry.tsx`
    // now renders through this and has no raw button of its own (its old toggle button is gone, ceiling 0 below).
    'src/components/manuscript/ReaderCard.tsx': 2,
    'src/components/project/ProjectPicker.tsx': 3,
    'src/components/proofing/Transcript.tsx': 1,
    'src/components/settings/ScopedSetting.tsx': 1,
    // The click-to-seek word ("Start here" / "Go back to here", teleprompter-manuscript-integration.prd.md Phase 4):
    // one word among hundreds inside running prose, so it needs `Button`'s bare click/keyboard semantics without its
    // padded, uppercase button chrome, which would break the text flow and read as a real action button rather than a
    // word. One JSX `<button>` in the source (it is written once, inside the words `.map()`, not once per word).
    'src/components/teleprompter/ReaderText.tsx': 1,
    // The read-aloud rail's Story bible entries (teleprompter-manuscript-integration.prd.md Phase 5): a list row with a
    // category dot and a current state, the same shape as ChapterNav's rows, which Button's padded, uppercase chrome does
    // not fit. One JSX `<button>`, written once inside the entries `.map()`.
    'src/components/teleprompter/ReaderRail.tsx': 1,
    // The read-aloud rail's Flags list (teleprompter-manuscript-integration.prd.md Phase 7): the same list row as the Story
    // bible entries above (two lines of text and a current state), which Button's padded, uppercase chrome does not fit. One
    // JSX `<button>`, written once inside the flags `.map()`.
    'src/components/teleprompter/ReaderFlagsPanel.tsx': 1,
    'src/components/storybible/GuideDetail.tsx': 1,
    'src/components/tracks/TracksPage.tsx': 2,
    // The "Settings > Credits" link inside the "More fields" sentence (credits-token-setup-and-front-matter-detection.prd.md
    // Phase 2, CS4): an inline word inside a paragraph, the same case `ReaderText.tsx` above is for - `Button`'s padded,
    // uppercase chrome would break the sentence it sits in.
    'src/components/credits/CreditsSetupDialog.tsx': 1,
    // read-aloud-resume-from-daw.prd.md Phase 3's compact reconciliation notices (Change, Start from the top, Pick a word,
    // Continue there): plain underlined text links inline in a one-line sentence, the same `ReaderText.tsx`/
    // `CreditsSetupDialog.tsx` case above (`TextLink`, written once, reused by every call). The other is the disagree
    // choice's own card ("a card that is a button" - two places, REAPER and Last reading - written once as `card()`,
    // called twice): `Button`'s padded, uppercase chrome fits neither a plain link nor a card naming a source, a time and
    // a quoted sentence.
    'src/components/teleprompter/ResumePrompt.tsx': 2,
  },
  select: {},
  // Reaper-automation-follow-through PRD Phase 9: `PickupsDialog`'s CSV picker is a hidden native `<input type="file">`
  // triggered by a `Button` (ADR 0053's own escape hatch for file-choosing, since a file picker's OS chrome cannot be
  // restyled the way a text input or select can - the same reason `ManuscriptSelectFile` uses a native OS dialog).
  input: { 'src/components/tracks/PickupsDialog.tsx': 1 },
  textarea: {},
  table: {},
  thead: {},
  tbody: {},
  tr: {},
  th: {},
  td: {},
};

const uiRoot = join(__dirname, '..');
const srcRoot = join(uiRoot, 'src');
const primitivesDir = join('src', 'components', 'primitives');
const SOURCE = /\.tsx$/;
const NOT_UNDER_TEST = /\.(test|stories)\.tsx$/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return SOURCE.test(entry.name) && !NOT_UNDER_TEST.test(entry.name) ? [path] : [];
  });
}

type Found = { tags: Record<string, number>; pastedIconButtonLook: number };

// A tag counts once per element, whether it opens with children or is self-closing. Read with the TypeScript parser, so a
// comment or a string that only mentions `<select>` is fine, and a component named `Select` is not the native `select`.
function scan(source: string, fileName = 'probe.tsx'): Found {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Found = { tags: {}, pastedIconButtonLook: 0 };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(file);
      found.tags[name] = (found.tags[name] ?? 0) + 1;
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const tokens = node.text.split(/\s+/);
      if (tokens.includes('size-8') && tokens.includes('rounded-md')) found.pastedIconButtonLook++;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const pageFiles = tsxFiles(srcRoot)
  .map((file) => relative(uiRoot, file))
  .filter((file) => !file.startsWith(primitivesDir + sep));

describe('native controls stay inside the primitives (ADR 0053)', () => {
  const scans = pageFiles.map((file) => [file.split(sep).join('/'), scan(readFileSync(join(uiRoot, file), 'utf8'), file)] as const);

  test.each(NATIVE_TAGS)('raw <%s> counts only go down', (tag) => {
    const ceiling = CEILING[tag];
    const counts: Record<string, number> = {};
    for (const [file, found] of scans) {
      const count = found.tags[tag] ?? 0;
      if (count > 0) counts[file] = count;
    }
    const grew = Object.entries(counts).filter(([file, count]) => count > (ceiling[file] ?? 0));
    expect(
      grew,
      `a page gained a native <${tag}>: use the primitive (docs/design/design-system.md) or add one; raising a ceiling needs a reason in the pull request`,
    ).toEqual([]);
    const stale = Object.entries(ceiling).filter(([file, allowed]) => (counts[file] ?? 0) < allowed);
    expect(stale, `a page lost a native <${tag}>: lower its ceiling (delete the entry at zero)`).toEqual([]);
  });

  test('no page pastes the icon-button look', () => {
    const offenders = scans.filter(([, found]) => found.pastedIconButtonLook > 0).map(([file]) => file);
    expect(offenders, 'use <IconButton label="...">').toEqual([]);
  });

  test('the scan sees each way of writing the native controls (a bad fixture per form)', () => {
    expect(scan('const a = <select value="x" />;').tags).toEqual({ select: 1 });
    expect(scan('const a = <input />;').tags).toEqual({ input: 1 });
    expect(scan('const a = <textarea>hi</textarea>;').tags).toEqual({ textarea: 1 });
    expect(scan('const a = <table className="dtable"><tbody /></table>;').tags).toEqual({ table: 1, tbody: 1 });
    expect(scan('const a = <button type="button">x</button>;').tags).toEqual({ button: 1 });
    expect(scan('const a = <button className="inline-flex size-8 rounded-md border" />;').pastedIconButtonLook).toBe(1);
    expect(scan('const a = <button className={`size-8 rounded-md ${x}`} />;').pastedIconButtonLook).toBe(1);
  });

  test('the scan ignores primitives with the same name, comments and strings', () => {
    expect(scan('const a = <Select label="x" />;').tags).toEqual({ Select: 1 });
    expect(scan('// <select> is banned\nconst a = "<input />";').tags).toEqual({});
    expect(scan('const a = <div className="size-8" />;').pastedIconButtonLook).toBe(0);
  });
});
