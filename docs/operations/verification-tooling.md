# Verification and code-health tooling

What `pnpm check` and CI verify beyond "it lints and the example tests pass", how to run each check on its own, and how to add to it. How the jobs are wired is in [CI and releases](ci-and-releases.md); the reasons are in ADRs [0043](../adr/0043-coverage-is-a-ratchet-on-logic-directories-not-a-blanket-80-percent.md), [0044](../adr/0044-property-and-fuzz-tests-are-deterministic-in-the-gate.md), [0045](../adr/0045-dead-code-is-gated-at-zero-with-reasoned-ignores.md), [0046](../adr/0046-architecture-rules-taken-from-adrs-are-lint-and-test-rules.md) and [0062](../adr/0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md).

| Check | Runs in | Run it alone |
| --- | --- | --- |
| Formatting: ruff (Python, the only Python formatter), Prettier (UI), gofmt, StyLua | `lint` and `format` targets | `pnpm exec nx run <project>:lint` |
| Go lint: golangci-lint v2 (errcheck, staticcheck, govet, unused, gosec, depguard) and checklocks | `narration-utils-shell:lint` | `pnpm exec nx run narration-utils-shell:lint` |
| Go race detector, on the packages with concurrency | `narration-utils-shell:test:ci` (CI only; it needs cgo) | `CGO_ENABLED=1 go -C apps/desktop test -race ./...` |
| Coverage ratchet on logic directories | the `test` targets of the projects with logic directories | `node scripts/ci/coverage-gate.mjs <go\|vitest\|pytest> <projectRoot>` |
| Property tests (Hypothesis, fast-check) and Go fuzz seed corpora | the same `test` targets | see below |
| Dead code: Knip | `narration-utils:knip` | `pnpm knip` |
| Import rules taken from ADRs: depguard, the script tracker's pytest | the Go lint and the teleprompter `test` target | with their targets |
| UI import rules: dependency-cruiser (primitives are leaves, wailsjs only in `src/api`, Base UI only in primitives) and the `<mark>` scan | `narration-utils-ui:architecture`, and two Vitest files | `pnpm --dir apps/ui architecture` |
| Markdown links (lychee, offline) and PRD paths cited in source: see [the docs link check](ci-and-releases.md#the-docs-link-check) | `Docs / Links (offline)`; `repo-scripts:test-node` | `lychee --config .lychee.toml --offline .`; `node --test scripts/ci/prd-references.test.mjs` |
| Mermaid diagrams parse (Mermaid's own parser under jsdom, no browser) | `repo-scripts:test-node` | `node --test scripts/ci/mermaid-diagrams.test.mjs` |
| Playwright traces on a failing visual test (`trace: 'retain-on-failure'`, uploaded when a `ui-visual` step fails) | `ui-visual` | see [CI and releases](ci-and-releases.md) |
| Axe on every app state, with a declared, capped debt list | `ui-visual` (the visual suite) | `pnpm --dir apps/ui screenshots`, or `UI_AXE=1` to measure |
| Aria snapshots: the role trees of the dialogs, the slide-over and the navigation | `ui-visual`, after the screenshots | `pnpm --dir apps/ui run aria` |

## Go lint and the race detector

`apps/desktop/.golangci.yml` runs the `standard` set plus gosec and depguard and reports every finding (the defaults cap identical ones at three). The binary is pinned in `scripts/toolchain.json` and built with the repo's Go (`go install`, or `pnpm bootstrap`). Each exclusion in the file says why. A finding is fixed, or given a `//nolint:gosec // <reason>` comment. The two depguard rules are `no-network-outside-the-download-flow` and `analyzers-report-they-do-not-write` ([ADR 0046](../adr/0046-architecture-rules-taken-from-adrs-are-lint-and-test-rules.md)); to add a rule, copy one and name the ADR in its `desc`.

The lint target also runs gVisor's [checklocks](https://github.com/google/gvisor/tree/master/tools/checklocks) on the product code (`checklocks -test=false ./...`, about three seconds; pinned in `scripts/toolchain.json`). A field only touched under a lock says so with `// +checklocks:mu`, and a helper its caller holds the lock for says so with `// +checklocks:s.mu` (or `+checklocksread:s.mu` for a read lock); any access without the lock fails lint. A field checklocks sees used under a lock every time is reported until it is annotated, or given a trailing `// +checklocksignore: <reason>` when the lock is incidental (an atomic, read-only data). Declare one field per line in an annotated struct: checklocks pairs annotations with fields by position, so `a, b string` moves every later annotation onto the wrong field ([ADR 0171](../adr/0171-the-race-detector-runs-only-where-there-is-concurrency-and-checklocks-guards-the-locks.md)).

The race detector runs in CI only (`-race` needs cgo), and only on the packages it can find something in: `scripts/ci/coverage-gate.mjs` races every package whose source takes a lock, uses an atomic, starts a goroutine or makes a channel, or whose tests start goroutines, and runs the rest without it, printing which. `internal/measure` took 454 s under the detector and 4 s without it.

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

## UI import rules

`apps/ui/.dependency-cruiser.mjs` has three rules over `src` and `tests`, run by the `architecture` target (about 2 s): `primitives-are-leaves` (a file in `components/primitives/`, a story or test too, imports nothing else under `components/`), `wails-bindings-only-in-api` (only `src/api/` imports `wailsjs/`) and `base-ui-only-in-primitives` (a second guard behind `baseUiBoundary.test.ts`, [ADR 0047](../adr/0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md)). A failure names the rule and says what to do instead. To add a rule, add an entry to the file and a deliberate violation to `src/architectureRules.test.ts`, which writes each bad fixture and expects exactly that rule to fire. The `<mark>` rule of [ADR 0016](../adr/0016-highlight-primitive.md) needs syntax, not imports, so it is `src/highlightBoundary.test.ts` (a scan with an allowlist that carries a reason per entry and fails when an entry is stale); the tooling's config-protection hook refuses edits to `eslint.config.js`, so no lint rule was added. [ADR 0062](../adr/0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md) records the rules; `design-spec-guard` cites them and keeps only the judgement calls.

## Aria snapshots

`apps/ui/tests/aria/` compares role trees with `toMatchAriaSnapshot` ([ADR 0065](../adr/0065-aria-snapshots-pin-the-role-trees-of-the-dialogs-the-slide-over-and-the-navigation.md)), in a Playwright run of its own (`playwright.aria.config.ts`, the same mock build, about 9 s). It pins each modal from `<body>` (the page behind an open modal is `aria-hidden`, so `/children: equal` at the root pins the role, the name and that nothing else is in the tree; a canary test removes the hiding and expects the snapshot to stop matching), the navigation list in its three shapes, and the info icon and its tooltip. A snapshot is partial by default: what it lists must be there, in order, and extra nodes are fine.

```bash
pnpm --dir apps/ui run aria                       # run the aria suite
pnpm --dir apps/ui run aria --update-snapshots    # rewrite the files with the full tree, then trim them and read the diff
```

Snapshots live in `tests/aria/snapshots/*.aria.yml`, hand-trimmed and commented. Reach a new state with a driver in `tests/visual/app.drivers.ts` (the visual suite needs it anyway) and add a test to `tests/aria/dialogs.spec.ts`. A red run uploads the traces with the visual suite's (`test-results/aria`).

## Not built, on purpose

These were considered and left out; the reasons are current as of the work that delivered this tooling (`git log` for `docs/prds/verification-and-code-health-tooling.prd.md` recovers the full PRD).

- **Chromatic:** a SaaS visual service, redundant with the Playwright suite, and it cannot see the WebView2 host.
- **MSW:** the app talks to Wails bindings, not HTTP, and the mock API already covers tests.
- **Playwright component testing:** the experimental React packages were removed upstream; it would overlap the atlas.
- **Mutation testing as a gate:** Stryker's Vitest runner does not support Browser Mode and mutmut needs `fork` (WSL only on Windows). At most an occasional manual run on the parser modules.
- **Storybook Vitest addon:** only if atlas maintenance becomes a burden.
- **Vale** (prose lint) and **`eslint-plugin-jsx-a11y`:** the latter's peer range stops at ESLint 9 and this repository is on ESLint 10, and it overlaps axe.
- **Python type checking as a gate:** none for now; revisit `ty` as an advisory step when it reaches 1.0.
- **Crash reporting:** out by the privacy rule that analysis is local ([ADR 0032](../adr/0032-analyzers-report-findings-and-never-change-audio-or-manuscript-on-their-own.md)).
- **Pixel-baseline visual diffs:** a deferred spike ([#153](https://github.com/countrymanprime/narration-utils/issues/153)), started only after 50 consecutive stable `ui-visual` runs; baselines would come from a pinned Linux container and be stored outside the repository, and the result is an ADR either way.
- **An ESLint rule for the `<mark>` and Base UI import boundaries:** the tooling's config-protection hook refuses edits to `eslint.config.js`, so they are a Vitest scan and a dependency-cruiser rule with bad fixtures ([ADR 0062](../adr/0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md)); add the lint rule by hand if wanted (the selector is in `highlightBoundary.test.ts`).
