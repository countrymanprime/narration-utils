# Story Bible and Import UX Briefs

**Supersedes:** `docs/architecture/native-notifications.md`, `docs/architecture/story-bible-concurrent-build.md`, `docs/architecture/import-settings-workflow.md`, `docs/architecture/dictionary-thesaurus-integration.md`, `docs/architecture/pronunciation-provider-selection.md` (planned-work briefs, removed when this PRD landed; recoverable from git history)

Five small planned UX briefs (formerly in `docs/architecture/`, listed above) bundled as one PRD, one capability each (own MoSCoW rows, own phases): native OS notifications (N), Story Bible build after import (B), import settings review (I), dictionary/thesaurus lookup (D), pronunciation provider selection (P). Citations are `file:line` on branch `claude/features-defects-prds-planning-87c378` (b9d348d, re-checked unchanged at main d5cc994: `git diff b9d348d..HEAD -- shell apps/ui/src` touches only `apps/desktop/go.mod`, `apps/desktop/go.sum` and two doc-guide tests) for anything checked in code; "per docs" marks a claim taken from a brief or ADR and not re-verified. Two sibling briefs (`standalone-launch.md`, `story-bible-readonly-views.md`) were checked and are stale (already shipped); they get no PRD and are classified under Evidence. Outcome: `docs/architecture/standalone-launch.md` is kept and marked Implemented (its packaging section stays planned), and `story-bible-readonly-views.md` is removed (ADR 0018 and the Story Bible guide hold the behavior). The five superseded briefs named in the first table are removed from the tree; read one with `git show d5cc994:docs/architecture/<name>`.

## Problem Statement

A narrator preparing a manuscript hits friction across one flow: import, then remember to build the Story Bible, then review names and pronunciations, then wait on long jobs (build, model downloads, comparison) with no signal if they switch windows. The five briefs describing these gaps were written from memory of the code, and verification shows several claims are wrong (Wails already ships native notifications; a "pronunciation provider" would not change what the narrator hears; two briefs are already implemented). Building them as written wastes effort, and the two data-source briefs (dictionary, pronunciation) risk breaking the local-first boundary or the dependency license policy if a cloud API or a GPL engine is picked by default.

## Evidence

Verified status of each brief (code checked this session):

| Brief (removed from the tree; `git show d5cc994:docs/architecture/<name>`) | Verdict | Evidence |
| --- | --- | --- |
| `native-notifications.md` | Not implemented, but the brief's central research question is answered: Wails v2.16.0 (`apps/desktop/go.mod:7`) already ships a cross-platform notification API | No notification code in `apps/desktop/` or `apps/ui/src` (grep, only `Toast`). The Wails module (local module cache, `pkg/runtime/notifications.go:28-66`) exposes `InitializeNotifications`, `IsNotificationAvailable`, `RequestNotificationAuthorization`, `SendNotification` and action/category variants. Windows backend (`internal/frontend/desktop/windows/notifications.go:56-158`) uses go-toast, writes an HKCU `Software\Classes\CLSID\<GUID>\LocalServer32` key on initialize (`:76-77`), and always reports available and authorized (`:152-158`), so "unavailable" cannot be detected on Windows. Wails v2 has no window-focus query (`pkg/runtime/window.go` has `WindowIsMinimised`/`WindowIsNormal` only), so "the user is not looking" must be decided in the webview (`document.hasFocus()`). The brief's `runtime.exec` PowerShell fallback is unnecessary, and so is its worry that Windows gates notifications behind a consent prompt (see N2). The only channel today is the single in-app toast: one string, fixed 2.4 s (`apps/ui/src/components/layout/Toast.tsx:8-9`), gone whether or not the user saw it (since replaced by a queue with sticky errors, [interaction feedback](../architecture/interaction-feedback.md); the toast is what this brief's notification sits beside); the OS notification is meant for "you were looking at something else", alongside the toast, never instead of it. |
| `story-bible-concurrent-build.md` | Not implemented; every building block exists | No `build_after_import`-style setting anywhere. `GuideBuild` job with real progress: `apps/desktop/app.go:837-893` (ADR 0015). Post-commit hook already used to seed characters: `apps/desktop/bindings.go:286-296`, `seedCharacterCandidates` `:305-330` (sequential Python spawns, one per checked candidate). `merge_locked` keeps `manual` entities across a rebuild: `sidecars/manuscript-guide/core/manuscript_guide.py:673-679`; a unit test covers it (`tests/test_manuscript_guide.py:456`). Project switch is refused while a build runs: `apps/desktop/app.go:471-478`. The brief's premise is that the Go importer parses a full manuscript in well under a second, so a second manual step has no good reason to exist (per the brief, not re-measured here; build duration is unmeasured, Phase 3 records it). The name "concurrent" is misleading: seeding and building both rewrite `manuscript_guide.json` from separate processes with no lock, so build must be sequenced after seeding, never overlapped. |
| `import-settings-workflow.md` | Not implemented; one claim is stale | No `subtitleOverrides` field anywhere. The review dialog has exactly three controls: Markdown heading level (`apps/ui/src/components/home/Home.tsx:217`), per-section content kind (`:243`), character candidate checkboxes (`:275`). The preview payload (`apps/ui/src/api/contracts/manuscript.ts:71-78`) carries `chapterTitles`, `sections`, `characterCandidates` only, so the UI has no subtitle data to edit. The brief says `docx.go` splits "first line = title, remaining = subtitle unconditionally"; the split now lives in `apps/desktop/internal/importer/headings.go:90-97` (`headingParts`, called at `docx.go:262` and `markdown.go:91`) and also repairs glued headings (ADR 0013). The value lands in `Paragraph.ChapterSubtitle` (`apps/desktop/internal/importer/model.go:13`), which the brief named as the field an override should feed before commit. The brief itself says which settings matter needs "real manuscripts with more classification failures"; none are recorded. |
| `dictionary-thesaurus-integration.md` | Not implemented | No lookup code (grep for `thesaurus`/`dictionary` finds only pronunciation-dictionary text). `SelectionMenu.tsx:47-55` has "+ Note" and "+ Story Bible" only. `docs/research/local-dependency-evaluation.md` has no dictionary or thesaurus dataset entry (its only dictionary content is MFA pronunciation packs, `:241-247`, and a "Pronunciation dictionaries/G2P" row, `:536`), so no dataset has cleared its provenance gate. The brief's bundling precedent ("`pyproject.toml` already vendors sizable local models like spaCy/piper") is only half right: `pyproject.toml:13-21` vendors the Python libraries, while model weights, voices and dictionaries are optional assets, not startup dependencies (`first-use-dependency-provisioning.md:48-49`), so D follows the asset path, not a bundled dataset. Local-first is a recorded boundary: `docs/roadmap.md` "Product boundary" (no cloud processing) and `docs/utilities/manuscript-guide.md` non-goals (no scraping external sources). |
| `pronunciation-provider-selection.md` | Not implemented as a provider choice, but partly exists as a fixed two-engine chain | `pronunciation()` (`manuscript_guide.py:439-464`) already tries CMU dictionary via `pronouncing` (source `"CMU dictionary"`, medium) then eSpeak NG via `phonemizer` (`"eSpeak NG"`, low), else "not generated"; both are dependencies (`pyproject.toml:13,15`). `GuideDetail.tsx:393` says "provider-generated" only as tooltip copy; `:407` shows `Source: ... Confidence: ...`. Pronunciation is display-only (`:388-391`, a `div`, not an input). Entities and aliases both carry a pronunciation (`contracts/storyBible.ts:6-16`), so a per-name choice applies to both. |

Findings that change the design of P and B (verified):

- **The audio preview does not use the pronunciation.** `guide.Preview` sends the entity's name text to Piper (`apps/desktop/internal/guide/service.go:264-298`; `render_audio` `manuscript_guide.py:1046-1071`, `voice.synthesize_wav(spoken, ...)`). A provider that returns different IPA changes only the printed IPA; the narrator's audible preview is unchanged. Piper phoneme-input support is TBD - needs research.
- **Rebuild clobbers a user pronunciation.** `merge_locked` preserves `description`, `personality_notes`, `context`, relationships and prior-only aliases for unlocked entities (`manuscript_guide.py:681-695`) but not `pronunciation`, so the brief's "merge_locked precedent" does not cover an override on an unlocked auto-extracted entity.
- **A "say it as" respelling was deliberately removed.** The comment at `manuscript_guide.py:440-442` says there is no user-editable respelling any more, while `docs/utilities/manuscript-guide.md` still lists "say it as" forms as a planned MVP enhancement.
- **Cold-start cost, measured once in the dev venv (Windows, warm cache, 2-3 samples; frozen sidecar not measured, TBD):** interpreter 54 ms; `manuscript_guide.py --help` (module import) 286-339 ms, dominated by the eager `from piper.voice import PiperVoice` at `manuscript_guide.py:30` (about 265 ms alone); `pronouncing` import plus lookup about 340 ms; `import spacy` about 750 ms (model load not measured: `en_core_web_sm` is not installed in that venv). Every Python-backed Story Bible call therefore costs at least about 0.3 s, which is why D must not run in a Python sidecar and why B's duration is unknown.
- **Only `choice`/`color` settings validate today** (`apps/desktop/app.go:715-724`), so an on/off setting is a two-value `choice`; the UI `kind` union also has `'text'` (`apps/ui/src/api/contracts/system.ts:7`). Settings categories `ManuscriptGuide` ("Story Bible") and `Piper` ("TTS") already exist with global and project scope (`Settings.tsx:18-20`).
- **Existing conventions to reuse:** optional data is an asset, not a startup dependency, provisioned through a hashed catalog after the user chooses Download; dictionaries are named explicitly as assets (`docs/architecture/first-use-dependency-provisioning.md:46-49`). License classes: GPL allowed only as a separate process, non-commercial or unclear not approved (`local-dependency-evaluation.md:77-85`).

Stale sibling briefs (no PRD, verified shipped):

- `standalone-launch.md` (classification: STALE-SHIPPED, was marked "Planned"; kept and now marked Implemented by the docs-replacement change, as an implemented-feature spec whose section 3 packaging plan is still open): bindings `ProjectSelectFolder/Switch/Create/Recents/RemoveRecent` (`apps/desktop/bindings.go:175-249`), recents store (`apps/desktop/internal/recents/store.go`; file `%APPDATA%/narration-utils/recent-projects.json` via `apps/desktop/app.go:100-108`, entries `{path, name, lastOpened}`, capped at 10, case-insensitive dedupe, stale folders pruned, corrupt file self-heals), `ProjectPicker` shown when `projectFolder` is empty (`apps/ui/src/App.tsx:156`), user-facing description in `docs/guides/using-the-app/getting-started.md`, NSIS build flag (`.github/workflows/_build-native.yml:22`, `-nsis`), icon (`apps/desktop/build/windows/icon.ico`, `appicon.png`). Two brief points were implemented differently on purpose: "Create new" only makes the folder (`bindings.go:223`) and the `narration-utils/` sidecar folders are created lazily by each writer (`guide/service.go:152`, `manuscript/service.go:332,366`, `settings/store.go:173`), and no REAPER-specific scaffolding exists (the host attaches with `daw` `"Standalone"`, `bindings.go:202`). No unimplemented residue is unrecorded: the installer, Start Menu entry and desktop shortcut are `release-readiness-provisioning-and-docs-site.prd.md` Phase 14 (which still cites the brief's section 3 as its source), and macOS/Linux installers are deferred by the roadmap. Answered from the Wails v2.16.0 source in the module cache: `-nsis` writes the embedded default `project.nsi` when the project has none (`pkg/commands/build/nsis_installer.go:29-33`, `pkg/buildassets/buildassets.go:50-55`), and that template creates both a Start Menu and a Desktop shortcut unconditionally (`pkg/buildassets/build/windows/installer/project.nsi:99-100`); it only warns and skips the installer when `makensis` is missing (`nsis_installer.go:53-54`). Not verified: that the CI runner has `makensis` or that a built installer actually appears in a release (the published Windows asset is reported as a bare executable, release-readiness Evidence). The brief stays, so its inbound references remain valid: `apps/desktop/internal/tracks/tracks.go:6-7`, and `release-readiness-provisioning-and-docs-site.prd.md` Phase 14 and Open Question 10 (Phase 12 no longer has a status edit to make).
- `story-bible-readonly-views.md` (classification: STALE-SHIPPED; removed by the docs-replacement change, since nothing else cites it and ADR 0018 plus `docs/guides/using-the-app/story-bible.md` now hold the behavior; recoverable with `git show d5cc994:docs/architecture/story-bible-readonly-views.md`): ADR 0018 is Accepted; `GuideDetail.tsx:55` (`editing` state), `:112` (`editingDisabled`), `:287-330` (Edit, Save, Cancel). The implemented design keeps one form with disabled controls instead of rendering `EntitySummary` as the primary view (`EntitySummary` is used for the "Review entry" overlay, `:864`); the brief's open question is answered by ADR 0018 ("selecting a different entry always starts read-only"). Its "read-only because locked versus not yet in edit mode" distinction is implemented: a locked entry shows a lock toggle, a "Locked entries cannot be deleted or used as merge sources" notice and neither Edit nor Save (`GuideDetail.tsx:268-300,355-359`). The only brief idea not adopted is `EntitySummary` as the primary read view; the disabled-form design supersedes it and no ADR records the rejection.

## Proposed Solution

Deliver in value/risk order, MVP first. MVP = N (host sender, an on/off setting, OS notification only when the window is unfocused and a job ran at least about 10 s) and B (opt-in "build the Story Bible after import" setting plus per-import checkbox, chained after import success so a build failure never reads as an import failure). Later, gated on evidence or a decision: I (subtitle override in the import review, only once real manuscripts show the heuristic failing), then D and P, each preceded by a docs-only spike that must resolve a blocking unknown (dataset license and lookup engine for D; what a "provider" means and whether Piper can speak chosen phonemes for P) before any code. D stays local-only; a cloud dictionary API is not assumed and needs an explicit decision.

## Key Hypothesis

- **N**: We believe an OS notification, sent only when the window is unfocused after a job of about 10 s or more, will close the "did it finish?" gap for narrators who alt-tab to REAPER during builds and multi-hundred-MB downloads. We'll know we're right when a build or download that finishes while the window is unfocused raises exactly one notification and never fires while the window is focused.
- **B**: We believe an opt-in build after import will remove a manual step for narrators who always build right after importing. We'll know we're right when import with the option on ends with seeded characters and extracted entities coexisting and a build failure is reported separately from a successful import.
- **I**: We believe a per-heading subtitle override will fix wrong title/subtitle splits for manuscripts the heuristic misreads. We'll know we're right when, on the evidence corpus (Phase 4), the override corrects every recorded misread without changing correctly read headings. If Phase 4 finds no failures, we don't build it.
- **D**: We believe a local select-and-look-up panel will save narrators leaving the app for vocabulary they do not know. We'll know we're right when a selected word returns definition and synonyms in under 250 ms offline, from a dataset whose license and provenance pass the dependency policy.
- **P**: We believe a narrator-chosen pronunciation that the preview actually speaks will cut repeat rerecords of invented names. We'll know we're right when changing a name's pronunciation changes the audible preview and survives a Story Bible rebuild.

## What We're NOT Building

- PRDs for `standalone-launch.md` (kept, marked Implemented) and `story-bible-readonly-views.md` (removed; ADR 0018 holds it) - already shipped (Evidence).
- A cloud dictionary, thesaurus or pronunciation API as default or fallback - violates the local-first boundary; only an explicit user decision (Open Questions) could allow it.
- A persistent or long-lived Python sidecar server for lookups - `docs/architecture/codebase-map.md` forbids adding a Python server; D reads local data from Go.
- A generic settings framework or new settings `kind` for these toggles - a two-value `choice` is enough.
- Provider choice that only changes printed IPA - it would change nothing the narrator hears (P is blocked on the preview finding).
- Any auto-import or auto-build without the user's setting - ADR 0019 (offer, never do silently) is the spirit; B is opt-in.
- Notification action buttons, categories, reply fields and macOS/Linux behavior - Windows-first; plain title and body only.
- The interaction-feedback audit itself and dialog modality/`WorkDialog` accessibility - separate work ([interaction feedback](../architecture/interaction-feedback.md), delivered by stack S14; the dialog work is delivered, [ADR 0048](../adr/0048-every-dialog-is-one-modal-shell-and-confirms-are-alert-dialogs.md) and [ADR 0057](../adr/0057-a-running-job-that-cannot-be-cancelled-keeps-its-dialog-blocking-and-says-so.md)).
- Choosing REAPER-side or Lua changes - none of the five needs `integrations/reaper`.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| N: notifications sent while the window is focused | 0 | Vitest with `document.hasFocus` stubbed; Go test with a fake sender |
| N: notification per qualifying completion when unfocused | exactly 1 per job (build, install, comparison, import) | Same tests plus a manual Windows run (Focus Assist on and off) |
| N: silent failure | A sender error never surfaces in the UI and never blocks | Go test forcing an error; UI toast still shown |
| N: registry write only when needed | `InitializeNotifications` not called until the first qualifying send with the setting on | Go test on the wrapper; manual `regedit` check |
| B: seeded and extracted entities coexist after import plus build | 100% on the Alice fixture and one real manuscript | Manual end-to-end plus a Go test with a fake sidecar for sequencing |
| B: build failure after successful import | Import reported success, build reported separately | Vitest with a rejecting `guideBuild` |
| B: measured build duration recorded | On the Alice fixture and one full-length manuscript, p50 of 5 runs | Recorded in the Phase 3 PR description |
| I: evidence corpus | At least 3 real manuscripts reviewed, misreads listed with counts | Phase 4 write-up in a new `docs/research/import-heading-misreads.md` (the brief that would have held it is removed) |
| I: override correctness | Every recorded misread fixable, zero regressions in `apps/desktop/internal/importer` fixtures | Go importer tests plus Vitest |
| D: dataset gate | License, size, immutable URL and SHA-256 recorded before any download | Dependency record in `local-dependency-evaluation.md` |
| D: lookup latency | p95 under 250 ms for a cached-on-disk local lookup | Go benchmark on the chosen index |
| P: spike outcome | A written decision on what "provider" means and whether Piper speaks chosen phonemes | Phase 9 write-up plus ADR |
| P: override survives rebuild and locked-entry rules | Yes; `edit()` rejects a change on a locked entry (ADR 0007) | Python tests in `sidecars/manuscript-guide/tests/` |
| All UI phases: visual verification | PNGs reviewed at desktop, small-desktop, tablet, mobile | Playwright visual suite per `CLAUDE.md` |

## Open Questions

- [x] **N1. Where is "the user is not looking" decided?** Options: (a) webview decides with `document.hasFocus()` and calls a new `SystemNotify` binding (host API bump); (b) host always notifies on job completion (no focus query exists in Wails v2.16, so it would notify while the user watches); (c) frontend reports focus changes to the host. **Decided: (a)**, the recommendation. Delivered: `hostAPIVersion` 13 to 14 (`apps/desktop/{app.go,app_test.go}`, `apps/ui/src/hostApi.ts`); the App-level `subscribeJobEnded` handler (ADR 0076) reads `document.hasFocus()` fresh for every job end, so this is app-wide, not page-scoped.
- [x] **N2. Default and consent.** Options: (a) on by default, opt-out in Settings, sent only when unfocused; (b) off by default, opt-in; (c) on with a one-time in-app explanation. Wails needs no OS consent prompt on Windows (`RequestNotificationAuthorization` returns true, `windows/notifications.go:156-158`) but initialization writes a per-user registry key. **Decided: (a) per owner decision D8** (notifications on by default): `General.notifications` defaults `true` (`config/defaults.json`, `builtinDefaults`); `SystemNotify` initializes the Wails notification service lazily, only on the first send while the setting is on (`apps/desktop/notifications.go`).
- [x] **N3. Which events notify?** Options: (a) Story Bible build only; (b) build, model/voice downloads, Transcript Compare, import with chained build; (c) everything that toasts. **Decided: (b)**, the recommendation, at a 10s threshold (`apps/ui/src/jobEnded.ts`'s `shouldNotifyForJobEnd`, `NOTIFY_THRESHOLD_MS`). A manuscript import that chains a Story Bible build (D8, B1-B3) still only notifies through its own `story_bible` job:ended event, once that job itself clears the threshold; a fast import stays quiet on its own account like every other kind.
- [x] **N4. Toast identity on Windows.** The AppID is the executable base name (`windows/notifications.go:66,88`), so dev builds show `narration-utils-shell.exe`-style names. Options: (a) accept for dev, verify the installed build shows "Narration Utils"; (b) set explicit app data. **Decided: (a)**, the recommendation; not yet verified — needs an installed build and a manual click-to-raise check (owner step, tracked in issue #280). **Settled:** (a), confirmed by the owner 2026-09-23; the installed-build check stays open on issue #280 as owner verification.
- [x] **B1. Default for build after import.** Options: (a) off; (b) on. Recommendation: (a) until the measured build time is short enough and the user has run it on a real book. **Decided: (b), per owner decision D8**, which explicitly overrides this PRD's own recommendation: build after import is on by default (`ManuscriptGuide.build_after_import` defaults `true`). Real build-duration measurement on the Alice fixture and a full-length manuscript was not done in this stack (needs a real host session); recorded as a pending owner-adjacent step rather than blocking the default.
- [x] **B2. Where the setting lives.** Options: (a) Settings Story Bible category default (global and project scope) plus a per-import checkbox pre-filled from it; (b) global only; (c) per-import only. **Decided: (a)**, the recommendation. Delivered: `ManuscriptGuide.build_after_import` (global/project scope like every other setting) plus a per-import `Checkbox` in `ImportReview.tsx`'s existing seam (S18, ADR 0086), pre-filled by Home reading `settingsForScope('global')` once.
- [x] **B3. Who chains the build.** Options: (a) UI: after import success and bootstrap refresh, call `api.guideBuild()` and show a second phase in the same import `WorkDialog`; (b) host: a binding signature change. **Decided: (a)**, the recommendation. Delivered in `Home.tsx`: on import success the import dialog closes itself (as a successful Story Bible rebuild already does, ADR 0076) and, when checked, `api.guideBuild({})` starts, tracked in its own `WorkDialog` ("Build the Story Bible") until the host's own `job:ended` event announces it; a build failure is its own toast and never unmakes the reported import success. The `useWorkJob` extraction from `Guide.tsx` this phase's "Should" row asked for was not done (Home's poll effect duplicates Guide's shape instead); filed as a follow-up rather than risking the existing Guide.tsx build flow in this pass.
- [x] **I1. Is there evidence to justify I?** Options: (a) the user supplies 3 or more manuscripts with wrong title/subtitle splits and Phase 4 documents them; (b) defer I until such manuscripts appear; (c) build it now on speculation. Recommendation: (a) or (b); not (c). Please say whether such manuscripts exist. **Answered 2026-09-23: (c), build it anyway**, overriding the recommendation. Phase 4 is no longer an evidence gate: it documents the title/subtitle heuristic's failure modes from constructed cases rather than owner-supplied manuscripts, and Phase 5 builds the override.
- [x] **I2. Override granularity, if built.** Options: (a) per-heading in the review list; (b) one global toggle; (c) both, global default plus per-heading. Recommendation: (c), starting from the heuristic's current guess. **Answered 2026-09-23: (c)**: a global default plus a per-heading override in the import review list, each row starting from the heuristic's current guess.
- [x] **D1. Cloud or local dictionary?** Options: (a) local dataset only, provisioned as an asset after a user Download; (b) cloud API; (c) local default with an opt-in cloud lookup. **Decided: (a), per owner decision D1 and this PRD's own recommendation.** No cloud API, no key management, no privacy exception.
- [x] **D2. Scope.** Options: (a) single-word definitions plus synonyms and antonyms from one dataset, US English; (b) add phrases; (c) definitions only. **Decided: (a)**, the recommendation. Dataset chosen: **Open English WordNet (OEWN), 2025 Edition, CC BY 4.0** — see [ADR 0097](../adr/0097-the-manuscript-reader-word-lookup-uses-the-open-english-wordnet-as-a-downloadable-asset.md) (Proposed) and the dependency record in [local dependency evaluation](../research/local-dependency-evaluation.md), candidate 11. Princeton WordNet (same permissive class, stale since 2011) and Wiktionary extracts (share-alike, not yet a reviewed licence class) were compared and not chosen. Exact size and pinned SHA-256 are Phase 7 work (deferred, not built by this stack).
- [x] **P1. What does "provider" mean?** Options: (a) a second local engine; (b) a narrator-edited project pronunciation dictionary; (c) a hosted IPA API; (d) no provider at all: make the preview speak narrator-authored phonemes or respellings. **Decided: (b) plus (d)**, the recommendation, per owner decision. See [the pronunciation provider spike](../research/pronunciation-provider-spike.md) and [ADR 0091](../adr/0091-story-bible-pronunciation-is-a-narrator-edited-value-the-preview-speaks-directly.md) (Proposed): Piper's phoneme-input API (`phonemize`/`phonemes_to_ids`/`phoneme_ids_to_audio`, confirmed against the upstream source) can make the preview speak an edited pronunciation instead of the spelled name, but the `cmu` (ARPABET) source's compatibility with Piper's phoneme IDs is not yet trial-verified — Phase 10's job, not this spike's.
- [x] **P2. GPL exposure check.** `phonemizer` and eSpeak NG are GPL upstream and are imported in-process by the frozen Guide sidecar. Options: (a) schedule the review before adding any further engine; (b) leave as is. **Decided: (a)**, the recommendation. This PRD adds no new engine (P1 reuses the existing `cmu`/`espeak` sources and Piper, already recorded as GPL-3.0-or-later in [model provenance](../architecture/model-provenance.md) under owner decision D17), so no new licence review is triggered now; the review is a standing checklist item for whichever later stack adds a genuinely new engine.
- [x] **X1. Sequencing against the host-binding fix.** Phases 1 (`SystemNotify`), 5 (commit signature) and 7 (lookup binding) add bindings while the host binding concurrency work (`docs/architecture/host-binding-concurrency.md`, delivered by stack S03 ahead of this PRD) rewrote nearly all of `apps/desktop/bindings.go`; the accessor has landed, so (a) applies. Options: (a) land the accessor phase first and write new bindings on it; (b) write new bindings with an inline snapshot under `h.mu.RLock` and rebase. Recommendation: (a) if its Phase 1 merges first; otherwise (b), never reading service fields directly. **Settled:** (a), by the landed snapshot accessor ([ADR 0041](../adr/0041-host-bindings-read-project-services-through-one-snapshot-accessor.md), `h.services()` in `apps/desktop/services.go`): the new bindings in Phases 5 and 7 are written on `h.services()`; `SystemNotify` (`apps/desktop/notifications.go`) only snapshots `h.ctx` under `h.mu.RLock` and reads settings through `h.services()`.

## Users & Context

**Primary User**
- **Who**: an independent audiobook narrator or self-producer preparing and recording a book, in the standalone app or launched from REAPER; Windows first, US English first.
- **Current behavior**: imports a manuscript, then finds and clicks the Story Bible build manually; alt-tabs to REAPER during long jobs and returns to check; leaves the app to look up unfamiliar words; sees a printed IPA for a name but hears the preview say the spelled name.
- **Trigger**: a fresh manuscript import; a long build or download; an unfamiliar word or invented name in the text.
- **Success state**: import leads straight to a built Story Bible when wanted; an unfocused finish raises one notification; a lookup or a corrected pronunciation is one action away and works offline.

**Job to Be Done**: When I finish importing and reading a manuscript, I want the prep work (Story Bible, vocabulary, pronunciations) to happen or be one click away and to tell me when it is done, so I can record without hunting for state or leaving the app.

**Non-Users**: developers and REAPER-only users who never open the app; narrators who want cloud sync or AI-authored definitions (outside the local-first boundary).

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Cap |
| --- | --- | --- |
| Must | Go notification wrapper: lazy init, silent failure, injectable sender | N |
| Must | `SystemNotify` binding, `General.notifications` on/off setting, contract, mock | N |
| Must | Send only when unfocused and the job ran at least about 10 s | N |
| Should | Same wiring at Story Bible build, TTS and Whisper install, Transcript Compare and import completion | N |
| Could | Toast identity check on an installed build, click-to-raise verified | N |
| Won't | Actions, categories, macOS/Linux behavior | N |
| Must | Setting `ManuscriptGuide.build_after_import` plus per-import checkbox pre-filled from it | B |
| Must | Chain `guideBuild` only after import success and after seeding finishes; failure reported separately | B |
| Should | Shared `useWorkJob` hook extracted from `Guide.tsx` so Home and Guide share polling | B |
| Should | Recorded build duration and the default decision | B |
| Could | Host-side chaining (`buildStoryBible` parameter) | B |
| Must | Documented heading and subtitle failure modes from constructed cases (I1: no longer an evidence gate) | I |
| Should | `subtitleOverrides` in `ManuscriptImportSelection`, applied before canonicalization (the subtitle in the preview payload and its display in the review were delivered by the import review redesign, see [the import review](../architecture/import-review.md)) | I |
| Should | Global "second line is subtitle" default that each per-heading override starts from (I2) | I |
| Won't | Other import settings not motivated by evidence | I |
| Must | Spike: dataset, license, size, lookup engine, provisioning shape (docs plus ADR) | D |
| Should | Go lookup package over a provisioned index, binding, "Look up" action and overlay panel | D |
| Could | Pronunciation of the looked-up word from the vendored CMU dictionary | D |
| Won't | Cloud lookup, phrases, non-US English | D |
| Must | Spike: meaning of "provider", Piper phoneme input, GPL review, accuracy on real names | P |
| Should | Narrator-authored pronunciation stored via `edit()` (locked entries still rejected) and preserved by `merge_locked` | P |
| Should | Preview speaks the chosen pronunciation | P |
| Could | Second local engine behind a provider seam, per-entry (entity and alias) "try another provider", default-provider setting (Settings Story Bible category or a new "Pronunciation" category) | P |
| Won't | Hosted IPA API | P |

### MVP Scope

Phases 1 to 3 (N and B) plus the three docs-only phases 4, 6 and 9 that de-risk the rest. D and P implementation phases wait for their spikes; I is built (owner decision I1, 2026-09-23) after its docs-only Phase 4.

### User Flow

- **N**: user starts a build and switches to REAPER; the build finishes at 40 s; the toast still appears in-app and one OS notification "Story Bible rebuilt" appears; clicking it raises the window.
- **B**: user opens the import review, sees "Build the Story Bible after import" pre-filled from Settings, imports; the dialog shows import success, then a second progress phase for the build; if the build fails, "Manuscript imported. Story Bible build failed: ..." with the manual build button unchanged.
- **I**: the review offers a global "second line is subtitle" default and lists each multi-line heading with its guessed title and subtitle and a per-heading toggle starting from the heuristic's guess; commit applies the overrides.
- **D (later)**: select a word in the reader, choose "Look up", an overlay shows definition and synonyms from the local dataset.
- **P (later)**: in edit mode the narrator changes a name's pronunciation, plays the preview, hears the change; rebuild keeps it.

## Technical Approach

**Feasibility**: N HIGH; B HIGH (all parts exist, sequencing is the care point); I MEDIUM (importer, preview payload and a binding signature change, evidence-poor); D MEDIUM (dataset provenance and a Go index are new; no Python); P LOW-MEDIUM (unknown Piper phoneme input, GPL review, storage design).

**Architecture Notes**
- **N**: new small Go type wrapping `runtime.InitializeNotifications/IsNotificationAvailable/SendNotification` behind an interface so tests use a fake; snapshot `h.ctx` under `h.mu.RLock` as `ProjectSelectFolder` does (`apps/desktop/bindings.go:175-181`); read the setting through the settings store. Frontend: an App-level helper called next to the existing `notify(...)` toast; `document.hasFocus()`; `SystemNotify` added to `NarrationApi`, `wailsClient.ts`, `mockApi.ts`. New binding means `hostAPIVersion` bump in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:40-41`, `apps/ui/src/hostApi.ts:2` plus regenerated `apps/ui/wailsjs/go/main/Host.{js,d.ts}`.
- **B**: extract the poll loop in `Guide.tsx:77-102` into `useWorkJob`; Home starts `api.guideBuild()` after `importJob.phase === 'success'` and the bootstrap refresh (`Home.tsx:83`); setting added to `fieldSchemas` (`apps/desktop/app.go:673-679`) as `choice` on/off; checkbox in the review `ConfirmDialog`. Do not overlap seeding (`bindings.go:316-326`) and build; the post-commit hook already finishes before success is reported.
- **I**: extend `Draft`/preview with per-chapter subtitle, `ManuscriptImportSelection.subtitleOverrides` (`contracts/manuscript.ts:61-64`; the brief's suggested shape `Record<string, boolean>`, keyed by heading, true meaning "second line is a subtitle", feeding `Paragraph.ChapterSubtitle` before commit), thread through `ManuscriptImportCommit` (signature change, API bump) and `apps/desktop/internal/manuscript/service.go` `runCommit`.
- **D**: asset entry in a new catalog following `apps/desktop/internal/assets` and the Whisper/TTS pattern (`first-use-dependency-provisioning.md`), registered through `release-readiness-provisioning-and-docs-site.prd.md` Phase 3's aggregated asset catalog (provider registry, `AssetsList`) so it appears on the "Manage local assets" page instead of a parallel catalog (if that phase has not landed, use the existing manager unchanged and migrate later), Go reader package, `SystemLookup`-style binding, `SelectionMenu.tsx` action, overlay via the existing `SlideOver`/overlay pattern (the brief also considered a tooltip-style popover and preferred the overlay for a long definition and synonym list; `docs/design/design-system.md:35` makes a non-destructive "peek at something else" a `SlideOver`, as the Chapters and Search and "Review entry" overlays already do). Data-format and index choice TBD - needs research (avoid new cgo).
- **P**: a Python-side provider seam the brief sketched (a `PronunciationProvider` protocol with `pronounce(name) -> Pronunciation`; the existing CMU-then-eSpeak chain in `pronunciation()` becomes the default implementation) is only worth adding once Phase 9 names a second provider; new `pronunciation` field handling in `edit()` (`manuscript_guide.py:800-845`, the ADR 0007 choke point), a `merge_locked` extension (`:681-695`), UI action inside edit mode (ADR 0018 says read-only actions are preview/rescan/lock/delete; a mutating pronunciation change belongs in edit mode), and a preview path that can speak phonemes or respelling (TBD - needs research).
- **Lock ordering**: every new binding snapshots service pointers and releases before calling into a service (see `docs/architecture/host-binding-concurrency.md`).

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Windows toast identity, activation relaunch or Focus Assist suppresses notifications | Medium | Manual installed-build check; toast is always the in-app record; failure is silent |
| Registry write at initialize surprises users | Low | Lazy init, documented in Settings copy, opt-out |
| Build after import is slow on long manuscripts | Medium | Opt-in default off, measured duration before changing the default, real progress only (ADR 0015) |
| Seed and build overwrite the same JSON | Medium | Strict sequencing; build only after the commit job reports success |
| Host API bump collisions across concurrent PRDs (`hostAPIVersion` 5 to 6 to 7; `teleprompter-manuscript-integration.prd.md` Phase 3 and `review-dashboard-and-findings-adoption.prd.md` also plan 5 to 6) | High | One bump per phase; whichever PR lands second increments again; check `hostAPIVersion` at merge time; note in each PR |
| `fieldSchemas` and `Settings.tsx` edited by several PRDs | High | Small additive hunks, rebase; see compatibility table |
| Dataset license unclear (share-alike, GPL) or too large | Medium | Provenance gate before any download; asset provisioning with SHA-256; spike decides |
| Provider work delivers no audible change | High as briefed | Phase 9 spike must prove preview can speak chosen output before Phase 10 starts |
| GPL engines already in-process in the frozen sidecar | Medium | Open question P2; license review before any further engine |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Notifications: host sender and setting | Go wrapper, `SystemNotify` binding, `General.notifications` bool, contract, mock, API bump 13 to 14, tests | complete | 3, 4, 6, 9 | - | - |
| 2 | Notifications: completion wiring | App-level unfocused-only helper next to existing toasts for build, installs, comparison, import; 10 s threshold; visual states | complete (states not yet PNG-reviewed; General category was already covered by the settings-mobile-layout stack S12b atlas) | 4, 6, 9 | 1 (delivered by S14: the `job:ended` event, [ADR 0076](../adr/0076-a-host-job-ends-with-one-job-ended-event-the-app-announces-it-and-the-story-bible-rebuild-may-continue-in-the-background.md), carries kind, outcome, message and duration; read `document.hasFocus()` in the webview) | - |
| 3 | Build after import | Setting, per-import checkbox, `useWorkJob` extraction, chained build, failure isolation, duration measurement, visual states | partial: setting, checkbox, chained build and failure isolation delivered; `useWorkJob` extraction (a "Should") and real duration measurement not done, filed as follow-ups; states not yet PNG-reviewed (fast-lane, confirming from PR CI) | 1, 4, 6, 9 | - | - |
| 4 | Import heading failure modes | Document the title/subtitle heuristic's failure modes from constructed cases in a new `docs/research/import-heading-misreads.md` (docs only; not an evidence gate, I1) | pending | all | - | - |
| 5 | Import subtitle override | Global default plus per-heading `subtitleOverrides` (I2), commit path, review UI, API bump, visual states | pending | 6, 9 | 4 (constructed cases as fixtures) | - |
| 6 | Dictionary spike | Dataset candidates, license and provenance gate, size, lookup engine, provisioning shape; dependency record and ADR (docs only) | complete: Open English WordNet chosen (ADR 0097, Proposed); exact pinned URL/SHA-256/size deferred to Phase 7 (not built by this stack) | all | - | - |
| 7 | Dictionary backend | Asset catalog entry, Go reader, `SystemLookup` binding, tests, API bump | pending | 4, 9 | 6 (soft: release-readiness Phase 3) | - |
| 8 | Dictionary UI | "Look up" action in `SelectionMenu`, overlay panel, states, Playwright and PNG review | pending | 4, 9 | 7 | - |
| 9 | Pronunciation spike | Provider meaning, Piper phoneme input, GPL review, accuracy on real names; ADR (docs only, may run scratch code out of tree) | partial: provider meaning and GPL review decided (ADR 0091, Proposed); Piper's phoneme-input API confirmed to exist against the upstream source, but accuracy on real names was not trial-run (no scratch code executed this stack) — filed as a follow-up for whoever starts Phase 10 | all | - | - |
| 10 | Narrator pronunciation storage and preview | `edit()` field, `merge_locked` extension, preview speaks the choice, Python and Go tests | pending | 4, 6 | 9 | - |
| 11 | Pronunciation UI and default provider | Edit-mode control, optional "try another engine", default setting, visual states | pending | 4, 6 | 10 | - |

### Phase Details

**Phase 1 - Notifications: host sender and setting**
- **Goal**: the host can raise one OS notification safely, only when enabled.
- **Scope**: new Go file wrapping the Wails runtime API behind an interface; lazy `InitializeNotifications` once; swallow errors; `SystemNotify(kind, title, body)` binding; `General.notifications` (`on`/`off`) in `fieldSchemas`; `NarrationApi`, `wailsClient.ts`, `mockApi.ts`; bump `hostAPIVersion` in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:40-41`, `apps/ui/src/hostApi.ts:2`, regenerate `Host.{js,d.ts}`; Settings copy about the registry key. Snapshot `ctx` and settings through the host snapshot pattern.
- **Success signal**: Go tests with a fake sender (disabled means no init and no send; error means no surfaced failure); visual PNGs of the Settings General category at four viewports reviewed.

**Phase 2 - Notifications: completion wiring**
- **Goal**: each long job produces one OS notification when the user is away.
- **Scope**: helper that checks `document.hasFocus()` and elapsed time; called with `notify(...)` at build success/failure (`Guide.tsx:82-98`), install completions (`GuideDetail.tsx:152-172`, `Transcript.tsx`, `TeleprompterPage.tsx`), transcript completion, import completion. If interaction-audit phase 5 (App-level completion) has landed, subscribe there instead of per page.
- **Success signal**: Vitest matrix (focused/unfocused, fast/slow job); manual Windows check with the window minimized.

**Phase 3 - Build after import**
- **Goal**: an opt-in one-step import plus build.
- **Scope**: `ManuscriptGuide.build_after_import` in `fieldSchemas`; checkbox in the review dialog (`Home.tsx` review `ConfirmDialog`); `useWorkJob` extracted from `Guide.tsx` and reused; chained `api.guideBuild()` after success and refresh; second phase in the dialog; failure message keeps the import successful; record build duration (Alice fixture and one long manuscript) in the PR; manual end-to-end with checked candidates.
- **Success signal**: seeded and extracted entities coexist; build failure leaves import success visible; a test pins the Guide build flow before the hook is extracted (one exists now: the App test "closes the rebuild dialog by itself once the host reports the build done") and stays green after the extraction.

**Phase 4 - Import heading failure modes**
- **Goal**: document where the title/subtitle heuristic goes wrong so Phase 5's override has fixtures. The owner chose to build I without owner-supplied manuscripts (I1, 2026-09-23), so this phase no longer decides whether I is built.
- **Scope**: construct manuscripts whose headings exercise the heuristic's failure modes (for example a one-line title followed by an epigraph, a two-line title with no subtitle, a subtitle the heuristic misses), run the import preview on them, tabulate the wrong splits in `docs/research/import-heading-misreads.md`, and record where the split lives now (`headings.go:90-97`, not `docx.go`) so the removed brief's stale claim is not reintroduced.
- **Success signal**: a counted list of failure modes, each with a constructed case Phase 5 can use as a fixture.

**Phase 5 - Import subtitle override**
- **Note**: showing each section's subtitle in the review was split out and delivered by [the import review](../architecture/import-review.md) (its phase 2: `DraftSection.subtitle`, no binding change, `hostAPIVersion` unchanged). This phase keeps only the override, no longer gated on evidence (I1); the rows in the review already leave room for a trailing control.
- **Goal**: correct wrong splits before commit.
- **Scope**: a global "second line is subtitle" default plus per-heading `subtitleOverrides` in the import review list, each row starting from the heuristic's current guess (I2) (the preview payload already carries each section's `subtitle`, delivered by the import review redesign, see [the import review](../architecture/import-review.md)); new bindings written on `h.services()` (X1); apply in commit before canonicalization; `ManuscriptImportCommit` signature change; contract, client, mock; review UI extending the existing dialog (no second settings step); API bump.
- **Success signal**: each Phase 4 constructed failure case fixable from the review list; importer fixtures unchanged for correct headings.

**Phase 6 - Dictionary spike**
- **Goal**: a dataset and lookup design that passes the policy.
- **Scope**: compare candidates on license class, size, US coverage, definition plus synonym completeness, load time; write the dependency record; ADR for local-only lookup.
- **Success signal**: a chosen artifact with immutable URL and SHA-256, or a recorded "no acceptable local dataset".

**Phase 7 - Dictionary backend**
- **Goal**: offline lookup from Go.
- **Scope**: catalog entry and provisioning (selecting never downloads; registered as a provider in release-readiness Phase 3's aggregated catalog, not a parallel one), reader package, binding written on `h.services()` (X1), tests, API bump.
- **Success signal**: p95 under 250 ms; missing asset triggers the standard download prompt.

**Phase 8 - Dictionary UI**
- **Goal**: one-action lookup in the reader.
- **Scope**: `SelectionMenu` action, overlay panel, states in `state-catalog.ts` and drivers.
- **Success signal**: PNGs at four viewports reviewed; keyboard reachable.

**Phase 9 - Pronunciation spike**
- **Goal**: define the feature before building it.
- **Scope**: what a provider is; can Piper synthesize supplied phonemes; accuracy, latency and licensing of CMU vs eSpeak vs a candidate on real invented names (the brief's spike criteria); GPL review of phonemizer/eSpeak in the frozen sidecar.
- **Success signal**: decision and ADR, or "defer".

**Phase 10 - Narrator pronunciation storage and preview**
- **Goal**: a pronunciation the narrator sets is stored, survives rebuild, and is audible.
- **Scope**: `edit()` handles the field and still rejects locked entries (ADR 0007); `merge_locked` preserves it; `guide.Preview` uses it; tests including rebuild.
- **Success signal**: change, preview and rebuild round trip in tests.

**Phase 11 - Pronunciation UI and default provider**
- **Goal**: expose it.
- **Scope**: edit-mode control in `GuideDetail.tsx` (ADR 0018) for the entity and each alias (the brief's "try another provider" next to the preview button, persisted so a rebuild does not clobber it), settings default in the Story Bible category or a new "Pronunciation" category, states, PNG review.
- **Success signal**: PNGs reviewed; ADR 0018 read-only-until-Edit behavior intact.

### Parallelism Notes

Phases 4, 6 and 9 are docs-only and can run alongside anything. Phases 1 and 3 touch different files except `fieldSchemas`; they can run together with a small rebase. Phase 2 and Phase 3 both edit `Guide.tsx` and `Home.tsx`, so sequence 3 before 2 or accept rebases. Phases 7-8 and 10-11 are chains.

### Parallel-session compatibility

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | new Go notifier file, `apps/desktop/{app.go,bindings.go,app_test.go}`, `apps/ui/src/{hostApi.ts,api/wailsClient.ts,api/mockApi.ts,api/contracts/system.ts}`, `apps/ui/wailsjs/go/main/Host.*`, `Settings.tsx` copy | Every phase or PRD that adds a binding (host API version), the delivered host accessor (write the new binding on `h.services()`), other `fieldSchemas` editors (teleprompter, diagnostics PRDs) |
| 2 | `Guide.tsx`, `GuideDetail.tsx`, `Transcript.tsx`, `TeleprompterPage.tsx`, `Home.tsx`, `App.tsx` | the delivered interaction feedback work (`usePendingAction`, `job:ended`, the toast queue: same completion sites), teleprompter-engines phase 4 (`useAssetInstall`), release-readiness Phase 1 (install loops and job shape in `GuideDetail.tsx`, `Transcript.tsx`, `TeleprompterPage.tsx`), dialog modality work |
| 3 | `Home.tsx`, `Guide.tsx` (hook extraction), `apps/desktop/app.go` `fieldSchemas`, `Settings.tsx`, `mockFixtures.ts`, visual catalog | Phase 2 here, audit phase 5, other `fieldSchemas` editors |
| 4 | new `docs/research/import-heading-misreads.md` only | None |
| 5 | `apps/desktop/internal/{importer,manuscript}`, `apps/desktop/{bindings.go,app.go}`, `apps/ui/src/api/*`, `Home.tsx`, `hostApi.ts`, Wails bindings | Phase 3 (`Home.tsx`), any binding or API bump |
| 6 | `docs/research/local-dependency-evaluation.md`, ADR | ADR numbering; `local-dependency-evaluation.md` edits by other PRDs |
| 7 | `apps/desktop/internal/assets` and a new lookup package, `apps/desktop/{bindings.go,app.go}`, `config/*-assets.json` (new), API files | Any binding phase; release-readiness Phase 3 (aggregated asset catalog and provider registry: register the dictionary as a provider there rather than adding a parallel catalog) |
| 8 | `SelectionMenu.tsx`, `Manuscript.tsx`, overlay component, visual catalog and drivers, screenshots | Manuscript reader work (teleprompter-manuscript-integration phases 2, 4, 5, 7) |
| 9 | `docs/` only, scratch code outside the tree | ADR numbering |
| 10 | `sidecars/manuscript-guide/core/manuscript_guide.py` and tests, `apps/desktop/internal/guide/service.go`, `apps/desktop/bindings.go` | The delivered host accessor, audit phase 4 (`GuideEdit` batching touches the same functions), `manuscript_guide.py` edits |
| 11 | `GuideDetail.tsx`, `Settings.tsx`, `fieldSchemas`, mock, visual catalog | Audit phase 4 (Story Bible action feedback edits `GuideDetail.tsx`), dialog work |

Cross-cutting: every phase re-checks `docs/adr/` numbering immediately before writing an ADR (take the next free ADR number at merge time; 0027 at d5cc994); every phase that adds or changes a binding bumps `hostAPIVersion` in `apps/desktop/app.go:33`, `apps/desktop/app_test.go:40-41` and `apps/ui/src/hostApi.ts:2` and regenerates `Host.{js,d.ts}` (whichever PR lands second increments again; check `hostAPIVersion` at merge time); every `apps/ui` phase runs `visual-catalog-sync`, the Playwright visual suite with PNG review of `apps/ui/screenshots/app/<page>/<state>/<viewport>.png` at all four viewports, and `doc-screenshot-sync` (user-facing changes also update the matching page of the split guide under `docs/guides/using-the-app/`, for example `home.md`, `settings.md`, `story-bible.md`, `manuscript.md`; `apps/ui/src/docsGuide.test.ts` guards its links and screenshot embeds); primitives or `styles.css` changes also run the atlas and `design-spec-guard`; every phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD, `full-verification-gate` (`pnpm check`, not `check:fast`), `design-spec-guard`, `feature-cleanup`. Nothing merges without the user.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Local-first, no cloud processing (prior decision, `docs/roadmap.md`, `local-dependency-evaluation.md`) | D and P are local-only unless the user decides otherwise | Cloud dictionary or IPA API | Recorded product boundary |
| Windows-first, US-English-first (prior decision) | Windows notification path; US dictionary data | Cross-platform now | Standing scope |
| Real progress only (prior decision, ADR 0015) | Build-after-import shows the real build job, no faked percent | Placeholder progress | Recorded decision |
| Story Bible entries read-only until Edit; locked entries server-side enforced (prior decisions, ADR 0018, 0007) | Pronunciation changes happen in edit mode through `edit()` | A read-only "try another provider" button | Keeps the single enforcement point |
| Detected manuscript is offered, never imported silently (prior decision, ADR 0019) | Build after import is opt-in | Default-on auto build | Spirit of explicit consent for project writes |
| Optional data is a hashed, user-approved asset (prior decision, `first-use-dependency-provisioning.md`) | Dictionary dataset provisioned as an asset | Bundle in the installer | Existing policy, dictionaries named explicitly |
| Dependency license classes (prior decision, `local-dependency-evaluation.md:77-85`) | Provenance gate before any dictionary or engine; GPL only as a separate process | Adopt by default | Recorded policy |
| No Python server or browser transport (prior decision, `codebase-map.md`) | Lookup reads local data from Go | Persistent sidecar | Recorded boundary |
| Workflow and gates (prior decision, `CLAUDE.md`) | plan, impact scan, TDD, `pnpm check`, spec guard, cleanup; PNG review at four viewports | Fast check only | History of silent regressions |
| Nothing merges without the user (prior decision) | User merges every PR | Auto-merge | Standing rule |
| Two stale briefs get no PRD | `standalone-launch.md` (kept, marked Implemented) and `story-bible-readonly-views.md` (removed) reported | Write PRDs | Already shipped |
| Order and MVP | N, B first; I built after a docs-only failure-mode phase; D and P spike-first | Build in brief order; I evidence-gated | Value/risk; D and P have blocking unknowns; I1 owner decision 2026-09-23 removed I's evidence gate |
| Notification decision point (N1, decided) | Webview decides focus; `SystemNotify` binding | Host always notifies | No focus query in Wails v2.16; delivered in Phase 1 |
| Chain location for B (B3, decided) | UI-chained for MVP | Host-chained | No binding change, natural failure isolation; delivered in Phase 3 (`Home.tsx`) |
| On/off settings (delivered) | The `bool` field kind (`General.notifications`, `ManuscriptGuide.build_after_import` in `apps/desktop/app.go` `fieldSchemas`) | Two-value `choice` (this PRD's proposal); a new `toggle` kind | Settled by Phases 1 and 3 as delivered |
| Notifications on by default (owner decision D8, stack S19d) | `General.notifications` defaults `true`, opt-out, sent only when unfocused and the job ran 10s or more | Off by default (this PRD's own N2 option b) | D8 overrides the PRD's own N2 wording |
| Notification kinds and threshold (stack S19d) | `story_bible`, `tts_install`, `whisper_install`, `spacy_install`, `transcript_compare`, `manuscript_import`; 10s | Every toast; no threshold | N3, so a fast job stays quiet |
| Build after import on by default (owner decision D8, stack S19d) | `ManuscriptGuide.build_after_import` defaults `true` | Off by default (this PRD's own B1 recommendation) | D8 overrides B1's wording explicitly |
| Chained build's dialog handoff (stack S19d) | The import `WorkDialog` closes itself on success and a second `WorkDialog` ("Build the Story Bible") picks up the build's own progress | One persistent dialog object with an internal "phase 2" | Simpler, reuses `WorkDialog` and the existing `job:ended` completion toast unchanged; functionally sequential from the narrator's view |
| Pronunciation "provider" (stack S19d) | A narrator-edited project pronunciation dictionary, spoken directly by the preview (options b+d) | A second local G2P engine; a hosted IPA API | Owner decision; the preview already has the data, it just ignores it today |
| Toast identity (N4) | Accept the executable-name AppID for dev builds; verify "Narration Utils" on an installed build | Set explicit app data | Owner decision 2026-09-23; the installed-build check stays open on issue #280 |
| Build the subtitle override (I1) | Build I; Phase 4 documents failure modes from constructed cases | Wait for 3+ owner-supplied misread manuscripts; defer | Owner decision 2026-09-23, overriding the evidence-gate recommendation |
| Override granularity (I2) | Global default plus per-heading override in the import review list, starting from the heuristic's guess | Per-heading only; global toggle only | Owner decision 2026-09-23; a global default covers a book's house style, per-heading fixes the exceptions |
| Binding sequencing (X1) | New bindings in Phases 5 and 7 written on `h.services()` | Inline snapshot under `h.mu.RLock` and rebase | Settled: the snapshot accessor landed (ADR 0041) |

## Research Summary

**Market Context**
- No external market research was done; these are internal UX gaps. Windows toast notifications for unpackaged desktop apps normally need an AppUserModelID and a Start Menu shortcut or registry registration; Wails' Windows backend implements this with a registry activator key (per the module source read this session). Cross-check against current Windows toast guidance is TBD.

**Technical Context**
- Verified in code: Wails v2.16.0 notification API and Windows backend; Guide build job and post-commit hook; `merge_locked` behavior; import review controls; pronunciation chain and preview path; settings schema kinds; cold-start import timings (one machine, dev venv).
- Not verified: Piper phoneme-input support; frozen-sidecar startup cost; spaCy model load time; dictionary dataset licenses and sizes; whether the NSIS installer registers shortcuts; behavior of clicking a Windows toast under the single-instance lock.
- Discrepancies found while writing this PRD are listed in the hand-off message.

---

*Generated: 2026-09-19*
*Status: DRAFT - needs validation*
