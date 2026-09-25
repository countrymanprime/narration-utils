# 0029. Work is tracked on GitHub, generated from files in the repo, and decisions and docs stay in the repo

- **Status:** Accepted
- **Date:** 2026-09-19

## Context and problem

The repository had planned work in docs, a roadmap in `shared/config/roadmap.json`, and no issue tracking beyond what happened to be in pull requests. GitHub offers three places that could each grow a second copy of that information: labels and milestones edited by hand in the UI, a wiki, and a project board with its own custom fields. Each drifts from the files that change with the code. The repository has a solo maintainer (`.github/CODEOWNERS`), so anything that needs hand upkeep in two places will not be kept in both. Issue forms, labels as code and PR area labelling landed in #37 and milestone sync in #38; `docs/operations/github-workflow.md` (#39, extended in #40) describes the result.

## Decision drivers

- Any second copy of planning information drifts from the files that change with the code.
- The repository has a solo maintainer, so anything that needs hand upkeep in two places will not be kept in both.
- A long-lived personal token is a secret this repository does not want.

## Considered options

1. GitHub Issues, labels, milestones and one board, with labels and milestones generated from repo files, and decisions and docs kept in the repo
2. Labels and milestones edited by hand in the GitHub UI
3. A wiki
4. A project board with its own custom fields
5. Token-based automation for the project board

## Decision outcome

**Chosen option: GitHub Issues, labels, milestones and one board, with labels and milestones generated from repo files, and decisions and docs kept in the repo**, because hand-edited labels and milestones, a wiki, and custom board fields would each grow a second copy that drifts, and a solo maintainer will not keep two copies in step.

1. Work in flight is tracked as GitHub Issues, labels, milestones and one project board, **Narration Utils**. Issues come from two forms, `.github/ISSUE_TEMPLATE/bug_report.yml` and `feature_request.yml`; blank issues are off (`.github/ISSUE_TEMPLATE/config.yml`) and new issues carry `needs-triage`.
2. Labels and milestones are generated from files. `.github/labels.json` is the label set, applied by `scripts/github/sync-labels.mjs`. `shared/config/roadmap.json` is the milestone list, applied by `scripts/github/sync-milestones.mjs` as milestones titled `<number>. <title>`, matched by that leading number. Both run from `.github/workflows/sync-labels.yml` and `sync-milestones.yml` on a push to `main` that changes their inputs, and both are dry runs unless given `--apply`. They never touch a label or milestone the files do not list, and never change a milestone's open or closed state. Nobody edits a listed label or milestone by hand in the UI: the next sync reverts it.
3. `area:*` labels on pull requests come from paths in `.github/labeler.yml`, applied by `.github/workflows/labeler.yml`. A test (`scripts/github/sync-labels.test.mjs`) fails if the labeler assigns a label that `labels.json` lacks.
4. The repository remains the source of truth for decisions and documentation. ADRs and `docs/` are linked from issues and pull requests, never copied into them. The **wiki is disabled** on purpose, because an unreviewed second copy drifts from the docs that change with the code.
5. The project board has no custom fields. It uses the built-in Status, Milestone and Labels, and filters by label for area. Its views and built-in workflows are set up once by hand in the GitHub UI, and the board uses no token-based automation, because `GITHUB_TOKEN` cannot reach a user-owned project and a long-lived personal token is a secret this repository does not want.

### Consequences

- **Neutral:** The roadmap has one source: editing `roadmap.json` updates the in-app roadmap and, on merge, the GitHub milestones. The prose copy in `docs/roadmap.md` is still edited by hand alongside it.
- **Neutral:** Changing a label or milestone is a pull request, which is slower than clicking in the UI but reviewable and revertible.
- **Bad:** The board is the one piece that cannot be reproduced from the repository. Its views and workflows are not in code, an API cannot create them, and nothing here verifies them; a lost board is rebuilt by following `docs/operations/github-workflow.md`.
- **Bad:** Several repository settings live outside the repo and cannot be enforced by a pull request: wiki off, squash-only merges, the `Main Protection` ruleset, and the security features. They are listed in the same doc so drift is at least visible. The wiki being off and the four milestones existing were confirmed against the live repository when this ADR was drafted.
- **Neutral:** Milestone numbers are the join key. Renumbering a roadmap entry would create a new milestone rather than rename one.
- **Neutral:** The wiki and custom project fields could be reintroduced only through a new ADR that supersedes this one.

### Confirmation

Point 2: the sync workflows revert any hand edit to a listed label or milestone on the next push to `main` that changes their inputs. Point 3: `scripts/github/sync-labels.test.mjs` fails if the labeler assigns a label that `labels.json` lacks. The wiki being off and the four milestones existing were confirmed against the live repository when this ADR was drafted; the board's views and workflows are not verified by anything in the repository.

## Pros and cons of the options

### Labels and milestones edited by hand in the GitHub UI

- Good, because clicking in the UI is faster than a pull request.
- Bad, because it grows a second copy that drifts from the files that change with the code.

### A wiki

- Bad, because an unreviewed second copy drifts from the docs that change with the code.

### A project board with its own custom fields

- Bad, because it grows a second copy that drifts from the files that change with the code.

### Token-based automation for the project board

- Bad, because `GITHUB_TOKEN` cannot reach a user-owned project, and a long-lived personal token is a secret this repository does not want.
