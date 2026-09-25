# 0084. Repository links are checked offline on every pull request, and diagrams are parsed and drawn without a third party

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner

## Context and problem

[ADR 0028](0028-planned-work-is-specified-as-prds-and-deleted-when-built.md) deletes a PRD when its work is done, so a link into one dies by design, and `ci.yml` skips documentation-only pull requests (a required check that a path filter skips stays pending, see [CI and releases](../operations/ci-and-releases.md)), so a dead link could merge unseen. The docs site build ([ADR 0083](0083-the-public-docs-site-is-built-by-mkdocs-with-the-material-theme-straight-from-docs-and-a-reviewed-include-list.md)) checks only the pages it publishes. Nothing looked at the other 200 Markdown files, at a path in a code comment, or at a Mermaid diagram (GitHub and the site draw it in the reader's browser, so a typo shows as an error box only there). The docs security and hygiene PRD (stack S17) took the owner's recommendations for all of it.

Measured: lychee 0.24.2 in `--offline` mode reads the 227 tracked Markdown files and 1,356 links in 0.13 s, checks `#fragment` anchors offline (`include_fragments = "anchor-only"`), and found 0 dead repository links on the tree; the online run found 7 rotted external links (six were pull requests of the owner's private repositories, now ignored with the reason, one is the Pages site that the owner has not enabled). Mermaid's `parse` runs in Node without a browser once jsdom gives its sanitizer a DOM. Material for MkDocs loads Mermaid from `unpkg.com` when the page has no `mermaid` global, which would make every visitor of the public site ask a third party, and the site was built to ask none (system fonts, no repository widget).

## Decision drivers

- ADR-0028 deletes a PRD when its work is done, so a link into one dies by design.
- `ci.yml` skips documentation-only pull requests, so a dead link could merge unseen.
- The docs site build checks only the pages it publishes; nothing looked at the other Markdown files, at a path in a code comment, or at a Mermaid diagram.
- A Mermaid typo shows as an error box only in the reader's browser.
- The public site was built to ask no third party (system fonts, no repository widget).
- The docs security and hygiene PRD (stack S17) took the owner's recommendations.

## Considered options

1. An offline lychee link check on every pull request, Mermaid diagrams parsed in `pnpm check`, and a site that ships Mermaid itself
2. Keep the status quo: only the docs site build checks links, on the pages it publishes
3. Let Material for MkDocs load Mermaid from `unpkg.com`

## Decision outcome

**Chosen option: an offline lychee link check on every pull request, Mermaid diagrams parsed in `pnpm check`, and a site that ships Mermaid itself**, because links into deleted PRDs die by design and documentation-only pull requests skip `ci.yml`, and the public site was built to ask no third party.

1. **`docs.yml` runs `Links (offline)` on every pull request with no path filter,** and it fails on a dead repository link. A docs-only change gets a verdict, a code change that renames a linked file is caught, and the job is safe to require (owner decision D11: no ruleset requires a check today, so requiring it stays an owner-only setting). A weekly and manual `Links (online, advisory)` job follows the `http(s)` links, caches its answers for a day and never fails. Every ignore in `.lycheeignore` names its reason.
2. **A source file may not cite a PRD that is not in the tree** (`scripts/ci/prd-references.test.mjs`): lychee sees Markdown links, not a path in a Go, Python, Lua or YAML comment.
3. **Every mermaid block of a tracked Markdown file is parsed by Mermaid's own parser in `pnpm check`** (`scripts/ci/mermaid-diagrams.test.mjs`), and the five owning docs (the container view and the four flows) must keep their diagram. This proves the syntax, not that a picture is still true; each diagram names the files it was verified against and `feature-cleanup` asks for it to be updated with the code.
4. **The public site ships Mermaid itself:** `tools/docs-site/hooks.py` copies the browser bundle of the pinned `mermaid` package (a root devDependency) and its licence to `assets/vendor/`, and the build fails when it is missing.

### Consequences

- **Good:** A dead link, a deleted PRD that a comment still cites, and a malformed diagram each fail a named check with the file and line, on the pull request that causes it.
- **Neutral:** The link check needs lychee (a pinned action in CI, `cargo install lychee --locked` locally); the diagram check adds `mermaid` and `jsdom` as root devDependencies.
- **Neutral:** The online check is advisory on purpose: a link on someone else's server is not a regression in this repository.
- **Neutral:** Adding a link the checker cannot follow (a login page, a private repository) is an entry in `.lycheeignore` with a reason. Changing the job to be path-filtered, non-blocking or third-party dependent needs a new ADR that supersedes this one.

### Confirmation

`docs.yml` runs `Links (offline)` on every pull request and fails on a dead repository link; `scripts/ci/prd-references.test.mjs` fails on a source file that cites a missing PRD; `scripts/ci/mermaid-diagrams.test.mjs` parses every mermaid block in `pnpm check`; and the site build fails when the Mermaid bundle is missing.

## Pros and cons of the options

### Keep the status quo: links checked only by the docs site build

- Bad, because nothing looked at the other 200 Markdown files, at a path in a code comment, or at a Mermaid diagram, so a dead link could merge unseen.

### Load Mermaid from `unpkg.com`

- Bad, because it would make every visitor of the public site ask a third party.
