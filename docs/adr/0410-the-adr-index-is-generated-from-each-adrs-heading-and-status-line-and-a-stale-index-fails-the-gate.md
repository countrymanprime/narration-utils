# 0410. The ADR index is generated from each ADR's heading and Status line, and a stale index fails the gate

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:** none

## Context

The index table at the end of [`docs/adr/README.md`](README.md) was kept by hand. Every stream that wrote an ADR added a row to it, so parallel streams collided on the same lines, and the agent train had to name it a serial point ([agent train](../operations/agent-train.md), "Serial points": "The ADR index and PRD index rows: add-only"). By hand it also drifted from the ADRs it indexes.

When this ADR was written, 209 ADRs had 205 rows. Four ADRs (0183, 0253, 0260, 0261) had no row. Two titles differed from their headings. Forty-six Status cells differed from the ADR's own Status line:

- Some cells were stale, for example 0168 "Accepted" while its file says "Accepted (owner, 2026-09-23)".
- Most were hand-written summaries that added relationships recorded elsewhere in the ADR, in its `Supersedes` or `Amends` field.

The relationship fields are free prose, for example "none. It extends ADR 0143" or "the `table.dtable` exception of ADR 0009". Reading them mechanically would guess at meaning.

## Decision

`scripts/ci/adr-index.mjs` writes the table from the ADR files, between two HTML-comment markers in the README. It rewrites nothing outside the markers.

A row is:

- **Number:** the ADR's number, linking to its file.
- **Title:** the title from its `# NNNN. Title` heading.
- **Status:** its Status line as written. A Markdown link reads as its text, a `|` is escaped, and the first letter is capitalised, because the first ADRs write `- Status: accepted`.

The Status line is the one place a status is recorded, which the README's rule 2 already requires ("The old ADR's `Status` line becomes `Superseded by ADR-NNNN`"). A relationship the index should show goes in the ADR's Status line, not in the table.

`scripts/ci/adr-index.test.mjs` runs in `repo-scripts:test-node`, so `pnpm check` and `quality / quick-ubuntu` run it too. It fails when the committed table differs from the generated one and names the fix: `node scripts/ci/adr-index.mjs --write`. The script also refuses:

- an ADR whose heading number differs from its file number;
- an ADR with no heading;
- an ADR with no Status line.

## Consequences

- Writing an ADR no longer touches a shared row: regenerate and commit. Two streams that each add an ADR conflict only in the generated block, and running `--write` after merging `main` resolves the conflict.
- The index cannot miss an ADR or show a status the ADR does not have.
- The hand-written relationship notes in the Status column are gone where the ADR's own Status line does not state them, for example "(amends ADR-0009)" on 0017. They are still in each ADR's `Supersedes` and `Amends` fields. An ADR that wants the index to show a relationship states it in its Status line.
- A long Status line makes a long cell.
- To change what a row shows, change the rule in `scripts/ci/adr-index.mjs` and supersede this ADR.
