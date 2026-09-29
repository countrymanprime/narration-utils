# The agent train

How parallel Claude Code sessions build the planned work around the clock: one **coordinator** and up to eight **workers**. The coordinator starts workers, scales their number to the usage left, merges green pull requests and fixes mechanical conflicts. Each worker delivers one stream of one to three PRD phases, one pull request per phase. This file is the coordinator's procedure. Its Routine prompt only says "read `docs/operations/agent-train.md` on `main` and run one pass", so changing the procedure is a normal pull request.

It replaces the scheduling rules of [the implementation plan's section 8](../prds/implementation-plan.md#8-the-lane-train-2026-09-24) (the lane train of 2026-09-24):

- **Kept:** D40 (the coordinator merges), D43 (the light merge gate), D44 (the visual suite and atlas run in full once, at the end) and D46 (the mockup check), plus the older D1–D39.
- **Replaced:** D41 (three lanes) and D45 (hold on credits), by [Lanes](#lanes) and [Usage and autoscaling](#usage-and-autoscaling) below.

The work it schedules comes from the [audiobook studio benchmark](../research/audiobook-studio-benchmark.md), and then the older PRDs' remaining phases as filler.

## Where state lives

| What | Where |
| --- | --- |
| The procedure (this file) | `docs/operations/agent-train.md` on `main` |
| What to build | The PRDs in `docs/prds/`: phase tables, `Depends`, and the Parallel-session compatibility tables |
| Live state: switches, target concurrency, lanes and their sessions, the log | Issue [#509, Train control](https://github.com/countrymanprime/narration-utils/issues/509). The coordinator rewrites its body |
| Steps only the owner can take | Issue [#510, Owner queue](https://github.com/countrymanprime/narration-utils/issues/510) |
| A paused stream's progress | Its draft PR's `## Resume notes` block |

State never lives in a file on `main`, so recording state can't cause merge conflicts.

## Switches on #509

Only the owner or the coordinator edits these.

| Switch | Default | Meaning |
| --- | --- | --- |
| `HOLD` | off | The owner's stop. Nothing launches; merges and fixes continue |
| `HOLD-UNTIL-RESET` | off | Set by the coordinator on RED. Cleared by the first tick where usage is not RED |
| `DRAIN` | off | Set by the coordinator on AMBER-7D or RED. Running workers pause at their next checkpoint (see [the worker protocol](#the-worker-protocol)). Lane K is exempt unless the band is RED |
| `MAX_WORKERS` | 8 | Hard ceiling on concurrent workers, the coordinator not counted |
| `MAX_OPUS_WORKERS` | 2 | Of those, how many may run Opus |
| `WARNING_POLICY` | `throttle` | What a weekly warning does: `throttle`, `hold` or `ignore`. The owner's cloud credit is used up (2026-09-26), so warnings count |
| `ALLOW_OVERAGE` | off | While off, a session that reports `isUsingOverage: true` is treated as RED |
| `TARGET` | 4 | Target concurrent workers, adjusted by the coordinator (below) |
| `WEEK_START_TARGET` | 4 | The `TARGET` the first tick after the weekly reset starts from |
| `WEEKLY_RESET` | from `resetsAt` | The next weekly reset. The coordinator fills it from the first `seven_day` `resetsAt` it sees; until then, 22:00 America/New_York (D45) |

## Usage and autoscaling

**Read usage.** `get_session` with no `session_id`, then read `external_metadata.rate_limit_info`: `{rateLimitType, status, resetsAt, isUsingOverage}`. This is account-wide, so the coordinator's own reading covers every worker. Map it to a band:

| Band | When | Launching | Running workers |
| --- | --- | --- | --- |
| **GREEN** | `status: allowed` | Up to `TARGET` | Continue |
| **AMBER-5H** | `allowed_warning` and `rateLimitType: five_hour` | None until `resetsAt` (the five-hour window), then GREEN again | Continue. They check at their next checkpoint |
| **AMBER-7D** | `allowed_warning` and `rateLimitType: seven_day`, with `WARNING_POLICY: throttle` | Only lane K and resumes of paused lane-K streams, at most 1, on Sonnet unless the phase is a contract | Tick `DRAIN`. The others finish their current PR and end |
| **RED** | `status: rejected`; or a worker ended on a usage limit; or `isUsingOverage` with `ALLOW_OVERAGE` off; or `WARNING_POLICY: hold` and any warning | None. Tick `HOLD-UNTIL-RESET` and `DRAIN` | Pause at their next checkpoint |

With `WARNING_POLICY: ignore`, warnings count as GREEN.

**Adjust `TARGET`.** Each tick, apply the first rule that fits, then log the change in one line:

1. **First tick after the weekly reset:**
   - set `TARGET` = `WEEK_START_TARGET`;
   - clear `DRAIN` and `HOLD-UNTIL-RESET` if the band is GREEN;
   - update `WEEKLY_RESET`.
2. **The first AMBER-7D of the week:**
   - Let `f` be the fraction of the week elapsed at that moment.
   - If `f < 0.85`, the train ran too fast: set `WEEK_START_TARGET = max(1, round(TARGET × f))`.
   - If `f ≥ 0.85`, the pace was right or too slow: set `WEEK_START_TARGET = min(MAX_WORKERS, WEEK_START_TARGET + 1)`.
   - Then set `TARGET = 1`.
3. **AMBER-5H:** `TARGET = max(2, TARGET − 1)`.
4. **GREEN with no warning in the last 4 hours, and ready work that filled every slot at the last tick:** `TARGET = min(MAX_WORKERS, TARGET + 1)`.

**The rationale:**
- The owner allows the whole weekly allowance to be used.
- The aim is to reach the weekly warning late in the week (`f` near 0.85–1.0), not to stall on day four.
- A five-hour warning means bursts were too tight.
- `TARGET` grows slowly while there's headroom and drops fast when a warning comes.

**Choosing which streams to run.** When fewer slots exist than ready streams, or when scaling down, keep them in this order:

1. lane K (the contracts every other stream waits on);
2. resumes of paused streams;
3. the stream whose PRD phases unblock the most other phases;
4. leaf features;
5. documentation;
6. filler from the older PRDs.

## Lanes

A lane is a territory of files. Two workers may share a lane only when the PRDs' Parallel-session tables show their phases touch disjoint files. D48 on #509 records the check: verify file by file before pairing.

| Lane | Owns | Model | ADR block |
| --- | --- | --- | --- |
| **K: contracts** | `apps/desktop/internal/port/**`, `internal/dawport/**`, the provider-port packages, `libs/python/narration_common/ports/**`, contract bindings and their schemas, goldens and mocks, `hostAPIVersion` bumps for contract bindings | Opus | 0300–0319 |
| **A: host features** | root `apps/desktop/*.go` feature bindings, `internal/<feature>` packages outside the ports | Sonnet (Opus for tricky concurrency) | 0320–0339 |
| **B: adapters and sidecars** | `integrations/reaper/**`, `internal/bridge`, `internal/daw*`, `internal/dawport/reaper`, `internal/dawport/audacity`, the consumer migrations, `sidecars/**`, the rest of `libs/python/**` | Sonnet (Opus for new Lua commands) | 0340–0359 |
| **U: primitives and input** | `apps/ui/src/components/primitives/**`, `apps/ui/src/input/**`, design tokens (in one PR, running alone) | Sonnet | 0360–0379 |
| **C: UI features** | `apps/ui/src/components/<feature>/**`, `hooks/**`, `tests/visual/**` rows of its pages, `docs/guides/using-the-app/**` | Sonnet | 0380–0399 |
| **D: documents** | PRDs, steady-state docs, ADR bookkeeping, PRD close-outs | Sonnet for PRDs, Haiku for bookkeeping | 0400–0409 |
| **X: exclusive** | Refactors of shared files (see [Serial points](#serial-points)) | Opus | 0410–0419 |

A lane-X stream runs with no other stream that touches the same files. A lane that runs out of numbers in its ADR block takes the next free block of ten above 0420 and records it on #509.

## Serial points

- **`hostAPIVersion`:**
  - It lives in `apps/desktop/app.go`, `app_test.go` and `apps/ui/src/hostApi.ts`, and the bindings `Host.*` are regenerated from it.
  - A PR that adds a binding takes `main`'s value + 1.
  - On a collision, whoever merges `main` in second takes the higher value + 1 and regenerates. Use the bump script once lane X has added it.
- **ADR numbers:** only inside the lane's block. Check `docs/adr/` at merge time, not only at write time; D52 on #509 records an earlier collision.
- **The ADR index and PRD index rows:** add-only. The coordinator resolves conflicts in them mechanically.
- **Append-only rows:** `config/defaults.json`, `internal/settings/store.go` field rows, `Settings.tsx` rows, `internal/bridge/wire.go` event rows.
- **One at a time, train-wide:**
  - the `AppShell.tsx` navigation or header;
  - `.github/workflows/**`;
  - the design token batch (`src/styles.css` token blocks and `paletteContrast.test.ts` `PAIRS`);
  - any lane-X refactor.
- **Hot UI files,** until lane X splits them: `api/mockApi.ts`, `wailsClient.ts`, `wireContracts.test.ts`, `tests/visual/state-catalog.ts`, `tests/visual/app.drivers.ts`, `interactionFeedback.catalog.ts`, `App.tsx`. Two streams may both touch one only when each adds rows in a separate place, and the coordinator merges `main` into the second before it merges.

## Mockup gates

Some PRDs gate a phase on **owner-approved mockups** in prose (its Phase Details or its Visual Spec section), not just in the `Depends` column. That gate never shows up in the phase table, so before adding a phase to the ready list, check its Phase Details paragraph and the PRD's Visual Spec section, not only `Depends`.

Since D68 and D69 (see [Owner standing rules](#owner-standing-rules)), an existing concept mock no longer gates a phase: build against it and add the Mockup check table. The rules below still apply when a phase has **no** mockup at all.

When a phase is otherwise ready (`Depends` complete, no file collision) but blocked solely on mockups that don't exist yet or haven't been approved (D61, owner-directed):

- **Don't launch it as a normal worker,** and don't guess at a design to route around the gate.
- **Launch a mockup-drafting session instead**, as its own lane entry, not a phase worker: `create_session` with `tags: ["agent-train", "mockup-design"]`, a model picked like any other lane (Opus for a screen with real interaction states — a recorder, conflict or error messaging, anything with more than static layout; Sonnet for a mostly-static screen), and a prompt that:
  - names the exact states the PRD's Phase Details and Visual Spec section describe;
  - points it at `docs/design/design-system.md` and the real tokens/primitives, never a generic style;
  - points it at the seven benchmark mocks in `docs/research/mockups/audiobook-studio-benchmark/` for tone and format precedent (no other mock exists, [D96](#which-mocks-are-the-spec));
  - says explicitly: **drafts only**, no product code for the gated phase, and the PRD's Visual Spec section is updated to list the new files as drafts pending the owner's approval — the session never marks its own work owner-approved;
  - tells it to open its own tracking issue and a normal PR, same as any worker, and never merge itself.
- **Record it on #509** as its own lane entry. It counts toward `TARGET` like any running session, but is tracked separately from the phase queue until the owner approves it.
- **Subscribe to its PR** (`subscribe_pr_activity`). The owner may leave review comments to iterate on the design directly with that session (or a follow-up fixer) before approving — treat that like any other reviewer round: implement the requested visual changes and push, rather than closing the PR out after one draft.
- The gated phase itself joins the normal ready list only once the owner approves the mockups (a comment or review saying so, or the PRD's Visual Spec section no longer reads "pending"). Approval is the owner's call, never the coordinator's.

## Which mocks are the spec

Owner ruling, 2026-09-29, after workers kept building towards old mocks.

- **The spec is one folder: `docs/research/mockups/audiobook-studio-benchmark/`,** the seven benchmark mocks (01 Production, 02 Script, 03 Booth, 04 Proof, 05 Master & QC, 06 Series voice bible, 07 companion). They are light except the Booth (03) and the companion (07). `apps/ui/tests/visual/mock-match/mocks.ts` lists them and the state each is scored against.
- **Every other mock is deleted (D96, 2026-09-29).** The per-PRD sets that lived under `docs/prds/mockups/` (`read-aloud-control-bar`, `edit-and-proof-workspace`, `delivery-platform-profiles`, `home-combined`, `manuscript-*` and the rest), the `*-concept.webp` copies of the benchmark mocks and the evidence crops in `docs/research/mock-fidelity/` and `visual-audit/` were drawn before the redesign, so they are gone, together with the visual mockup divergence audit and every link to them. Don't recreate them from `git log`: they are not a spec.
- **Only work being built now has a mock beside the benchmark.** The repo keeps three kinds of image: the seven benchmark mocks, the current-state screenshots in `docs/images/ui/`, and a new mock for a phase being built right now. A new mock goes in `docs/prds/mockups/<prd>/`, is listed in its PRD's Visual Spec, and is deleted in the PR that merges the work (the PRD's close-out PR checks this). A PRD never copies a benchmark mock; it links the research file.
- **Theme is one app-wide setting.** Capture a state in the theme its mock is drawn in and compare like with like: light against light, dark against dark. The dark equivalents of the light mocks are worked out later; until then a light mock is not compared with a dark capture.
- **Layout and style are the spec, not the sample data.** Don't seed demo data to make a score higher, and don't change a real title or subtitle to the mock's wording.
- **A mock that draws a page the app doesn't have yet** (06 is the Character Continuity review page, not the Story Bible) is unscored until its own PRD and mocks exist.

## UI PRs show their screenshots

Permanent owner rule, 2026-09-29. A PR that changes what `apps/ui` draws must show the change as images in its body. Without them the work has failed: the owner rejects the PR, and the coordinator neither merges it nor counts it ready. The owner has to see that it looks better and will not trust a number.

- **What to show.** A "Screenshots" section, one row per changed state at 1440×900: the benchmark mock | before (`main`) | after (the branch). Same state, viewport and fixture in the before and after captures, and the mock cropped or scaled to match. The match % for before and after sits beside each row; if the score fell, say so plainly.
- **Other viewports.** Small-desktop and tablet (and `reflow` at 390 px for Settings) as before/after pairs in a collapsed `<details>`.
- **Where the images live.** On a branch named `pr-images/<the PR's branch>`, never on the PR's own branch, so they don't reach `main`. Embed with `https://github.com/countrymanprime/narration-utils/blob/pr-images/<branch>/<file>.png?raw=true`. Regenerate them after every push that changes the UI.
- **How to capture.** `cd apps/ui && npx playwright test tests/visual/app.spec.ts -g "<page>.*<state>"` writes `apps/ui/screenshots/app/<page>/<state>/<viewport>.png` (gitignored). The mocks are in `docs/research/mockups/audiobook-studio-benchmark/`.
- **Who checks.** The worker adds them before it says the PR is ready. The coordinator checks the PR body for the images at every sweep, and does not merge a UI PR without them, whatever the score or the CI result.

## Owner standing rules

Decisions the owner made while the train ran (logged on #509). They bind the coordinator and every worker, and the worker template repeats the ones a worker needs.

| Rule | What it says |
| --- | --- |
| **D63** | `WARNING_POLICY: ignore`. A weekly warning counts as GREEN. On 2026-09-27 the owner restated it: ignore the weekly warning until the band is RED |
| **D64** | The coordinator resolves mechanical items itself (branch updates, index rows, status cells, bookkeeping) instead of queueing them for the owner |
| **D65** | Owner-only, hardware and REAPER checks are flagged on #510 and marked pending. They never block a merge or a launch |
| **D66** | Check the lane count on every pass, including passes spent mostly on merges or fixers, and launch before babysitting in-flight PRs |
| **D67** | Mock-first behind every port. A feature builds against a mock that passes the schema; going to production is a swap behind the port; the mocks stay for the demo build and the tests. A UI phase blocked only by an unbuilt backend phase is ready once that contract is pinned. Serial points, nav entries among them, still land one at a time |
| **D68** | A concept mock never blocks. Build against the PRD's recommended concept and pivot later if the owner asks. This settles the conflict between the wave-0 writer rule and D61 |
| **D69** | The audiobook studio benchmark's concept mocks are owner-approved as the build spec. **Dark mode is one app-wide theme,** on or off: no page or surface forces light or dark, and a dark mock shows the dark theme, not a per-page look. This supersedes ADR 0360 Q1's forced-dark booth surface |
| **D70** | Features still in development use public-domain or synthetic data instead of waiting for the owner's recordings. Results calibrated on it are **provisional**, and a re-run on the owner's own material goes on #510 as a QA item before it ships to users |
| **D71** | **LibriVox** is the default source for real speech audio: public domain, many readers, and solo readings where one reader voices several characters. Record the source URL, reader, book and the public-domain statement; keep the audio out of git as ignored local data. Synthetic audio is the fallback |
| **D72** | The privacy line is outbound user data, not inbound reference data. The app may call external APIs to **fetch** dictionary or pronunciation data (local first, online optional), but never sends the narrator's or authors' data out. An online lookup sends a single word, never passages, file names or project identifiers; it is narrator-initiated, or opt-in with a notice for a batch; results are cached locally; there is no telemetry and no project-run proxy. A service that needs a key uses the narrator's own key, stored locally and never logged |
| **D73** | A PR need not contain `main`'s tip to merge (supersedes that D40 condition, 2026-09-27). The merge is a squash, so GitHub refuses it when the PR no longer merges cleanly; then, and only then, the coordinator merges `main` into the PR (a fixer when the conflict isn't mechanical) and waits for its checks. The green run must still be on the PR's current head |
| **D74** | Windows only, for now (2026-09-27). Linux and macOS support is removed until the app is in a steadier state or someone uses those systems; `Build (Windows)` stays the build gate. Linux CI runners remain as hosts for platform-neutral checks (docs, the Lua harness, the browser-based UI suites), which is not Linux support |
| **D75** | The public GitHub Pages site (docs, Storybook, demo) is paused until the main app's development is done (2026-09-27): `pages.yml` no longer deploys on a push to `main`, and (narrowed 2026-09-27, [ADR 0415](../adr/0415-while-pages-is-paused-docs-are-checked-by-lychee-and-a-changed-file-markdownlint-not-by-building-the-site.md)) no longer runs on a pull request either. Workers keep the docs link-clean through `Docs / Links (offline)` (lychee, every pull request) and `Docs / Markdown lint (changed files)` (markdownlint-cli2 on the Markdown files a pull request adds or changes), not by building the site, and don't add work that only serves the published site |
| **D82** | Every worker owns its PRs until they merge or close (2026-09-27): it stays subscribed, and on a merge-conflict notice or a red check it merges `main` into its own branch (never rebase), fixes, re-runs its targeted checks and pushes. It keeps an hourly `send_later` check-in while a PR is open. The coordinator launches no cascade fixers; a one-PR fixer only for a PR whose own session is archived or failed. The coordinator archives the session once all its PRs are merged or closed (D78) |
| **D91** | The approved mocks win, measured (2026-09-28). Every screen or state an approved mock covers reaches **at least 90% pixel match** against it, captured at the mock's own size and theme with the app driven to the mock's state (the mock is one of [the seven benchmark mocks](#which-mocks-are-the-spec), never a per-PRD set; `pnpm --dir apps/ui mock-match`, [verification tooling](verification-tooling.md#mock-match)). New primitives, tokens and style changes are in scope, and "the existing style is close enough" is not a reason: a difference a primitive causes is fixed in the primitive, so every consumer inherits it, never restyled locally. A UI PR's Mockup check carries a match % column; a state under 90% needs a reason the owner accepts on #510, and a tooling limit is not one |

## The coordinator's pass

The Routine fires every 30 minutes (two hourly Routines, 30 minutes apart; D50). Each firing is one pass. Be brief and cheap: don't read the codebase, and don't run builds or tests yourself. Use the `mcp__github__*` tools for GitHub and `mcp__Claude_Code_Remote__*` for sessions (load them with ToolSearch). There is no `gh` CLI.

1. **Switches.**
   - Read #509.
   - If `HOLD` is ticked, run step 4 (merge) only, then end.
2. **Usage.** Read `rate_limit_info`, pick the band and adjust `TARGET` ([above](#usage-and-autoscaling)).
3. **Reconcile sessions.** For each session listed on #509, call `get_session` and read its `status_bucket`:
   - `working` or `blocked`: running. It counts toward `TARGET`.
   - `completed`, `review_ready`, or idle after commenting `<ID>: … green` on #509: done. Free its slot.
   - `failed`, with a usage or rate-limit reason (see `list_events`): paused. Set RED. The stream goes on the resume list.
   - `failed` for any other reason: blocked. Read its last events, note the cause on #509, and queue a fixer if the PR exists.
   - The worker commented `<ID>: PAUSED at <step>` or `<ID>: yielded after pN`: paused or yielded. Put it on the resume list, or queue its next phase.
4. **Merge (D40).** Take bottom PRs (base `main`), oldest first. Merge one only when all of these hold:
   - it is not a draft;
   - it merges cleanly into `main` (D73: it need not contain `main`'s tip). If GitHub reports a conflict, merge `main` into it with `update_pull_request_branch`, or start a fixer when that fails, and wait for its checks on the next pass;
   - `Build (Windows)` and `ui-dist` succeeded on the head. A docs-only PR needs `Docs / Links (offline)` instead;
   - there is no `CHANGES_REQUESTED` review and no unresolved thread whose first comment starts with 🔴;
   - a Claude Approvals check, if present, passes;
   - a UI PR whose phase has mockups carries its Mockup check table with a match % column (D46, D91).

   Merge with `squash` and `expectedHeadSha`, then delete the branch. Don't update the other bottom PRs' branches after a merge (D73); only a PR that no longer merges cleanly gets `main` merged in.
   - **A conflict:** start one **fixer**. Use Sonnet for mechanical files (`hostAPIVersion`, ADR or PRD index rows, status cells, regenerated `Host.*`) and Opus otherwise.
   - **A merge turns `main` red:** tick `HOLD`, start an Opus fixer aimed at `main`, and log it.
   - **A merge just unblocked other phases (D62, owner-directed):** don't wait for the next scheduled Routine firing to act on it. The moment a merge lands, re-check every PRD whose `Depends` named the phase that just completed, and if step 5 below would now add something to the ready list, run step 5 immediately, in the same pass. A phase sitting ready while nothing launches until the next tick is exactly the latency this rule removes.
5. **Launch.** Skip this step on `HOLD`, `HOLD-UNTIL-RESET`, AMBER-5H before its `resetsAt`, or when running ≥ `TARGET`.
   1. **Build the ready list.** A PRD phase is ready when:
      - its `Status` is `pending`;
      - every phase in its `Depends` is `complete` on `main`;
      - its Phase Details paragraph and the PRD's Visual Spec section carry no unmet owner-approval gate (see [Mockup gates](#mockup-gates) — if one exists and isn't met, the phase isn't ready, but its mockup drafting is its own lane entry);
      - its Parallel-session row collides with no running stream's files;
      - its PRD is in the [queue](#queue) at or above the current wave.
   2. **Group phases into streams** of 1–3 consecutive phases of one PRD in one lane. Phases that each need their own worker (marked parallel in the PRD) become separate streams.
   3. **Launch in priority order** until running = `TARGET`. Keep Opus workers ≤ `MAX_OPUS_WORKERS`. Use `create_session` with:
      - `source_url` `https://github.com/countrymanprime/narration-utils`;
      - `permission_mode` `"auto"`;
      - a model from the lane table: Sonnet by default, Opus only for lane K, lane X, new Lua commands and semantic fixers, Haiku for bookkeeping;
      - `title` `"<ID> <scope>"` and `tags` `["agent-train", "lane-<L>"]`;
      - the [worker template](#worker-template) as the prompt. Use the resume template for a paused stream.
   4. **Record each launch on #509:** ID, lane, session id, PRD phases and model.
6. **Housekeeping.**
   - Rewrite #509's body only when something changed, with one log line per event: started, merged, paused, resumed, blocked, band change, `TARGET` change.
   - On the first pass after 09:00 America/New_York, post one short comment on #509: merged, in flight, paused, blocked, band, `TARGET`.
   - End every comment with a blank line, `---`, then `_Generated by [Claude Code](https://claude.ai/code)_`.

**IDs** are `N-<lane><n>`, for example `N-K1` or `N-B5a`. The `N-` prefix keeps them apart from the 2026-09-24 train's IDs in #509's history.

## The worker protocol

A worker is one cloud session for one stream. It opens one PR per phase, stacked on the previous one, and never merges.

- **Commit and push after every green step,** not just at the end. A session that dies on a usage limit loses only the work since its last push.
- **Checkpoints:** before each phase, and before any expensive step (the visual states of a page, a full Go race run, the atlas). At each checkpoint:
  1. Read #509's switches, and call `get_session` for your own `rate_limit_info` if the tool is available.
  2. On `HOLD`, `HOLD-UNTIL-RESET`, or RED in your own reading, or `DRAIN` unless you are lane K and the band is not RED: **pause.**
     - Commit your work in progress as `chore(<scope>): wip, paused at <step>` and push.
     - Open or update the phase's PR as a **draft** with a `## Resume notes` block:
       - Stream `<ID>`, PRD and phase
       - Done: the steps finished, with commit SHAs
       - Next: the exact next step
       - Failing: any failing check, with its output
       - Checks run: the local checks already passed
     - Comment `<ID>: PAUSED at <step>, PR #<n>` on #509, then end the session.
  3. On AMBER in your own reading (`allowed_warning`), **unless #509's `WARNING_POLICY` is `ignore`** (then a warning counts as GREEN, D63): **yield.** Finish the current PR to green, don't start the next phase, comment `<ID>: yielded after p<N>` on #509, and end.
  4. Otherwise, continue.
- **Finishing:**
  - Subscribe to your PRs, and drive `Build (Windows)` and `ui-dist` to green.
  - Answer every red-circle thread.
  - Comment `<ID>: PRs #… green` on #509, then end the turn, **staying subscribed** (D82).
  - **Until each PR merges or closes, you own it (D82).** On a merge-conflict notice, a red check or a review comment: merge `main` into your branch (never rebase or force-push), resolve keeping both sides' intent (the rules in the fixer template), re-run your targeted checks, push, and end the turn again. Schedule a `send_later` check-in about an hour out whenever a PR is still open, and re-check merge state and CI when it fires. Stop once every PR is merged or closed.
  - After three failed CI rounds on one PR: mark it draft, paste the failure into it, comment on #509, and end.
- **No resume-in-place:** there is no tool to send a follow-up task into a session that has already finished and gone idle. A stream's next PRD phase (D62) is always a **new** session, branched fresh off the current `main` tip — never a message into the old one. The gain from D62 is launching that new session the moment the phase is ready, not batching it to the next tick; it is not session reuse.
- **Owner steps:** anything needing the owner, REAPER, audio hardware or owner input goes on #510 as a comment and is marked pending in the PR. Never wait for a human.
- **Tooling:** the repo's `SessionStart` hook (`scripts/cloud/session-start.sh`, registered in `.claude/settings.json`) installs the pinned toolchain. `.claude/settings.json` allows the build, test and git commands and denies force-pushes and rebases. Workers never edit `.claude/settings.json`; auto mode refuses that as self-modification, so any change to it goes on #510 for the owner.

## Templates

### Worker template

Fill in the `<>` fields.

```text
You are worker stream <ID> (lane <L>: <lane name>) in the narration-utils agent train. Repo countrymanprime/narration-utils.
No human is watching live; never wait for answers. Where a PRD leaves a question open, take its stated recommendation
(implementation plan D22) and record anything that truly needs the owner as a Proposed ADR, plus a comment on #510.

READ FIRST: CLAUDE.md; docs/operations/agent-train.md ("The worker protocol", "Serial points", "Lanes"); then each PRD in
scope, in full.
SCOPE: <PRD path> phases <N…>: <one line each>.
MOCKUPS (D46, D91): <per phase: exact docs/research/mockups/audiobook-studio-benchmark/... files, or "none">. Open each before
coding and build to match. Older per-PRD mocks are deleted (D96); see "Which mocks are the spec". Compare light to light and dark to dark by the theme the mock is
drawn in. Layout and style are the spec, never the mock's sample data.
Every approved-mock state reaches at least 90% pixel match: drive the app to the mock's state and data, capture at the
mock's own size and theme, and score it (the mock and its target state in apps/ui/tests/visual/mock-match/mocks.ts, then
`pnpm --dir apps/ui mock-match -g "<mock file>"`). The PR's "Mockup check" table is mockup | capture | match % |
remaining differences; a state under 90% needs a reason the owner can accept on #510 (live data the mock can't have),
and a tooling limit is not one. New primitives and tokens are in scope; existing styles are not a reason: when a
primitive, token or style doesn't draw what the mock shows, change the primitive (its <Name>.stories.tsx too, with
design-spec-guard and an ADR for a changed design decision), don't restyle it locally on the page. The spec per
primitive is docs/design/design-system.md (the PRD it came from was deleted at its close-out).
YOUR FILES: <the phases' rows from the PRD's Parallel-session table>. NEVER TOUCH: files owned by other lanes or listed for
a running stream on #509. If you need another lane's change, comment on #509.
ADR BLOCK: <block>. Check docs/adr/ for the next free number inside it, at write time and again before your last push.
BRANCHES AND PRS: first PR based on the latest main; one PR per phase, each based on the previous branch; branch
<type>/<prd-slug>-p<N>-<slug>; PR title a Conventional Commit; body = goal, what changed, local checks run with results,
Mockup check (UI with mockups), Screenshots (any UI change; see "UI PRs show their screenshots": the PR is not ready without them), "Base: <branch>", "Part of #<PRD issue>" (find it or create it per
docs/operations/github-workflow.md; the PRD's last phase says "Closes #<n>"), "New ADRs for review". Set each phase's
Status cell in its own PR. The PR delivering a PRD's last phase writes the steady-state docs and deletes the PRD.
METHOD: impact scan before touching shared code (list every consumer of what you change and its tests); tests first;
SOLID: depend on the ports (internal/dawport roles, provider ports, NarrationApi), never on concrete adapters.
TESTING (D43, D44): targeted checks only: Go tests of changed packages plus go vet, the Lua harness for Lua, Vitest of
changed UI, pytest of changed sidecars, lint and typecheck of touched projects, and the visual states of pages you
changed (cd apps/ui && npx playwright test tests/visual/app.spec.ts -g "<page>.*<state>"), looking at every viewport's
PNG. Not the full pnpm check, the full visual suite or the atlas (a primitive's own atlas story is fine), and never
regenerate docs/images/ui or docs/ui.
WIRE CONTRACTS: a new binding or event gets a Zod schema, a golden (UPDATE_CONTRACTS=1), a wireContracts row and a mock
that passes it, plus a hostAPIVersion bump to main + 1. New REAPER commands: harness tests first, wire.go row,
threat-model and SECURITY.md rows, declared as Experimental capabilities.
OWNER RULES ("Owner standing rules" in this file): D67 mock-first behind every port; D69 one app-wide theme, never force
light or dark on a page; D70/D71 development audio from LibriVox (provenance recorded, audio kept out of git) or
synthetic, results provisional; D72 fetch reference data freely, but never send the narrator's or authors' data out.
USAGE: follow "The worker protocol" exactly: push after every green step, check #509 and your rate_limit_info at every
checkpoint, pause or yield as it says.
FINISH: subscribe to your PRs; drive Build (Windows) and ui-dist green; answer every red-circle thread; comment
"<ID>: PRs #… green" on #509; end the turn but stay subscribed. D82: you own your PRs until they merge or close: on a
merge conflict or red check, merge main into your branch (never rebase), fix, re-check, push; keep an hourly send_later
check-in while any PR is open. NEVER merge. End every GitHub comment with a blank line, "---", then
"_Generated by [Claude Code](https://claude.ai/code)_".
```

### Resume template

The worker template, with this paragraph first:

```text
RESUME: stream <ID> was paused. Its work is on branch <branch>, draft PR #<n>. Read the PR's "## Resume notes" and its
diff, check out the branch, merge main into it (never rebase), re-run the checks listed there, then continue from "Next".
Mark the PR ready for review when its phase is done.
```

### Fixer template

```text
You are a fixer in the narration-utils agent train. PR #<n> (branch <b>) <has a merge conflict with main | fails <check> |
turned main red>. Merge main into the branch (never rebase or force-push). Resolve keeping both sides' intent: for
hostAPIVersion take the higher value + 1 and regenerate Host.*; for ADR or PRD index rows keep both rows; for an ADR number
clash renumber the later one inside its lane's block and fix its links. Run targeted checks for the touched areas, push,
confirm Build (Windows) and ui-dist go green, comment on #509 with what you did, then end. Don't merge. End every GitHub
comment with a blank line, "---", then "_Generated by [Claude Code](https://claude.ai/code)_".
```

## Queue

Waves order the work, and the coordinator doesn't start a wave until everything it depends on has merged. Inside a wave, the ready-list rules above decide.

| Wave | Streams |
| --- | --- |
| **0** | See the table below |
| **1: contracts** | DAW port (PRD deleted, delivered) P1–P4 in lane K, one after another: N-K1 = P1 + P2, N-K2 = P3 + P4. [Provider ports](../architecture/provider-ports.md) phases after N-K1 (lane K, then B). Studio UI primitives (PRD deleted, delivered) token batch (alone), then `CapabilityGate` (lane U). [Input commands and pedals](../prds/input-commands-and-pedals.prd.md) registry core (lane U) |
| **2: fan out** | DAW port P5a–P5d at the same time (lane B, four workers); the remaining primitives, file-disjoint (lane U, two workers); provider-port migrations (lane B); input sources and migrations (lane U); DAW port P6 and P7 |
| **3: features** | The wave-0 PRDs, in benchmark order: booth actions enablement, booth mode and companion panel, closed-loop proofing, delivery profiles (extended), production tracking |
| **4** | Prep depth, series voice bible, render, encode and master, native recording on the DAW port, Audacity 4. Then the final sweep (D43, D44, D46): the full `pnpm check`, visual suite, atlas, aria, a mockup pass, doc screenshots regenerated once |
| **Filler** | Any lane with a free slot and nothing ready takes the next pending phase of the older PRDs in `docs/prds/`, if it collides with nothing running. The old queue's order (implementation plan §8) sets priority |

**Wave 0.** These streams can run together, since their files are disjoint.

| ID | Lane | Model | Scope |
| --- | --- | --- | --- |
| N-D1 | D | Sonnet | Write PRDs from the benchmark's recommendations 1–3: **booth-actions-enablement** (reconciles read-aloud control bar P7, REAPER automation follow-through and the teleprompter integration's punch phases; promotes each verified command by declaration on the DAW port), **booth-mode-and-companion-panel**, **closed-loop-proofing** |
| N-D2 | D | Sonnet | Write **production-tracking**, **prep-depth** and **render-encode-master**. Extend **delivery-platform-profiles** (recommendation 4: MP3 levels, delivery findings on the Review page, a book-wide spread), **character-continuity-review** (recommendation 8: a series bible) and **audacity-integration** (recommendation 9: re-scope for 4.x) |
| N-X1 | X | Opus | Conflict-reduction refactor with no behaviour change: split `api/mockApi.ts`, the golden-to-schema rows of `wireContracts.test.ts`, `tests/visual/state-catalog.ts` and `app.drivers.ts`, and `interactionFeedback.catalog.ts` into per-domain or per-page files; generate the ADR index table in `docs/adr/README.md` from the ADR files, with a check in `pnpm check`; add `scripts/dev/bump-host-api.mjs` (bump the three files, regenerate `Host.*`) |
| N-K1 | K | Opus | DAW port P1 + P2. New packages only, so it can start in wave 0 |

**Rules for the wave-0 PRD writers (N-D1, N-D2):**
- Use the template in `docs/prds/README.md`.
- Add a **Ports used** column to the phase table, naming the capabilities and roles of the DAW port, the provider ports and the UI primitives each phase needs. That column is how the coordinator knows when a phase is unblocked.
- Link the benchmark mocks the PRD uses from `docs/research/mockups/audiobook-studio-benchmark/`; don't copy them into the PRD (D96). A PRD that needs a mock the benchmark lacks adds it under `docs/prds/mockups/<prd>/` only for work being built now, and it is deleted when that work merges.
- Give every open question a recommendation.
