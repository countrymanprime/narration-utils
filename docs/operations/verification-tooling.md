# Verification and code-health tooling

What `pnpm check` and CI verify beyond "it lints and the example tests pass", how to run each check on its own, and how to add to it. How the jobs are wired is in [CI and releases](ci-and-releases.md); the reasons are in ADRs [0043](../adr/0043-coverage-is-a-ratchet-on-logic-directories-not-a-blanket-80-percent.md), [0044](../adr/0044-property-and-fuzz-tests-are-deterministic-in-the-gate.md), [0045](../adr/0045-dead-code-is-gated-at-zero-with-reasoned-ignores.md) and [0046](../adr/0046-architecture-rules-taken-from-adrs-are-lint-and-test-rules.md).

| Check | Runs in | Run it alone |
| --- | --- | --- |
| Formatting: ruff (Python, the only Python formatter), Prettier (UI), gofmt, StyLua | `lint` and `format` targets | `pnpm exec nx run <project>:lint` |
| Go lint: golangci-lint v2 (errcheck, staticcheck, govet, unused, gosec, depguard) | `narration-utils-shell:lint` | `pnpm exec nx run narration-utils-shell:lint` |
| Coverage ratchet on logic directories | the `test` targets of the projects with logic directories | `node scripts/ci/coverage-gate.mjs <go\|vitest\|pytest> <projectRoot>` |
| Property tests (Hypothesis, fast-check) and Go fuzz seed corpora | the same `test` targets | see below |
| Dead code: Knip | `narration-utils:knip` | `pnpm knip` |
| Import rules taken from ADRs: depguard, the script tracker's pytest | the Go lint and the teleprompter `test` target | with their targets |
| Playwright traces on a failing visual test | `ui-visual` | see [CI and releases](ci-and-releases.md) |

## Go lint

`apps/desktop/.golangci.yml` runs the `standard` set plus gosec and depguard and reports every finding (the defaults cap identical ones at three). The binary is pinned in `scripts/toolchain.json` and built with the repo's Go (`go install`, or `pnpm bootstrap`). Each exclusion in the file says why. A finding is fixed, or given a `//nolint:gosec // <reason>` comment. The two depguard rules are `no-network-outside-the-download-flow` and `analyzers-report-they-do-not-write` ([ADR 0046](../adr/0046-architecture-rules-taken-from-adrs-are-lint-and-test-rules.md)); to add a rule, copy one and name the ADR in its `desc`.

## Coverage ratchet

Only the logic directories in `scripts/ci/coverage-floors.json` are gated; components, host glue and sidecar-launch code are not. A floor is the rounded-down coverage when it was added and only goes up. To add a directory, add an entry at 80 or more (a lower floor needs a `reason`); to raise floors after adding tests, run the gate with `--update`. Details and the list of exempt code are in [CI and releases](ci-and-releases.md#coverage-ratchet).

## Property tests and fuzzing

Property tests run derandomized in the gate. To look for more bugs, run them randomized by hand:

```bash
# Python (Hypothesis): random seeds, 3000 examples per property
HYPOTHESIS_PROFILE=explore .venv/Scripts/python.exe -m pytest -q libs/python/tests sidecars

# UI (fast-check): random seeds, 5000 runs per property
VITE_FAST_CHECK_EXPLORE=1 pnpm --dir apps/ui exec vitest run src/components/manuscript src/components/primitives

# Go: coverage-guided fuzzing of one importer target (add -tags pdf_candidate for FuzzPdfDraft)
go -C apps/desktop test ./internal/importer -run='^$' -fuzz=FuzzAppendInline -fuzztime=60s
```

When a run fails it prints the counterexample (and a `@reproduce_failure` blob or a seed for the first two; Go writes `testdata/fuzz/<Target>/<hash>`). Turn it into a plain test in the same file (`@example(...)`, a named `it`/`Test...`, or keep the `testdata/fuzz` file), fix the code, and commit both. A new Hypothesis tests folder needs a `conftest.py` that calls `hypothesis_profiles.load()`, or its tests silently run randomized. When you write a property, check that its generator reaches the branches it claims to test (`hypothesis.event`, `--hypothesis-show-statistics`, or a reach assertion) and that mutating the code makes it fail; two properties in the first pass were vacuous until this was done.

## Dead code (Knip)

See [CI and releases](ci-and-releases.md#dead-code-check-knip). The short version: `pnpm knip` is at zero; delete the code or drop the `export`; add an ignore to `knip.jsonc` only with a reason.

## Not built, on purpose

Chromatic, MSW, Playwright component testing, mutation testing as a gate, the Storybook Vitest addon, Vale, `eslint-plugin-jsx-a11y`, Python type checking and crash reporting were considered and left out (reasons in the [PRD](../prds/verification-and-code-health-tooling.prd.md#what-were-not-building), which stays until its two remaining phases ship): UI architecture rules (dependency-cruiser, ESLint, the Base UI import guard) and Playwright aria snapshots wait for the Base UI primitives stack.
