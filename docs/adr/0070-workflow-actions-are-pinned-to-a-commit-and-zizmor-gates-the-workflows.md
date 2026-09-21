# 0070. Workflow actions are pinned to a commit, and zizmor gates the workflows

**Status:** Accepted
**Date:** 2026-09-21
**Supersedes:**

## Context

A release here is an unsigned executable built and published by GitHub Actions, so everything the workflows run is part of the trust path. Before this change 34 of 38 external `uses:` references were mutable tags (`actions/checkout@v7`), no checkout set `persist-credentials: false` (the token stayed in `.git/config` for every later step), `promote-release.yml` held `contents: write` at workflow level, and nothing checked the workflows themselves. A moved action tag is a real attack: on 2026-03-19 76 of 77 tags of `aquasecurity/trivy-action` were force-pushed to credential-stealing code. The owner approved the hardening (owner decisions D7, D11, D14 and D22 of the implementation plan; the PRD `docs/prds/release-supply-chain-hardening.prd.md`, deleted when the work was done; recover it from git history; the steady state is [CI and releases](../operations/ci-and-releases.md#workflow-security)).

## Decision

1. **Every external `uses:` is a full 40-character commit SHA with a comment holding the full release tag** (`actions/checkout@3d3c42e5… # v7.0.1`). Local references (`./.github/actions/*`, `./.github/workflows/*`) stay as they are. `pinact` converts a tag once (`pinact run`, and `pinact run --verify --check` re-checks each SHA against its comment); Dependabot's `github-actions` entry keeps the pins current and rewrites the comment, with a 7-day cooldown.
2. **[zizmor](https://docs.zizmor.sh) is the gate, not a second pin checker.** `.github/workflows/zizmor.yml` runs on every pull request with no path filter, at the `regular` persona with online audits, the binary pinned to a version through the action's `version` input, and fails on a finding. Its `unpinned-uses` audit enforces decision 1; its `artipacked`, `excessive-permissions`, `template-injection`, `dangerous-triggers` and `dependabot-cooldown` audits enforce the rest. `.github/zizmor.yml` holds the only suppressions, each with a reason. A new action needs a reason, since it runs with the job's token.
3. **Least privilege.** Every workflow declares `permissions` at the top and a job raises it for itself only; every `actions/checkout` sets `persist-credentials: false`; `promote-release.yml` creates the stable tag through the API instead of `git push` so it needs no stored credential. `build-macos.yml` and `build-linux.yml` keep a workflow-level `contents: write` because a caller must grant what the reusable `_attach-platform.yml` job holds.
4. **Install-time settings are written down.** `pnpm-workspace.yaml` states `minimumReleaseAge` (3 days), `strictDepBuilds` and `blockExoticSubdeps`, and every Dependabot ecosystem has an explicit `cooldown` (7 days for npm and actions, 3 for uv and Go). pnpm applies the age check to frozen installs, so a lockfile entry younger than three days fails CI; a Dependabot security update in that window lists its `name@version` in `minimumReleaseAgeExclude`.

## Consequences

- A repointed action tag cannot change what a job runs; the cost is that an action update is a reviewed pull request (Dependabot opens it, a week after release).
- An unpinned line, a checkout that keeps its credential, or a workflow with no `permissions` fails the `zizmor` check with the line named. The check is a pull-request check but not a required one (no ruleset requires a status check, D11), so the maintainer reads it before merging.
- The owner-only setting "Require actions to be pinned to a full-length commit SHA" makes GitHub itself refuse an unpinned action; it is enabled after this lands and one Dependabot run has passed (listed in [GitHub workflow](../operations/github-workflow.md)).
- Changing any of this means a new ADR that supersedes this one.
