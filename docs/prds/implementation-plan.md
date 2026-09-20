# Implementation plan for all PRDs

**Status:** in execution. This file is transient: it is deleted in the PR that completes the last stack, like the PRDs it sequences ([ADR 0028](../adr/0028-planned-work-is-specified-as-prds-and-deleted-when-built.md)).

**Source:** owner instruction of 2026-09-20: turn every PRD into a phased plan, answer the open questions first, use a dev-team style review of the cross-PRD conflicts, deliver each PRD as stacked pull requests without pausing, open an ADR (Status: Proposed) for anything that needs the owner and keep going, and replace each PRD with steady-state documentation when its work is done.

It covers the 37 PRDs in this folder. It does not replace them: each PRD still holds its problem, evidence and phase detail. This plan holds what no single PRD can: the owner's answers to the open questions, the order the PRDs run in, and the rules every stack follows.

## 1. Owner decisions (2026-09-20)

These override the PRD text they contradict. The first pull request of each stack reconciles its PRD (ticks the answered questions, adds Decisions Log rows, corrects stale paragraphs) before any code.

| # | Decision | Effect |
| --- | --- | --- |
| D1 | UI library is **Base UI**, wrapped in our own Tailwind primitives so every control is styled one way. | [base-ui-primitive-foundation](base-ui-primitive-foundation.prd.md) is the spec. Radix text in [ui-primitives-and-headless-library](ui-primitives-and-headless-library.prd.md) is stale. `Switch` is needed (settings booleans) and moves up. |
| D2 | Pull the **Lua test harness** (Lua 5.4 in CI, fake `reaper` table) and a behavior-preserving **command registry** forward, before any new Lua command. | [reaper-automation-follow-through](reaper-automation-follow-through.prd.md) phases 3 and 4 are unconditional and first. "Lua has no tests, manual checklist is the merge gate" is stale in every PRD. Manual REAPER sign-off remains only for REAPER API semantics. |
| D3 | **All six REAPER spikes are approved** on `C:\Users\Count\Documents\REAPER Media\Projects\Challenges\Challenges_001.rpp`. **Never delete or modify anything in that folder**: work on copies in a temp directory with an isolated `-cfgfile`. S1, S3 and S4 need audio hardware and the owner present: mark them pending and continue. | Spikes S0, S5, S7 and the take-mechanics spike can run unattended. |
| D4 | Overlap owners: **dialog modality** belongs to the Base UI foundation (dialog PRD keeps the defect scope); **release-readiness Phase 1** owns the shared install-poll hook; the two teleprompter PRDs share one `MicrophoneField` seam. | Removes three duplicate builds. |
| D5 | **Palette text ramp is option B** (two text levels plus a 3:1 non-text token, retire `--text-faint` as text, triage about 73 usages). Highlight and badge text use the colour-mix option A. | [palette-contrast-wcag-aa](palette-contrast-wcag-aa.prd.md) Phase 2 grows from a token edit to a triage plus migration. |
| D6 | Info icons become real buttons; tooltips meet **WCAG 1.4.13 formally** (hoverable, persistent, Escape-dismissible). Tooltip delay stays 1000 ms (assumption, from L7). | Info-icon text lives in a Base UI Popover; hint tooltips stay Tooltips whose trigger carries the same text. |
| D7 | **First stable is Windows-only and unsigned.** macOS and Linux stay preview assets. Signing is the owner's call: no agent adds signing steps. | [release-readiness](release-readiness-provisioning-and-docs-site.prd.md) Phase 15 is deferred; RC notes say "unsigned". |
| D8 | OS **notifications are on by default** (unfocused, job of about 10 s or more). **Build Story Bible after import is on by default.** | Contradicts the briefs PRD B1 and its "opt-in" wording. Default-on makes host-side completion events ([interaction-feedback-audit](interaction-feedback-audit.prd.md) Phase 5) and the dialog PRD's Q4 (blocking build) load-bearing: reconcile them. |
| D9 | **Chapter stage recommendations stay unscheduled** on the roadmap. Still implemented, last. | No edits to `docs/roadmap.md`, the roadmap JSON or GitHub milestones from those five PRDs. Drop SR Q14 and any "propose a milestone" step. |
| D10 | The app may **auto-start the launcher script** when it launches REAPER, if the project-workspace Phase 6 spike proves it works. | Ship behind a Settings toggle; record in an ADR. |
| D11 | Repository rulesets vs docs: **the docs change to match the live settings** (code-owner review required, no required status checks). | The supply-chain PRD's `CI / gate` design and Q8, Q9 are moot; its Phase 6 becomes a docs edit plus an owner checklist. |
| D12 | Red **danger confirms**: Clear derived project data, Remove local preview voice, Remove local Whisper model, Delete entry, Merge & delete source, Replace and reset. | Dialog PRD Q8 answered. |
| D13 | Story Bible pronunciation **generate/replace lives in edit mode only**, blocked for locked entries. | [story-bible-entries-and-actions](story-bible-entries-and-actions.prd.md) B9. |
| D14 | **The version lives inside the app, not in asset file names.** The app knows its own version, checks GitHub releases and downloads and replaces itself. The program is renamed `narration-utils`. Asset names stay unversioned. | Drops [release-artifact-naming](release-artifact-naming.prd.md) Phase 2; keeps Phase 1. A **new PRD** (`in-app-update`) is written and delivered. Ambiguous wording: the reading is recorded in an open ADR for review. |
| D15 | **Repo layout runs first as one atomic PR** (retires `shared/`, `shell/` to `apps/desktop`, per-project Nx). A2-A8 take the PRD's recommendations: `apps/desktop`, keep the Go module path, top-level `sidecars/`, tests in `<project>/tests/`, Nx per project as a follow-up phase in the same stack. Local `.claude/skills` are untracked: update them locally after the move. | Every path in every other PRD changes; the layout stack ships a codemap. |
| D16 | Runtime validation at the data boundaries uses **Zod 4 behind `parseWire`**. | [boundary-schema-validation](boundary-schema-validation.prd.md) Q1 answered. Every new wire contract gets a schema; mocks must pass it. |
| D17 | **The project relicenses from MIT to AGPL-3.0-or-later**, so it stays free for narrators. Bundling GPL Piper, phonemizer and eSpeak NG is fine; there is no separate-asset split. Model and voice licences are still checked per artifact. | New stack `relicense`. [docs-security-and-hygiene](docs-security-and-hygiene.prd.md) Q12 collapses; Q13 and Q14 stay (add GPL/AGPL/LGPL to the allow-list). Any new dependency (Moonshine, an ID3 or MP3 library, Praat, Resemblyzer) needs an AGPL-compatibility check. |
| D18 | Coverage policy is a **ratchet on logic directories** with an 80% floor for any new logic directory; UI, glue and sidecar-launch code are exempt. A logged deviation from the global 80% rule. | Replaces every "at least 80% on new Go" gate. |
| D19 | The first **real audio corpus is the `Challenges_001` project's media plus synthetic generators**, read-only. | Analyzer thresholds are "validated" only for the conditions that corpus covers (probably one narrator and room); say so in evidence and ADRs. Escalate with an open ADR where it cannot support a claim (for example separating characters). |
| D20 | **Cadence: stacked phases per PRD, no pausing.** Each phase is a branch and a PR based on the previous one; the owner merges in order. | See section 3. Never merge, never enable auto-merge. |
| D21 | **When a PRD is done, replace it with steady-state documentation** (README lifecycle step 3). | The last PR of each stack writes the docs, ADRs and deletes the PRD. |
| D22 | Every open question not listed here **adopts the PRD's stated recommendation**. Anything that needs the owner and has no recommendation becomes an **open ADR** (Status: Proposed) and work continues on the recommended path. | The PR that creates an ADR lists it under "New ADRs for review". |

Owner-only actions no agent can take (collect them, do not block on them): the GitHub "Require actions pinned to a SHA" policy (supply-chain Q4), enabling GitHub Pages, immutable releases (deferred), code signing certificates and secrets, and merging.

## 2. Inputs only the owner can give

Nothing below blocks the train; each phase starts with the path that needs no input, and the gated phase is marked pending.

| Input | Where it matters | Default until given |
| --- | --- | --- |
| Exact toast text and entry for the TTS preview failure (T1, T2) | [story-bible-preview-tts-failures](story-bible-preview-tts-failures.prd.md) | Phase 1 diagnoses against every candidate cause on a dev build. |
| `vocabulary_candidates` contents and toast text (V1) | [proofing-vocabulary-hints](proofing-vocabulary-hints.prd.md) | Go always derives candidates from entities (V2 option a). |
| A real manuscript with a Word TOC field (S6); 3 or more manuscripts with wrong title/subtitle splits (I1) | import-structure Phase 4; briefs Phase 5 | TOC work uses a generated fixture; the subtitle override stays gated. |
| A real proofer pickup export (Pozotron or similar) | RF Phase 9 | Generic CSV only. |
| Owner present at the audio interface | RF spikes S1, S3, S4; teleprompter A/B (TE-8); TM punch (TM-12) | Marked pending. |
| Multi-character reference audio | character-continuity Phase 1 | Trial covers narration vs dialogue on the `Challenges_001` media only; open ADR if it cannot separate characters. |

## 3. Execution protocol (every stack)

1. **Order.** Stacks run in the order of section 4. Each stack's first PR is based on the tip of the previous stack; the very first is based on `main`. The owner merges in order, so a linear train has no sibling conflicts. Re-read `docs/adr/` and `hostAPIVersion` at the base tip: ADR numbers and API versions are allocated sequentially along the train.
2. **Issue first.** One tracking issue per PRD (`gh issue create`, Feature request or Bug report form conventions, `needs-triage`, `area:*` labels; see [github-workflow](../operations/github-workflow.md)). PRs say `Part of #<n>`, and only a stack's last PR says `Closes #<n>`.
3. **Reconcile the PRD first.** Phase 0 of a stack (docs only, may be folded into phase 1's PR) applies section 1 to the PRD: tick answered questions, add Decisions Log rows, fix stale paths and contradicted paragraphs. Do not silently rewrite scope.
4. **One PR per phase**, branch `<type>/<prd-slug>-p<N>-<slug>`, PR title a Conventional Commit, description = the phase's goal, what changed, verification evidence, and `Base: <previous branch>`. Set the phase's `Status` to `complete` in the PRD table in the same PR and link the plan. End commit messages and PR bodies with the attribution lines the harness gives.
5. **Plan, impact scan, TDD, gate, review** per [CLAUDE.md](../../CLAUDE.md): `change-impact-scan` before touching shared code, tests first, the full gate (`pnpm check`, not `check:fast`) plus the Playwright visual suite when the UI package changes, `design-spec-guard` for primitives and `styles.css`, the code-reviewer agent on the diff, `feature-cleanup` at the end. Look at the screenshots for visual fixes at every viewport.
6. **Lua.** After the harness lands, Lua changes need harness tests. Real-REAPER checks run scripted against a copy of `Challenges_001.rpp` in a temp directory with an isolated `-cfgfile`; anything needing hardware or the owner is recorded in the PR as pending, not skipped silently.
7. **ADRs.** A real decision gets an ADR through the `adr-author` skill after the code lands. If a decision needs the owner and cannot be settled from D1-D22, write the ADR with `Status: Proposed`, follow the recommended path, and add a **"New ADRs for review"** section to the PR body naming each one. Never edit an Accepted ADR: supersede it.
8. **Last PR of a stack** writes the steady-state docs (`docs/architecture/`, `docs/utilities/`, `docs/guides/`, ADRs), deletes the PRD, updates the README index and this plan's status table, and closes the issue. Delete a PRD only when every phase is `complete` or explicitly deferred with an issue filed.
9. **Blocked.** If a gate cannot go green after a real attempt, open the PR as a draft with the failure output, mark the row `blocked` here, and continue with any phase that does not depend on it. Never weaken a test, skip a gate or add an escape hatch (`sameAs`, `undriven`, ratchet entries) without a reason written in the PR.
10. **Serialization points** ([README](README.md#cross-prd-sequencing)) hold: `hostAPIVersion` bumps three files and regenerates `Host.{js,d.ts}`; new bindings use `h.services()` (delivered by S03); one nav item per PR; primitives before the features that use them.
11. **Honest reporting.** A phase is `complete` only when its acceptance evidence exists. Report failures, skips and pending manual steps in the PR.

## 4. The train

Order is dependency first, then value. `S` = stack. A stack is a PRD delivered as stacked PRs; "tail" phases wait on a later stack and run when it lands.

| Stack | PRD (phases) | Notes |
| --- | --- | --- |
| S00 | This plan and the decisions register | Docs only, based on `main`. |
| S01 | `relicense` (new, one PR) | AGPL-3.0-or-later: `LICENSE`, package metadata, README, CONTRIBUTING (DCO), notices note, ADR. Small and independent, so it goes before the big move. |
| S02 | repo-layout-by-role (1-5; delivered, see [ADR 0040](../adr/0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md)) | One atomic move PR (phases 1-3), then Nx per project, then steady state. `wails build` and the launcher must be checked. |
| S03 | host-binding-data-race (1-4; delivered, see [host-binding-concurrency](../architecture/host-binding-concurrency.md) and [ADR 0041](../adr/0041-host-bindings-read-project-services-through-one-snapshot-accessor.md)) | Accessor first; later PRDs build on it. |
| S04 | [story-bible-preview-tts-failures](story-bible-preview-tts-failures.prd.md) P1, [proofing-vocabulary-hints](proofing-vocabulary-hints.prd.md) P1 | The small correctness fixes the README wants before layout changes. |
| S05 | [verification-and-code-health-tooling](verification-and-code-health-tooling.prd.md) (1-8, 10, 11) | Coverage ratchet (D18) early so later stacks follow it. Phases 9 and 12 are tail phases after S10. |
| S06 | [release-supply-chain-hardening](release-supply-chain-hardening.prd.md) (1-5b, 6 as docs, 8) | Pins every workflow action: land alone. 7 and 9 deferred or Could. |
| S07 | [test-flakiness-and-visual-suite-stability](test-flakiness-and-visual-suite-stability.prd.md) (1-5) | 6 (axe) after the palette stack; 7 stays a deferred spike. |
| S08 | [boundary-schema-validation](boundary-schema-validation.prd.md) (1-7) | Zod 4; every later contract uses it. |
| S09 | [reaper-automation-follow-through](reaper-automation-follow-through.prd.md) part 1: phases 1-5 | Harness, registry, fan-out, S0 spike and the fixture pack the ledger, matcher and take PRDs need. |
| S10 | [base-ui-primitive-foundation](base-ui-primitive-foundation.prd.md) (1-6), then [ui-primitives-and-headless-library](ui-primitives-and-headless-library.prd.md) (1, 4, 5) | |
| S11 | [dialog-modality-and-workdialog-a11y](dialog-modality-and-workdialog-a11y.prd.md) (3-5), [component-a11y-meter-tooltip-field-heading-panel](component-a11y-meter-tooltip-field-heading-panel.prd.md) (1-4) | What remains after the foundation. |
| S12 | [palette-contrast-wcag-aa](palette-contrast-wcag-aa.prd.md) (1-6), [settings-mobile-layout](settings-mobile-layout.prd.md) (1-3) | Palette option B. Settings needs a boolean kind for D8. |
| S13 | tail: verification 9 and 12; test-flakiness 6 | After primitives and palette. |
| S14 | [interaction-feedback-audit](interaction-feedback-audit.prd.md) (1-7) | Host completion events before default-on build-after-import ships. |
| S15 | [release-artifact-naming](release-artifact-naming.prd.md) P1 plus version in the binary; new `in-app-update` PRD and its phases | D14. Open ADR for the trust model and update channel. |
| S16 | [release-readiness-provisioning-and-docs-site](release-readiness-provisioning-and-docs-site.prd.md) (1-14; 15 deferred; 16 owner) | Install job contract first; owns the install-poll hook (D4). |
| S17 | [docs-security-and-hygiene](docs-security-and-hygiene.prd.md) (1-11) | After the layout so diagrams name final paths. |
| S18 | [import-review-redesign](import-review-redesign.prd.md) (1-3) | Extracts the review body from `Home.tsx` before other `Home.tsx` PRDs. |
| S19 | [story-bible-entries-and-actions](story-bible-entries-and-actions.prd.md), [import-structure-toc-and-characters](import-structure-toc-and-characters.prd.md), [manuscript-reader-search-and-controls](manuscript-reader-search-and-controls.prd.md), [story-bible-and-import-ux-briefs](story-bible-and-import-ux-briefs.prd.md) | Properties schema (entries P1) before structure P3; reader P5 before structure P2. |
| S20 | [project-workspace-and-daw-link](project-workspace-and-daw-link.prd.md) (1-8), [audiobook-credits-templates](audiobook-credits-templates.prd.md) (1-5) | The spike (P6) decides D10. |
| S21 | [teleprompter-engines-and-input-devices](teleprompter-engines-and-input-devices.prd.md), [teleprompter-manuscript-integration](teleprompter-manuscript-integration.prd.md) | Shared `MicrophoneField`; final phase retires the standalone page alone. |
| S22 | [review-dashboard-and-findings-adoption](review-dashboard-and-findings-adoption.prd.md), [diagnostics-delivery-and-cleanup-tools](diagnostics-delivery-and-cleanup-tools.prd.md), rest of [reaper-automation-follow-through](reaper-automation-follow-through.prd.md) | Findings store first; one nav item per PR. |
| S23 | [analysis-evidence-ledger](analysis-evidence-ledger.prd.md) (EL), [take-review-pickups-duplicates-take-intelligence](take-review-pickups-duplicates-take-intelligence.prd.md), [character-continuity-review](character-continuity-review.prd.md) | EL parser superset before every other `parseItem` change. |
| S24 | [editing-readiness-analysis](editing-readiness-analysis.prd.md), [recording-coverage-analysis](recording-coverage-analysis.prd.md), [proofing-readiness-signals](proofing-readiness-signals.prd.md), [chapter-stage-recommendations](chapter-stage-recommendations.prd.md) | Unscheduled on the roadmap (D9). |

Critical chains the order respects (from the cross-PRD review): layout, then host accessor, then everything that adds a binding; harness then registry then any Lua command; spike fixture pack then EL parser superset then matcher, ledger, coverage, editing, proofing and stage signals; findings store then Review page then take review, continuity and analysis panels; Base UI foundation then every PRD that adds a dialog, popover, table or slide-over; `import-review-redesign` extraction then every other `Home.tsx` edit.

## 5. Status

Updated by the last PR of each stack. Values: `queued`, `in progress`, `pr open`, `blocked`, `deferred`.

| Stack | Status | PRs |
| --- | --- | --- |
| S00 | in progress | this PR |
| S02 | pr open | #55, #56, #57, #58 (issue #54) |
| S03 | pr open | #61, #62, #63, #64 (issue #59; follow-up #60) |
| S04 | partial | #67 (TTS preview P1), #68 (vocabulary hints P1); issues #65, #66. Delivered: [story-bible-preview-tts-failures](story-bible-preview-tts-failures.prd.md) Phase 1 and [proofing-vocabulary-hints](proofing-vocabulary-hints.prd.md) Phase 1. Remaining: TTS Phase 2 (install flow, folded into release-readiness Phase 1, stack S16) and Phase 3 (frozen piper data and the model-hash cache, also S16); vocabulary Phase 2 (the tag-input box, after the primitives stack S10). Open [ADR 0042](../adr/0042-proofing-suggestions-derive-from-current-entities-and-skip-auto-extracted-needs-review.md) awaits the owner. |
| S01, S05-S24 | queued | |
