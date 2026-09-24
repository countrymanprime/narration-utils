# Architecture & Design Decision Records (ADRs)

**Status: implemented.**

This folder is the fix for a recurring problem: agentic refactoring sessions have silently reverted deliberate decisions (styling, naming, behavior) because too much code and too many commits pile up between when a decision was made and when a later agent "cleans up" without knowing it was deliberate. An ADR is the durable record that a future agent — or person — checks *before* changing something, not after.

## Format: lightweight Nygard-style ADRs

We use a lightweight, Nygard-style format: Status, Date, Context, Decision, Consequences. It is deliberately not [MADR](https://adr.github.io/madr/) (no YAML front matter, no Decision Drivers or Considered Options sections): for one maintainer the extra sections are overhead, so the alternatives that mattered are named in Context. Each ADR is one file: `NNNN-short-title.md`, numbered sequentially starting at `0001`. Use [`template.md`](template.md) for the section structure.

## Rules

1. **Immutable once Accepted.** Never edit an accepted ADR's Decision or Consequences to reflect a change of mind. If a decision changes, write a **new** ADR that supersedes the old one.
2. **Superseding, not deleting.** The old ADR's `Status` line becomes `Superseded by ADR-NNNN`, and the new ADR's front matter links back (`Supersedes ADR-NNNN`). The old file stays — it's still useful history.
3. **One decision per ADR.** Don't bundle unrelated decisions; a future agent needs to be able to supersede one without touching the others.
4. **Concrete, not aspirational.** An ADR records a decision that was actually made and applied to the code, with a pointer to where. It is not a proposal — proposals for future work belong in `docs/prds/` (see its [README](../prds/README.md) for the format).

## How this is enforced

The `design-spec-guard` skill (`.claude/skills/design-spec-guard/`) reads this folder plus [`docs/design/design-system.md`](../design/design-system.md) before/during a refactor and flags any change that contradicts a recorded decision, unless that exact change is listed in an approved plan. The `adr-author` skill (`.claude/skills/adr-author/`) scaffolds new ADRs and handles the supersede bookkeeping so numbering and cross-links stay consistent.

## Index

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-import-dialog-max-width-and-overflow.md) | Import dialog max-width and overflow behavior | Accepted |
| [0002](0002-dialog-action-button-placement.md) | Dialog action buttons on opposite sides | Accepted |
| [0003](0003-tailwind-tokenized-primitives.md) | Tailwind-based tokenized primitives over ad hoc custom CSS classes | Superseded by ADR-0009 |
| [0004](0004-front-matter-naming.md) | "Front Matter" as the canonical front-matter section name | Accepted |
| [0005](0005-reference-material-excluded-from-chapter-nav.md) | Reference-material sections excluded from chapter navigation, retained in source data | Accepted |
| [0006](0006-chapter-progress-bar-ordering.md) | Chapter progress bar ordered finalized-to-not-started, left to right | Accepted |
| [0007](0007-story-bible-locked-entry-enforcement.md) | Story Bible locked-entry enforcement is server-side authoritative | Accepted |
| [0008](0008-timing-confidence-over-forced-alignment-model-for-transcript-compare.md) | Timing-confidence signal over a forced-alignment model for Transcript Compare, for now | Accepted |
| [0009](0009-complete-tailwind-migration.md) | Complete the Tailwind migration; retire the legacy custom-CSS system | Accepted (its `table.dtable` exception is superseded by ADR-0056) |
| [0010](0010-theme-switching.md) | Tri-state Light/Dark/System theme switching | Accepted |
| [0011](0011-doc-screenshots-curated-from-visual-suite.md) | Documentation screenshots are curated from the Playwright visual suite, not captured separately | Accepted |
| [0012](0012-media-route-for-track-playback.md) | Local track audio is streamed through a Wails asset-server route, not the base64-binding pattern | Accepted |
| [0013](0013-import-preserves-structural-whitespace.md) | Manuscript import preserves structural whitespace and repairs glued headings | Accepted |
| [0014](0014-inline-formatting-as-offset-spans.md) | Inline formatting is stored as offset spans over canonical plain text | Accepted |
| [0015](0015-real-progress-only.md) | Progress bars and activity logs show real work only | Accepted |
| [0016](0016-highlight-primitive.md) | One `Highlight` primitive for entity, note and review highlights | Accepted (amends ADR-0009; amended by ADR-0063 and, proposed, ADR-0118) |
| [0017](0017-no-legacy-css-shadowing-tailwind.md) | No unlayered legacy CSS or contradictory utilities shadow Tailwind | Accepted (amends ADR-0009) |
| [0018](0018-story-bible-entries-read-only-until-edit.md) | Story Bible entries are read-only until Edit is pressed | Accepted (amended by ADR-0036; its read-only-actions clause is superseded by ADR-0087) |
| [0019](0019-detected-manuscript-is-offered-not-imported.md) | A manuscript found in the project folder is offered, never imported automatically | Accepted (extension list amended by ADR-0103) |
| [0020](0020-entity-extraction-precision-over-recall.md) | Story Bible entity extraction favors precision over recall | Accepted |
| [0021](0021-live-speech-engines-behind-one-event-contract.md) | Live speech engines are interchangeable behind one event contract | Accepted |
| [0022](0022-live-sidecar-events-over-wails-and-stop-file.md) | The host relays live sidecar events over Wails events and stops the sidecar with a stop file | Accepted |
| [0023](0023-visual-suite-capture-contract-and-storybook.md) | The visual suite is a validated capture contract, and Storybook is the component layer | Accepted |
| [0024](0024-teleprompter-highlight-follows-the-sidecars-spans.md) | The teleprompter highlight follows the sidecar's spans and only ever catches up to the real position | Accepted (amends ADR-0016; amended, proposed, by ADR-0119) |
| [0025](0025-delivery-measurements-in-go-profiles-deferred.md) | Delivery measurements are computed in Go, and no distributor profile ships yet | Accepted |
| [0026](0026-manuscript-line-identity-in-item-extension-data.md) | Manuscript line identity is stored in REAPER item extension data and read back through the bridge | Accepted |
| [0027](0027-windows-gates-and-creates-the-release.md) | Windows gates pull requests and creates the release; macOS and Linux are optional, separate builds | Accepted |
| [0028](0028-planned-work-is-specified-as-prds-and-deleted-when-built.md) | Planned work is specified as PRDs, kept apart from ADRs, and a PRD is deleted once its work is built | Accepted |
| [0029](0029-work-is-tracked-on-github-and-decided-in-the-repo.md) | Work is tracked on GitHub, generated from files in the repo, and decisions and docs stay in the repo | Accepted |
| [0030](0030-the-app-starts-without-a-project-and-picks-one-from-recents.md) | The app can start without a project and picks one from a per-user recents list | Accepted |
| [0031](0031-reaper-integration-is-a-lua-file-bridge-verified-by-hand.md) | REAPER integration stays a Lua file bridge, and Lua changes are verified by hand | Accepted (its point 3 is superseded by ADR-0066; its `if/elseif` dispatch in point 1 by ADR-0067) |
| [0032](0032-analyzers-report-findings-and-never-change-audio-or-manuscript-on-their-own.md) | Analyzers report findings and never change the narrator's audio or manuscript on their own | Accepted |
| [0033](0033-the-teleprompter-follows-speech-with-continuous-alignment-and-pause-resume.md) | The teleprompter follows what was said, with continuous alignment and pause/resume | Accepted |
| [0034](0034-live-recognition-is-unconstrained-and-never-restricted-to-the-script.md) | Live recognition is unconstrained and is never restricted to the script's words | Accepted |
| [0035](0035-live-transcription-techniques-are-ported-not-depended-on.md) | Live transcription techniques are ported into the sidecar, not taken as dependencies | Accepted |
| [0036](0036-story-bible-read-only-view-is-the-disabled-form-not-entitysummary.md) | The Story Bible's read-only view is the same form with disabled controls, not `EntitySummary` | Accepted (amends ADR-0018) |
| [0037](0037-visual-suite-captures-no-phone-viewport.md) | The visual suite captures no phone viewport | Accepted (amends ADR-0023; amended by ADR-0061) |
| [0038](0038-visual-suite-captures-the-production-build.md) | The visual suite captures the production build, not the dev server | Accepted (amends ADR-0023) |
| [0039](0039-the-project-is-licensed-agpl-3-or-later.md) | The project is licensed AGPL-3.0-or-later | Accepted |
| [0040](0040-the-repository-is-laid-out-by-role-and-each-project-is-an-nx-project.md) | The repository is laid out by role, and each project is an Nx project | Accepted |
| [0041](0041-host-bindings-read-project-services-through-one-snapshot-accessor.md) | Host bindings read the project-scoped services through one snapshot accessor | Accepted |
| [0042](0042-proofing-suggestions-derive-from-current-entities-and-skip-auto-extracted-needs-review.md) | Proofing's "Suggest from manuscript" derives names from the current Story Bible and leaves out auto-extracted Needs Review entries | Accepted |
| [0043](0043-coverage-is-a-ratchet-on-logic-directories-not-a-blanket-80-percent.md) | Coverage is a ratchet on logic directories, not a blanket 80% | Accepted |
| [0044](0044-property-and-fuzz-tests-are-deterministic-in-the-gate.md) | Property and fuzz tests are deterministic in the gate | Accepted |
| [0045](0045-dead-code-is-gated-at-zero-with-reasoned-ignores.md) | Dead code is gated at zero, and every ignore says why | Accepted |
| [0046](0046-architecture-rules-taken-from-adrs-are-lint-and-test-rules.md) | Mechanically checkable ADR rules are lint and test rules that name their ADR | Accepted |
| [0047](0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md) | The UI primitives wrap Base UI, and app code never imports it | Accepted |
| [0048](0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md) | Every dialog is one modal shell, confirms are alert dialogs, and Escape, the backdrop and focus follow one policy | Accepted |
| [0049](0049-hints-are-base-ui-tooltips-that-meet-wcag-1-4-13-and-info-icons-are-buttons.md) | Hints are Base UI tooltips that meet WCAG 1.4.13, and info icons are buttons that open a popover | Accepted |
| [0050](0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md) | The segmented meter is an image named by its segments, and Field wires its hint and error through Base UI | Accepted |
| [0051](0051-the-slide-over-and-the-navigation-drawer-are-modal-base-ui-drawers.md) | The slide-over and the navigation drawer are modal Base UI drawers | Accepted |
| [0052](0052-toggle-menu-checkbox-collapsible-and-switch-replace-the-hand-rolled-widgets.md) | Toggle, Menu, Checkbox, Collapsible and Switch replace the hand-rolled widgets | Accepted |
| [0053](0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md) | Icon buttons, text fields and selects wrap the native controls, and pages may not write them | Accepted |
| [0054](0054-tabs-and-toggle-groups-name-and-link-what-the-hand-built-strips-left-anonymous.md) | Tabs and toggle groups name and link what the hand-built strips left anonymous | Accepted |
| [0055](0055-the-tag-input-is-a-wrapped-text-field-and-chips-that-report-and-never-edit-the-list.md) | The tag input is a wrapped text field and chips that report and never edit the list | Accepted |
| [0056](0056-a-presentational-table-primitive-replaces-the-dtable-class-and-rows-take-the-keyboard.md) | A presentational Table primitive replaces the dtable class, and pressable rows take the keyboard | Accepted |
| [0057](0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md) | A running job that cannot be cancelled keeps its dialog blocking and says so, and the progress bar respects reduced motion | Accepted (its "stays blocking" rule is superseded for the Story Bible rebuild by ADR-0076) |
| [0058](0058-heading-has-a-level-and-panel-names-its-region-with-a-level-2-title.md) | Heading has a level, and Panel names its region with a level-2 title | Accepted |
| [0059](0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md) | Text colours meet WCAG AA: two text levels, a non-text token, and derived on-tint text | Accepted (amends ADR-0016) |
| [0060](0060-the-visual-suite-fails-a-collapsed-control-and-a-row-may-declare-one-narrow-on-purpose.md) | The visual suite fails a collapsed control, and a row may declare one narrow on purpose | Accepted (amends ADR-0023) |
| [0061](0061-settings-states-are-also-captured-at-a-390px-reflow-width.md) | Settings states are also captured at a 390 px reflow width | Accepted (amends ADR-0037) |
| [0062](0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md) | UI import rules are a dependency-cruiser config and a `<mark>` scan that name their ADR | Accepted |
| [0063](0063-the-proofing-diff-marks-its-own-words-and-adr-0016-covers-entry-highlights.md) | The proofing diff marks its own words, and ADR 0016 covers entry highlights | Accepted (amends ADR-0016) |
| [0064](0064-the-visual-suite-runs-axe-on-every-app-state-and-a-violation-fails-unless-it-is-declared-debt.md) | The visual suite runs axe on every app state, and a violation fails unless it is declared debt | Accepted (amends ADR-0023) |
| [0065](0065-aria-snapshots-pin-the-role-trees-of-the-dialogs-the-slide-over-and-the-navigation.md) | Aria snapshots pin the role trees of the dialogs, the slide-over and the navigation | Accepted |
| [0066](0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md) | The Lua bridge is tested by a harness under Lua 5.4, and REAPER API behaviour is checked in REAPER | Accepted (supersedes point 3 of ADR-0031) |
| [0067](0067-bridge-commands-are-registered-by-name-and-each-feature-lives-in-its-own-lua-file.md) | Bridge commands are registered by name, and each feature lives in its own Lua file | Accepted |
| [0068](0068-bridge-events-fan-out-to-subscribers-by-tag-and-run-and-every-error-names-its-run.md) | Bridge events fan out to subscribers by tag and run, and every error names its run | Accepted |
| [0069](0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md) | Payloads are validated with Zod behind `parseWire`, and a wrong shape fails loudly | Accepted |
| [0070](0070-workflow-actions-are-pinned-to-a-commit-and-zizmor-gates-the-workflows.md) | Workflow actions are pinned to a commit, and zizmor gates the workflows | Accepted |
| [0071](0071-releases-carry-build-provenance-and-promote-refuses-a-file-the-release-workflows-did-not-build.md) | Releases carry build provenance, and promote refuses a file the release workflows did not build | Accepted |
| [0072](0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md) | The app updates itself from this repository's releases and never installs without a click | Accepted |
| [0073](0073-the-executable-is-named-narration-utils-and-carries-its-version.md) | The executable is named `narration-utils` and carries its own version | Accepted |
| [0074](0074-the-windows-update-renames-the-running-executable-and-keeps-the-old-one-until-the-new-one-starts.md) | The Windows update renames the running executable and keeps the old one until the new one starts | Accepted |
| [0075](0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md) | Every action that leaves the interface acknowledges within 100 ms, cannot be fired twice, and tells the narrator when it ends | Accepted |
| [0076](0076-a-host-job-ends-with-one-job-ended-event-the-app-announces-it-and-the-story-bible-rebuild-may-continue-in-the-background.md) | A host job ends with one `job:ended` event, the app announces it, and the Story Bible rebuild may continue in the background | Accepted (amends ADR-0057) |
| [0077](0077-every-asset-install-is-one-job-with-real-bytes-a-second-start-joins-it-and-one-hook-follows-it.md) | Every asset install is one job with real bytes, a second start joins it, and one hook follows it | Accepted |
| [0078](0078-asset-state-comes-from-the-manifest-an-asset-is-read-in-full-once-per-session-and-a-failed-download-resumes.md) | Asset state comes from the manifest, an asset is read in full once per session, and a failed download resumes | Accepted |
| [0079](0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md) | Every downloadable asset is listed, installed, verified and removed through one registry of providers | Accepted |
| [0080](0080-the-story-bible-language-model-is-a-catalog-asset-unpacked-at-install-and-the-build-asks-before-it-downloads.md) | The Story Bible language model is a catalog asset unpacked at install, and the build asks before it downloads | Accepted |
| [0081](0081-local-assets-is-a-settings-list-built-from-the-registry-whose-rows-own-their-download-verify-and-remove.md) | Local assets is a Settings list built from the registry, whose rows own their download, verify and remove | Accepted |
| [0082](0082-windows-installs-per-user-from-an-nsis-setup-program-that-wails-builds-and-the-release-carries-beside-the-update-zip.md) | Windows installs per user from an NSIS setup program that Wails builds and the release carries beside the update zip | Accepted |
| [0083](0083-the-public-docs-site-is-built-by-mkdocs-with-the-material-theme-straight-from-docs-and-a-reviewed-include-list.md) | The public docs site is built by MkDocs with the Material theme straight from docs/, and a reviewed include list decides what is published | Accepted |
| [0084](0084-repository-links-are-checked-offline-on-every-pull-request-and-diagrams-are-parsed-and-drawn-without-a-third-party.md) | Repository links are checked offline on every pull request, and diagrams are parsed and drawn without a third party | Accepted |
| [0085](0085-the-third-party-notices-are-generated-from-the-release-and-ship-as-their-own-asset-and-not-inside-the-update-zip.md) | The third-party notices are generated from the release and ship as their own asset, not inside the update zip | Accepted |
| [0086](0086-the-import-review-is-grouped-by-what-each-section-will-be-and-reports-repairs-instead-of-a-log.md) | The import review is grouped by what each section will be, and reports the importer's repairs instead of its log | Accepted |
| [0087](0087-story-bible-header-actions-are-mode-based-and-lock-cannot-happen-mid-edit.md) | Story Bible header actions are mode-based, and Lock cannot happen mid-edit | Accepted |
| [0088](0088-contents-and-characters-stay-reference-hidden-by-the-reader.md) | Contents and Characters stay stored as reference chapters; hiding them in the reader is the reader PRD's own phase | Accepted |
| [0089](0089-a-docx-table-of-contents-becomes-the-authoritative-chapter-list-above-a-match-threshold.md) | A docx's own table of contents becomes the authoritative chapter list above a match threshold | Accepted |
| [0090](0090-the-page-flip-reader-hides-reference-chapters-superseding-the-reader-half-of-adr-0005.md) | The page-flip reader hides reference chapters, superseding the reader half of ADR 0005 | Accepted |
| [0091](0091-story-bible-pronunciation-is-a-narrator-edited-value-the-preview-speaks-directly.md) | Story Bible pronunciation is a narrator-edited value the preview speaks directly | Accepted |
| [0092](0092-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md) | REAPER executable discovery, heartbeat mechanism and script-plus-project launch are resolved | Accepted |
| [0093](0093-the-home-estimate-times-the-first-opening-and-closing-template-until-a-project-can-choose-one.md) | The Home estimate times the first opening and closing template until a project can choose one | Accepted |
| [0094](0094-dialog-gains-a-full-size-variant-that-fills-the-viewport-with-a-margin.md) | Dialog gains a full-size variant that fills the viewport with a margin | Accepted |
| [0095](0095-txt-import-decodes-by-bom-utf-8-windows-1252-and-a-chapterless-file-becomes-one-narration-chapter.md) | TXT import decodes by BOM/UTF-8/Windows-1252, and a chapterless file becomes one narration chapter | Accepted |
| [0096](0096-the-public-demo-builds-under-its-own-vite-mode-and-the-router-carries-a-basename.md) | The public demo builds under its own Vite mode, and the router carries a basename | Accepted |
| [0097](0097-the-manuscript-reader-word-lookup-uses-the-open-english-wordnet-as-a-downloadable-asset.md) | The manuscript reader's word lookup uses the Open English WordNet as a downloadable asset | Accepted |
| [0098](0098-take-provenance-in-take-extension-data-extends-adr-0026.md) | Take provenance is stored in take-level extension data, extending ADR 0026 to takes | Accepted |
| [0099](0099-chapter-tags-are-embedded-with-bogem-id3v2-and-a-hand-built-ctoc-frame.md) | Chapter tags are embedded with bogem/id3v2 and a hand-built CTOC frame, into a new file, MP3 only | Accepted |
| [0100](0100-analysis-evidence-is-two-hash-keys-one-ledger-record-per-run-and-a-narrator-confirmed-track-map.md) | Analysis evidence is two hash keys, one ledger record per run, and a narrator-confirmed track map | Accepted |
| [0101](0101-epub-import-reads-nav-then-ncx-for-chapters-caps-entries-and-refuses-drm.md) | EPUB import reads nav then NCX for chapters, caps entries, and refuses DRM | Accepted |
| [0102](0102-epub-content-kind-overrides-by-title-rather-than-canonical-title-renaming.md) | EPUB `epub:type` forces a section's content kind by an explicit override, not by renaming its title to one the classifier already knows | Accepted |
| [0103](0103-txt-and-epub-are-accepted-import-formats-hand-rolled-drm-refused-and-offered-for-detection.md) | TXT and EPUB are accepted import formats, hand-rolled without a library, DRM is refused, and both are offered for detection | Accepted (amends ADR-0019) |
| [0104](0104-seek-reaches-a-running-teleprompter-session-through-a-tailed-control-file.md) | Seek reaches a running teleprompter session through a tailed control file | Accepted |
| [0105](0105-the-visual-suite-drives-each-state-once-and-resizes-through-the-viewports.md) | The visual suite drives each state once and resizes through the viewports | Accepted (amends ADR-0023) |
| [0106](0106-a-teleprompter-session-stops-itself-five-seconds-after-the-tracker-reports-done.md) | A teleprompter session stops itself five seconds after the tracker reports done | Proposed |
| [0107](0107-moonshine-ships-inside-the-windows-teleprompter-sidecar-and-runs-only-from-a-verified-catalog-install.md) | Moonshine ships inside the Windows Teleprompter sidecar and runs only from a verified catalog install | Proposed |
| [0110](0110-one-go-chapter-to-track-matcher-ported-from-transcript-compare-with-explicit-confidence-states.md) | One Go chapter-to-track matcher, ported from Transcript Compare, with explicit confidence states | Proposed |
| [0111](0111-the-resume-point-comes-from-transcribing-the-recorded-tail-and-placing-it-with-the-tracker.md) | The resume point comes from transcribing the recorded tail and placing it with the tracker | Proposed |
| [0112](0112-the-resume-card-looks-up-where-the-recording-ends-on-open-and-a-choice-only-sets-where-start-begins.md) | The resume card looks up where the recording ends when the dialog opens, and a choice only sets where Start begins | Proposed |
| [0113](0113-the-teleprompter-suggests-a-chapter-from-the-saved-armed-track-and-preselects-only-a-confident-match.md) | The Teleprompter suggests a chapter from the saved armed track, and preselects only a confident match | Proposed |
| [0115](0115-live-flags-are-suspected-judged-per-closed-segment-and-forgive-what-transcript-compare-forgives.md) | Live flags are suspected, judged per closed segment, and forgive what Transcript Compare forgives | Proposed |
| [0116](0116-read-aloud-marks-cover-whole-words-the-innermost-is-the-control-and-a-mark-never-seeks.md) | Read-aloud marks cover whole words, the innermost is the control, and a mark never seeks | Proposed |
| [0117](0117-live-flags-are-kept-as-suspected-findings-merged-per-chapter-when-a-session-ends.md) | Live flags are kept as suspected findings, merged per chapter, when a session ends | Proposed |
| [0118](0118-read-aloud-flags-are-highlight-kinds-with-an-inline-hint-and-skips-and-restarts-show-by-default.md) | Read-aloud flags are Highlight kinds with an inline hint, and skips and restarts show by default | Proposed (amends ADR-0016) |
| [0119](0119-a-hand-scroll-pauses-following-until-the-current-word-is-back-in-the-band.md) | A hand scroll pauses following until the current word is back in the band | Proposed (amends ADR-0024) |
| [0120](0120-findings-are-read-and-decided-through-four-generic-bindings-and-a-decision-carries-the-evidence-version-it-was-made-against.md) | Findings are read and decided through four generic bindings, and a decision carries the evidence version it was made against | Proposed |
| [0121](0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md) | Going to and looping a finding is by GUID and source time, makes no undo point, and Stop restores what the loop changed | Proposed |
| [0122](0122-the-review-page-asks-reaper-only-on-a-click-and-only-while-it-answers-and-a-refusal-is-an-answer.md) | The Review page asks REAPER only on a click and only while it answers, and a refusal is an answer | Proposed |
| [0123](0123-the-approved-marker-is-one-take-marker-for-an-accepted-finding-named-like-transcript-compares-in-one-undo-point.md) | The approved marker is one take marker for an accepted finding, named like Transcript Compare's, in one undo point | Proposed |
| [0124](0124-take-review-groups-are-reviewed-on-the-review-page-each-read-is-navigated-by-its-index-and-the-scan-is-a-cancellable-job.md) | Take-review groups are reviewed on the Review page, each read is navigated by its index, and the scan is a cancellable job | Proposed |
| [0125](0125-recording-coverage-ground-truth-is-scripted-recordings-with-paragraph-labels-and-a-corpus-directory-variable.md) | Recording-coverage ground truth is scripted recordings with paragraph labels, and a real corpus plugs in through a directory variable | Proposed |
| [0126](0126-recording-coverage-reads-the-take-markers-sequencematcher-alignment-and-folds-chance-matches-into-gaps.md) | Recording coverage reads the take markers' SequenceMatcher alignment and folds chance matches into gaps | Proposed |
| [0127](0127-the-coverage-sidecar-mode-reads-a-json-manifest-keeps-one-words-file-per-item-and-writes-tagged-json-lines.md) | The coverage sidecar mode reads a JSON manifest, keeps one words file per item, and writes tagged JSON lines | Proposed |
| [0128](0128-the-coverage-service-reads-the-saved-project-keeps-words-per-source-range-and-leaves-model-and-language-out-of-the-parameter-hash.md) | The coverage service reads the saved project, keeps words per source range, and leaves model and language out of the parameter hash | Proposed |
| [0129](0129-the-coverage-bindings-answer-refusals-as-results-end-with-one-job-event-and-fill-recordedfraction-only-from-a-current-check.md) | The coverage bindings answer refusals as results, end with one job event, and fill recordedFraction only from a current check | Proposed |
| [0130](0130-the-home-recording-check-opens-on-the-stored-result-runs-only-on-a-press-and-labels-the-recorded-length-measured-or-estimated.md) | The Home recording check opens on the stored result, runs only on a press, and labels the recorded length measured or estimated | Proposed |
| [0131](0131-the-recording-signal-is-read-from-stored-checks-with-thresholds-applied-on-read-and-alignment-from-settings.md) | The recording signal is read from stored checks, with thresholds applied on read and the alignment taken from settings | Proposed |
| [0132](0132-the-recording-check-ships-0-8-3-8-3-chosen-on-synthetic-fixtures-and-labelled-uncalibrated.md) | The recording check ships 0.8, 3, 8 and 3, chosen on synthetic fixtures and labelled uncalibrated | Proposed |
| [0135](0135-a-subtitle-turned-off-in-the-import-review-joins-the-title-or-returns-to-the-text-by-where-its-line-came-from.md) | A subtitle turned off in the import review joins the title or returns to the text, by where its line came from | Proposed (amends ADR-0086) |
| [0136](0136-an-asset-may-keep-only-a-file-built-at-install-from-its-verified-archive.md) | An asset may keep only a file built at install from its verified archive | Proposed (extends ADR-0080) |
| [0140](0140-take-metrics-are-per-category-evidence-over-a-takes-source-range.md) | Take metrics are per-category evidence measured over a take's source range | Proposed |
| [0141](0141-per-take-divergence-is-localized-by-the-markers-diff-and-asr-word-timestamps.md) | Per-take divergence is localized by the markers' diff and ASR word timestamps, checked on synthetic fixtures | Proposed |
| [0143](0143-the-review-workflow-calls-a-daw-through-dawadapter-and-the-event-vocabulary-is-part-of-the-contract.md) | The review workflow calls a DAW through `dawadapter.Review`, and the event vocabulary is part of the contract | Proposed |
| [0144](0144-a-launch-names-its-daw-with-daw-and-an-audacity-launch-opens-no-reaper-bridge.md) | A launch names its DAW with `--daw`, and an Audacity launch opens no REAPER bridge | Proposed |
| [0145](0145-the-audacity-launcher-is-an-installer-start-menu-entry-and-a-picker-switch-keeps-an-audacity-launch.md) | The Audacity launcher is an installer Start Menu entry, and a picker switch keeps an Audacity launch | Proposed |
| [0146](0146-cleanup-launchers-open-an-allow-listed-reaper-action-found-by-its-name-and-change-nothing-themselves.md) | Cleanup launchers open an allow-listed REAPER action found by its name, and change nothing themselves | Proposed |
| [0147](0147-retakes-on-fixed-lanes-are-chosen-by-lane-play-state-and-the-app-never-converts-takes-and-lanes.md) | Retakes on fixed lanes are chosen by lane play state, and the app never converts takes and lanes | Proposed |
| [0150](0150-the-teleprompter-reads-credits-as-a-host-rendered-script-file-not-a-chapter.md) | The teleprompter reads the credits as a host-rendered script file, not as a chapter | Proposed |
| [0151](0151-chapter-announcements-render-per-narration-chapter-and-are-timed-with-the-credits.md) | Chapter announcements render per narration chapter and are timed with the credits; room tone is the narrator's setting | Proposed |
| [0152](0152-the-retail-sample-is-a-paragraph-range-on-the-project-manifest-held-to-five-minutes-by-the-host.md) | The retail sample is a paragraph range on the project manifest, held to five minutes by the host | Proposed |
| [0155](0155-settings-gain-a-number-kind-with-a-declared-range-and-delivery-limits-are-the-narrators-own.md) | Settings gain a number kind with a declared range, and delivery limits are the narrator's own | Proposed |
| [0156](0156-measurement-reads-only-files-picked-this-session-as-one-job-and-fingerprints-the-bytes-it-read.md) | Measurement reads only files picked this session, as one job, and fingerprints the bytes it read | Proposed |
| [0158](0158-windowed-diagnostics-are-one-read-pass-with-fixed-windows-narrator-thresholds-and-candidate-findings.md) | Windowed diagnostics are one read pass with fixed windows, narrator thresholds and candidate findings | Proposed |
| [0160](0160-stage-recommendations-are-computed-from-tri-state-signals-by-a-pure-engine.md) | Stage recommendations are computed from tri-state signals by a pure engine | Proposed |
| [0161](0161-stage-decisions-live-in-their-own-sidecar-and-confirm-writes-the-record-before-the-status.md) | Stage decisions live in their own sidecar, and Confirm writes the record before the status | Proposed |
| [0165](0165-a-take-comparison-is-one-finding-per-group-over-its-one-span-built-from-the-saved-project-and-never-ranked.md) | A take comparison is one finding per group, over its one span, built from the saved project, and never ranked | Proposed |
