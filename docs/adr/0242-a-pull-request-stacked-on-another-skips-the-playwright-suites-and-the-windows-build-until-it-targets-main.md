# 0242. A pull request stacked on another skips the Playwright suites and the Windows build until it targets main

**Status:** Accepted
**Date:** 2026-09-25

## Context

The owner merges stacks of agent-authored pull requests, and every push to a stack (a merge of the parent into each child,
a rebase sweep) starts a full `CI` run on every pull request in it. On 2026-09-25 a five-deep stack (#531, #533, #537, #539,
#540) started 40 CI runs in under two hours: 22 were cancelled by a newer push, 18 finished red, none green, and the
finished ones took 19 minutes at the median and up to 33 under load. The repository is public on the free plan, with 20
concurrent hosted jobs for the whole account; one CI run took 13 of them, so two runs filled the cap and the rest queued
(jobs of run 36095186043 started up to 7.5 minutes after the run was created). See
[CI pipeline speed](../prds/ci-pipeline-speed.prd.md).

Most of that time goes to three jobs whose verdict a stacked pull request cannot use: `ui-visual` (7 m 43 s),
`ui-atlas` (6 m 33 s) and `Build (Windows)` (4 m 17 s on a Windows runner). Their result on a child is checked against
its parent's branch, not against `main`, and the child is tested again once the parent merges.

## Decision

1. In `.github/workflows/_quality.yml`, `ui-visual-shard`, `ui-visual` (through its `needs`) and `ui-atlas`, and in
   `.github/workflows/ci.yml`, `ui-dist` and `Build (Windows)` (through its `needs`), run only when the event is not a pull
   request or the pull request's base is the repository's default branch:
   `github.event_name != 'pull_request' || github.base_ref == github.event.repository.default_branch`. A stacked pull
   request still runs `js`, `quick`, `lua (windows-latest)` and `go`, scoped by Nx against its parent's branch.
2. `ci.yml` also listens for `pull_request` `edited`, and acts on it only when the base changed
   (`github.event.changes.base`): when the parent merges and GitHub retargets the child to `main`, that event runs every
   job, the skipped ones included. Any other edit (title, body) starts a run whose jobs all skip, in a concurrency group
   of its own (the run id is appended), so it never cancels the run in progress.

## Consequences

- A push to a stack of n pull requests occupies four runners per stacked child (`js`, `quick`, `lua (windows-latest)`, `go`) instead of the twelve a full run takes, and the
  bottom pull request, the one that merges next, no longer queues behind its children's Playwright and Windows jobs.
- A stacked pull request shows `ui-visual`, `ui-atlas`, `ui-dist / build` and `Build (Windows)` as skipped. A visual or
  packaging regression in a child is found when it targets `main`, one merge later than before; the same checks gate it
  then. No ruleset requires these checks (#544 tracks making them required); the owner decides whether a red or skipped
  pull request merges.
- If GitHub does not send `edited` for an automatic retarget (for example the parent's branch was not deleted on merge),
  the child's next push runs everything, since its base is `main` by then; a manual run (`workflow_dispatch`) does too.
- A title or body edit shows a CI run with every job skipped. It costs no runner.
- Undoing this means removing the conditions and the `edited` type, or superseding this ADR.
