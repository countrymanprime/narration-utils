// Finds source files that cite a PRD (`docs/prds/<name>.md`) which is not in the tree.
//
// ADR 0028 deletes a PRD when its work is delivered, so a comment that points at one goes dead by design. The Markdown link
// check (lychee, .github/workflows/docs.yml) sees only Markdown links, not a path in a Go, Python, Lua or YAML comment, so
// this covers those. Markdown is left to lychee, the ADRs are immutable records, and the docs-site tests name made-up PRDs.

const PRD_PATH = /(?<![\w./-])docs\/prds\/[\w.-]+\.md\b/g;
const NOT_SOURCE = [/\.md$/, /^docs\//, /^tools\/docs-site\/tests\//];

export function isSourceFile(file) {
  return !NOT_SOURCE.some((pattern) => pattern.test(file));
}

/** @param {Map<string, string>} filesByPath  @param {(path: string) => boolean} exists */
export function findMissingPrdReferences(filesByPath, exists) {
  const missing = [];
  for (const [file, text] of filesByPath) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      for (const [reference] of line.matchAll(PRD_PATH)) {
        if (!exists(reference)) missing.push({ file, line: index + 1, reference });
      }
    });
  }
  return missing;
}
