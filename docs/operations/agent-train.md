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
   - its head contains `main`'s tip; otherwise call `update_pull_request_branch` (a merge commit) and wait for the next pass;
   - `Build (Windows)` and `ui-dist` succeeded on the head. A docs-only PR needs `Docs / Links (offline)` instead;
   - there is no `CHANGES_REQUESTED` review and no unresolved thread whose first comment starts with 🔴;
   - a Claude Approvals check, if present, passes;
   - a UI PR whose phase has mockups carries its Mockup check table (D46).

   Merge with `squash` and `expectedHeadSha`. Delete the branch, then update the other bottom PRs' branches.
   - **A conflict:** start one **fixer**. Use Sonnet for mechanical files (`hostAPIVersion`, ADR or PRD index rows, status cells, regenerated `Host.*`) and Opus otherwise.
   - **A merge turns `main` red:** tick `HOLD`, start an Opus fixer aimed at `main`, and log it.
5. **Launch.** Skip this step on `HOLD`, `HOLD-UNTIL-RESET`, AMBER-5H before its `resetsAt`, or when running ≥ `TARGET`.
   1. **Build the ready list.** A PRD phase is ready when:
      - its `Status` is `pending`;
      - every phase in its `Depends` is `complete` on `main`;
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
  3. On AMBER in your own reading (`allowed_warning`): **yield.** Finish the current PR to green, don't start the next phase, comment `<ID>: yielded after p<N>` on #509, and end.
  4. Otherwise, continue.
- **Finishing:**
  - Subscribe to your PRs, and drive `Build (Windows)` and `ui-dist` to green.
  - Answer every red-circle thread.
  - Comment `<ID>: PRs #… green` on #509, then end.
  - After three failed CI rounds on one PR: mark it draft, paste the failure into it, comment on #509, and end.
- **Owner steps:** anything needing the owner, REAPER, audio hardware or owner input goes on #510 as a comment and is marked pending in the PR. Never wait for a human.
- **Tooling:** the repo's `SessionStart` hook (`scripts/cloud/session-start.sh`, registered in `.claude/settings.json`) installs the pinned toolchain. `.claude/settings.json` allows the build, test and git commands and denies force-pushes and rebases. Workers never edit `.claude/settings.json`; auto mode refuses that as self-modification, so any change to it goes on #510 for the owner.

## Templates

### Worker template

Fill in the `<>` fields.

```
You are worker stream <ID> (lane <L>: <lane name>) in the narration-utils agent train. Repo countrymanprime/narration-utils.
No human is watching live; never wait for answers. Where a PRD leaves a question open, take its stated recommendation
(implementation plan D22) and record anything that truly needs the owner as a Proposed ADR, plus a comment on #510.

READ FIRST: CLAUDE.md; docs/operations/agent-train.md ("The worker protocol", "Serial points", "Lanes"); then each PRD in
scope, in full.
SCOPE: <PRD path> phases <N…>: <one line each>.
MOCKUPS (D46): <per phase: exact docs/prds/mockups/... files, or "none">. Open each before coding, build to match, capture
the same state at the same viewport, and add a "Mockup check" table to the PR (mockup | capture | matches / differs: why).
YOUR FILES: <the phases' rows from the PRD's Parallel-session table>. NEVER TOUCH: files owned by other lanes or listed for
a running stream on #509. If you need another lane's change, comment on #509.
ADR BLOCK: <block>. Check docs/adr/ for the next free number inside it, at write time and again before your last push.
BRANCHES AND PRS: first PR based on the latest main; one PR per phase, each based on the previous branch; branch
<type>/<prd-slug>-p<N>-<slug>; PR title a Conventional Commit; body = goal, what changed, local checks run with results,
Mockup check (UI with mockups), "Base: <branch>", "Part of #<PRD issue>" (find it or create it per
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
USAGE: follow "The worker protocol" exactly: push after every green step, check #509 and your rate_limit_info at every
checkpoint, pause or yield as it says.
FINISH: subscribe to your PRs; drive Build (Windows) and ui-dist green; answer every red-circle thread; comment
"<ID>: PRs #… green" on #509; end. NEVER merge. End every GitHub comment with a blank line, "---", then
"_Generated by [Claude Code](https://claude.ai/code)_".
```

### Resume template

The worker template, with this paragraph first:

```
RESUME: stream <ID> was paused. Its work is on branch <branch>, draft PR #<n>. Read the PR's "## Resume notes" and its
diff, check out the branch, merge main into it (never rebase), re-run the checks listed there, then continue from "Next".
Mark the PR ready for review when its phase is done.
```

### Fixer template

```
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
| **1: contracts** | [DAW port](../prds/daw-port-and-capabilities.prd.md) P1–P4 in lane K, one after another: N-K1 = P1 + P2, N-K2 = P3 + P4. [Provider ports](../prds/provider-ports.prd.md) phases after N-K1 (lane K, then B). [Studio UI primitives](../prds/studio-ui-primitives.prd.md) token batch (alone), then `CapabilityGate` (lane U). [Input commands and pedals](../prds/input-commands-and-pedals.prd.md) registry core (lane U) |
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
- Copy the concept mocks the PRD uses from `docs/research/mockups/audiobook-studio-benchmark/` into `docs/prds/mockups/<prd>/`, marked **concept**. They become the D46 spec only after the owner approves them on #510; until then a UI PR's Mockup check compares against the concept and says so.
- Give every open question a recommendation.
