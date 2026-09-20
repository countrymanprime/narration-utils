# Product Roadmap

The in-app Narration Utils roadmap reads the matching machine-readable
[`config/roadmap.json`](../config/roadmap.json) data. Update both
files together when a milestone changes so the shipped workspace and this
documentation describe the same product direction.

## Product boundary

The suite helps a narrator find and review issues faster. It may analyze local manuscripts and audio, create reviewable REAPER markers or alternate takes, and export reports. It does not automatically comp audio, certify acting quality, or require cloud processing.

## Milestones

### 0. Documentation and contracts

- Publish this documentation set.
- Define the shared [finding](architecture/findings-contract.md) and review-state contract.
- Preserve the existing independent tool layouts and the project-owned canonical manuscript convention.

### 1. Dashboard foundation

- Adapt Manuscript Guide and Transcript Compare outputs into structured findings.
- Add a REAPER review panel with filters, navigation, looping, and review decisions.
- Store user decisions in a project sidecar; no analyzer may silently change audio.

### 2. Recording and take review

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

Keep optional model downloads out of checkout bootstrap and move them to application-owned,
explicit first-use provisioning before distributing compiled GitHub releases.
The app must launch without a checkout or developer bootstrap script, download
no optional model at application startup, and offer every compatible model for
download only when the narrator selects and uses it. See the
[first-use dependency provisioning brief](architecture/first-use-dependency-provisioning.md)
for the required catalog, integrity, UX, migration, and acceptance criteria.

### Deferred work

- Audacity adapters after the shared contract and REAPER workflow are proven.
- macOS/Linux installers and adapters.
- Languages beyond US English.
- Team collaboration, cloud analysis, or shared project services.
- Manuscript Teleprompter: local live microphone listening with karaoke-style manuscript highlighting and reviewable suspected word-level substitutions, skips, or misreads; it never edits text or audio automatically. See the [Manuscript Teleprompter brief](architecture/manuscript-teleprompter.md) for the resolved design questions.

## Dependency rules

- Every new analyzer emits the shared finding format before it gets a bespoke UI.
- The dashboard consumes findings but does not reproduce analyzer algorithms.
- Take creation requires narrator approval, explicit target item identity, and an undoable REAPER action.
- Character reference analysis only uses clips explicitly approved by the narrator.
