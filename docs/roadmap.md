# Product Roadmap

The matching machine-readable [`config/roadmap.json`](../config/roadmap.json) holds the milestones
that `sync-milestones.yml` turns into GitHub milestones (the app does not read it). Update both
files together when a milestone or a shipped or deferred item changes so GitHub and this
documentation describe the same product direction.

## Product boundary

The suite helps a narrator find and review issues faster. It may analyze local manuscripts and audio, create reviewable REAPER markers or alternate takes, and export reports. It does not automatically comp audio, certify acting quality, or require cloud processing.

## Milestones

### 0. Documentation and contracts

- Publish this documentation set.
- Define the shared [finding](architecture/findings-contract.md) and review-state contract.
- Preserve the existing independent tool layouts and the project-owned canonical manuscript convention.

### 1. Dashboard foundation

**Status: built; checks in REAPER pending with the owner.** The [Review page](guides/using-the-app/review.md) lists the findings of Transcript Compare and the Story Bible, records decisions in the project sidecar, and goes to, loops and marks a finding in REAPER ([review dashboard PRD](prds/review-dashboard-and-findings-adoption.prd.md) Phases 1 to 8). The owner's checks in REAPER are in [the checklist](architecture/reaper-navigation.md#manual-verification-checklist).

- Adapt Manuscript Guide and Transcript Compare outputs into structured findings.
- Add a review page in the app with filters and review decisions; REAPER only carries out its navigate, loop and marker actions.
- Store user decisions in a project sidecar; no analyzer may silently change audio.

### 2. Recording and take review

**Status: built; a scan and comparison of a real chapter and the checks in REAPER are pending with the owner.** [Take review](utilities/take-review.md) finds pickups, restarts and duplicate reads on the [Review page](guides/using-the-app/review.md#pickups-and-duplicates), adds a chosen read as a take in one undo step, auditions reads side by side and compares a group's takes per category, never ranked. What is still open is [listed there](utilities/take-review.md#what-is-still-open).

- Add pickup/restart and duplicate-read detection.
- Group reviewed duplicate candidates as REAPER takes.
- Add side-by-side audition and evidence-based take comparison.

### 3. Character continuity

- Extend the manuscript guide into a reviewable character bible.
- Use narrator-approved regions as voice references.
- Flag possible acoustic drift with evidence, not acting verdicts.

### 4. Diagnostics and delivery

- Add editorial/technical findings and chapter summaries.
- Produce generic audiobook measurement reports and reviewer packages.
- Add distributor profiles only after their rules are independently specified and validated.

## Release-readiness work item: first-use dependency provisioning

**Status: provisioning delivered; the first stable release is not yet rehearsed.** Optional model downloads are out of the
checkout bootstrap and are application-owned, explicit first-use provisioning: the app launches without a checkout or
developer bootstrap script, downloads no optional model at startup, and offers every compatible voice, transcription model and
Story Bible language model for download only when the narrator uses it, after a confirmation. Delivered: the asset manager,
registry and Settings > Local assets page, the spaCy language model, the no-download-at-startup test, the legacy-cache policy,
the packaged smoke test and a per-user Windows setup program built in CI, beside the in-app update. Still open: run the
setup program on a clean Windows machine, publish the component atlas and the docs site (phases 9 to 11), and a first stable rehearsal (the owner runs Promote); signing is deferred. The first stable release is Windows-only and unsigned (owner decision D7); no model is bundled.
See the [first-use dependency provisioning rules](architecture/first-use-dependency-provisioning.md) for the required
catalog, integrity, UX, migration, and acceptance criteria and the
[release readiness PRD](prds/release-readiness-provisioning-and-docs-site.prd.md) for the phases.

### Deferred work

- macOS/Linux installers and adapters.
- Languages beyond US English.
- Team collaboration, cloud analysis, or shared project services.
- Manuscript Teleprompter beyond what has shipped (listening on a chosen microphone with a local Whisper model, or Moonshine on Windows, word highlighting, and reviewable suspected misreads, skips, extra words and restarts in the read-aloud dialog): a default engine chosen by evaluating both, following live REAPER state, and punch-in from a word; it never edits text or audio automatically. See the [Manuscript Teleprompter brief](architecture/manuscript-teleprompter.md) for the resolved design questions.

## Audacity adapter

Unscheduled on this roadmap, like the chapter stage recommendations set (owner decision D9 of the [implementation plan](prds/implementation-plan.md)), but no longer deferred behind the REAPER workflow (owner decision D23): it runs as its own parallel stack, spike-gated on its own scripting surface (`mod-script-pipe`) rather than on any REAPER milestone. See the [Audacity integration PRD](prds/audacity-integration.prd.md) and the [DAW integration boundary](architecture/daw-integration.md#audacity-boundary).

## Dependency rules

- Every new analyzer emits the shared finding format before it gets a bespoke UI.
- The dashboard consumes findings but does not reproduce analyzer algorithms.
- Take creation requires narrator approval, explicit target item identity, and an undoable REAPER action.
- Character reference analysis only uses clips explicitly approved by the narrator.
