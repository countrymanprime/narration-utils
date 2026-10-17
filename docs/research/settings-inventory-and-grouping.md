# Settings inventory and proposed grouping

Researched 2026-10-17 on `main` at `847c1d0`, tracking issue [#1817](https://github.com/countrymanprime/narration-utils/issues/1817). Counts and line numbers are for that commit and are not kept current. Rules cited as R-xxx are in [the best-practice note](settings-best-practice.md). The proposal is recorded as [ADR 0865](../adr/0865-settings-are-grouped-by-what-is-configured-with-a-scope-and-a-used-by-list-on-every-setting-and-a-model-list-that-owns-the-downloads.md) and drawn in the [Studio Next mock](mockups/studio-next/README.md#settings).

**Question.** Which settings exist, who reads each one, and where should each live so that a setting shared by several pages has one home?

**Method.** Read `fieldSchemas` in `apps/desktop/app.go` (lines 1540 to 1730), `apps/desktop/internal/settings/store.go`, `config/defaults.json`, the page in `apps/ui/src/components/settings/page/SettingsPage.tsx`, the guides and ADRs; then grepped Go, Python, Lua and the UI for each key's consumers. "No consumer" means no reader in `apps/`, `sidecars/` or `libs/`. Nothing was run in the app; rows marked *(unverified)* were read from code only.

## How it works today

- **Layers.** Every value is a string. A project value (`<project>/narration-utils/settings.json`) beats a global one (`%APPDATA%\narration-utils\global-settings.json`), which beats `config/defaults.json`, then a Go built-in map, then the caller's fallback (`Effective`, `store.go:45-58`). A save writes exactly one layer (`store.go:260-297`).
- **Scope in the host.** `saveSettings` refuses the other scope for `Updates`, `Teleprompter`, `Keymap`, `General.debug_logging` and `ManuscriptGuide.analysis_prompt` (global only) and `ReadAloud` (project only). Everything else the API accepts at either scope, even where the page offers only Global (`app.go:1802-1865`).
- **Scope in the page.** Each panel owns its own Global / This project switch and starts on Global (`ScopedFieldsPanel.tsx:61`). A non-number row shows the inherited value as if it were set, with no marker; a number row shows an "Inherits" placeholder; Reset exists only for a project override (`ScopedSetting.tsx:117-193`).
- **The page.** One route, one 860 px column of 27 panels, no navigation and no search. Panels 1 to 10 follow the Studio Next mock; panels 11 to 27 are older categories kept as built ([PRD](../prds/studio-next-master-delivery-and-settings.prd.md)). Only 17 of the 27 have an anchor.
- **Assets.** Seven providers sit behind one registry (`apps/desktop/assetregistry.go`, [ADR 0079](../adr/0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md), [ADR 0081](../adr/0081-local-assets-is-a-settings-list-built-from-the-registry-whose-rows-own-their-download-verify-and-remove.md)): TTS, Whisper, spaCy, Moonshine, dictionary, encoder and analysis tools. Six panels also show or remove one of them.

## Inventory

Scope: **G** global, **P** project, **G+P** global with a project override, **B** this window only (browser storage). *Today* is where it is edited now; *Home* is the proposed category (names below). "Page" means the setting moves to the page that uses it.

### Recording and the DAW

| Setting | What it does | Scope | Consumers | Today | Home |
| --- | --- | --- | --- | --- | --- |
| `Recording.engine` | The project's recorder: REAPER, Audacity or built-in | P | Booth, Editing, Pickups, Proof, Master & QC | Recording panel | Recording & DAW |
| `Teleprompter.input_device` | Microphone for the Booth and the built-in recorder | G | Booth; built-in recorder (`bindings_booth_record.go:64`) | Booth panel (free text), Booth Levels menu | Recording & DAW, one device picker; Booth keeps a quick switch |
| `Recording.device` | Last microphone the built-in recorder used | P | `bindings_booth_record.go:67` | none (written by a recording) | Merge with the microphone setting |
| `DAW.reaper_path` | Path to reaper.exe when auto-detect fails | G | `dawlaunch.go:48` | DAW Integration | Recording & DAW, Advanced |
| `DAW.auto_start_launcher` | Pass the launcher as REAPER's startup script | G | `dawlaunch.go:49` | DAW Integration, Booth record guide | Recording & DAW |
| `DAW.experimental_reaper_actions` | Allow unverified REAPER commands ([ADR 0230](../adr/0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)) | G | `internal/bridge/actions.go`, `dawport/resolver.go` | DAW Integration | Recording & DAW, Advanced |
| `DAW.capability.<name>` ×34 | Per-capability auto, on or off ([ADR 0304](../adr/0304-bridge-actions-asks-a-per-command-gate-and-the-daw-ports-resolver-answers-it-from-the-per-capability-settings.md)) | G (schema allows P) | `dawport/toggles.go`, `resolver.go` | DAW Integration (34 selects); Booth record setup turns `record` on; Editing Backups tab flips `backups` | Recording & DAW, Advanced, as a table with a reason per row |
| `DAW.fx_favourites` | Effects Editing offers first | G+P | `bindings_workspace.go:144` | DAW Integration (only editor) | Page: Editing, Effects tab |
| `DAW.backups.window_seconds`, `retention_days` | Audacity backup window and retention | G+P | `internal/dawport/audacity/backups.go` | DAW Integration (probably twice), Backups section, Editing Backups tab | Page: Editing, Backups tab, one home |
| `Teleprompter.punch_preroll_seconds` | Pre-roll for punch and roll | G | `teleprompterpunch.go:58` | Booth panel | Page: Booth, record setup |
| `ReadAloud.record_in_reaper`, `record_confirmed` | Booth's record-in-REAPER toggle ([ADR 0380](../adr/0380-record-in-reaper-is-a-project-scope-setting-and-arming-is-a-separate-click-from-play.md)) | P | Booth | Booth control bar only | Stays on Booth |
| `Tracks.selectedRpp` | Which `.rpp` the project links to | P | `tracks.go:52` | Header pill, Recording panel, DAW panel | Recording & DAW (read-only link state) |
| `Mastering.provider` | Mastering provider ([ADR 0306](../adr/0306-mastering-is-a-provider-port-and-measurement-stays-one-in-process-judge.md)) | P | `bindings_mastering.go:131` | **No UI caller** (`masteringChooseProvider` is unused) | Orphan: decide with the mastering PRD |

### Speech to text

| Setting | What it does | Scope | Consumers | Today | Home |
| --- | --- | --- | --- | --- | --- |
| `TranscriptCompare.model_size` | Default Whisper model for compare and, with the cascade off, the recording check | G+P | `app.go:1511`, `bindings.go:99`, `internal/coverage/params.go`; `proof/CompareRun.tsx`; sidecars `compare.py`, `coverage_*.py` | Proof panel (+ model card) | **Speech to text: "Transcription model"**, used by Production, Proof, Pickups, Editing |
| `RecordingCoverage.cascade_enabled`, `cascade_first_pass_model`, `cascade_recheck_model`, `cascade_unsure_below` | Two-pass recording check ([ADR 0864](../adr/0864-a-long-recording-is-checked-in-overlapping-chunks-by-parallel-whisper-processes-and-whisper-word-scores-choose-the-passages-a-larger-model-looks-at-again.md)) | G+P | `internal/coverage/settings.go` | Recording check panel | Speech to text, Advanced |
| `RecordingCoverage.parallel_workers`, `chunk_seconds`, `chunk_overlap_seconds` | How a long recording is cut and run | G+P | `coverage/settings.go`; sidecar | Recording check panel | Speech to text, Advanced |
| `TranscriptCompare.chunk_seconds` | Chunk length for a compare run (a second key with the same name, choices 30/60/300/600, default 60) | G+P | `proof/CompareRun.tsx:167` | Proof panel | Page: Proof, compare options. Unify with the recording-check chunk or rename |
| `Teleprompter.engine`, `model` | Live engine (Whisper or Moonshine) and its model | G | Booth (`useTeleprompterSession.ts`) | Booth panel | Speech to text, "Live reading in the Booth" |
| `RecordingCoverage.min_paragraph_present`, `max_missing_run`, `max_misread_run`, `min_anchor_run`, `background_checks` | Pass thresholds and alignment parameters of the recording check | G+P | `coverage/settings.go`, `coverage_background.go`, sidecars | Recording check panel | Page: Production, recording check rules. The run already shows the values it used |
| `TranscriptCompare.color_misread`, `color_skipped`, `color_extra` | Marker colours | G+P | `internal/transcript/service.go:393` | Proof panel | Page: Proof, compare options |

### Voice, definitions and pronunciation

| Setting | What it does | Scope | Consumers | Today | Home |
| --- | --- | --- | --- | --- | --- |
| `Piper.tts_provider` | Preview voice engine; one option, `piper` | G+P | `internal/ttsport` | TTS panel | Hide: a one-option select says nothing |
| `Piper.tts_voice_id` | Voice for name previews | G+P | `bindings.go:67`, `bindings.go:235` | TTS panel (choices hard-coded in `app.go:1566`, not from the catalogue) | Voice & pronunciation, "Preview voice", from installed voices |
| `Script.definition_source` | Where a word's definition comes from | G | Script Words tab, Story Bible | Definitions panel; Words tab menu | Voice & pronunciation; the Words tab keeps a quick switch |
| `ManuscriptGuide.default_pronunciation_source` | Pronunciation source a new name tries first | G+P | `bindings_pronunciationsources.go:84`, `guide/service.go:400` | Story Bible panel | Voice & pronunciation |
| Merriam-Webster key | Optional online-dictionary key, kept in `credentials.json` | G | `internal/pronunciationonline` | Inside the Story Bible panel | Voice & pronunciation, Advanced |

### Models and downloads

| Item | Size | Consumers | Today | Home |
| --- | --- | --- | --- | --- |
| Whisper tiny, small, medium, large-v3-turbo, large-v3 | 78 MB, 486 MB, 1.5 GB, 1.6 GB, 3.1 GB | Compare, recording check, live Booth | Local assets list; model card on Proof; selects in three panels | Models & downloads (one list); each choice stays in its role's section |
| Piper voice `en_US-ljspeech-high` | 114 MB | Story Bible preview | Local assets; TTS panel card | Models & downloads |
| spaCy small and large | 13 MB, 401 MB | Story Bible build | Local assets; Story Bible select lists all, installed or not | Models & downloads |
| Moonshine tiny and small (Windows only) | 78 MB, 224 MB | Booth live engine | Local assets only; absent from the guide | Models & downloads |
| Open English WordNet | 10 MB | Script, Story Bible | Local assets; own Download and Remove in the Definitions panel | Models & downloads |
| FFmpeg MP3 encoder | 31 MB | MP3 export | Local assets only; absent from the guide | Models & downloads |
| GLiNER, BookNLP small and large, local language model | 747 MB, 287 MB, 1.3 GB, unavailable | Story Bible scan | Story Bible analysis panel | Models & downloads, below the list |
| Wiktionary pronunciations | none yet (`PENDING-PHASE-0-VERIFICATION`) | Pronunciation fallback | **Not in the registry**, so not in Local assets | Models & downloads, as "Not available yet" until verified |

### Delivery

| Setting | What it does | Scope | Consumers | Today | Home |
| --- | --- | --- | --- | --- | --- |
| Delivery profile (project choice) | The standard chapters are judged against | P | Master & QC, Delivery, Production, Schedule | Three places: Delivery profile panel, Delivery page card, import review | Delivery; the page and the import dialog keep a link or quick switch to the same value |
| Default profile and custom profiles (`delivery-profiles.json`) | Profile for new projects; copies with own limits ([ADR 0180](../adr/0180-custom-delivery-profiles-are-copies-of-a-built-in-kept-in-a-user-level-file.md)) | G | `internal/deliveryprofile` | Delivery profiles panel (a one-letter-different name) | Delivery, "For new projects" |
| `Delivery.*` seven limits | Old per-layer limits, migrated into profiles ([ADR 0179](../adr/0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md)) | G | `delivery_profiles.go` (migration only) | none | Dead after migration; leave |
| `StageRecommendations.*` ×16 | Which readiness signals a stage needs | G+P | `bindings_stages.go:193` | Stage suggestions panel (16 selects) | Page: Production, stage board |
| `Cleanup.*` ×6 | Silence and breath thresholds | G+P | `cleanup_settings.go`, `internal/measure/cleanup.go` | Silence cleanup panel; Master "Open Settings" link | Page: Master & QC, diagnostics |
| `Preview.*` ×4 | Preview excerpt length and preset | G+P | `bindings_preview.go` | Preview suggestion panel | Page: Proof, preview options |
| `Proofing.render_length_tolerance_seconds` | Render-length tolerance | G+P | `bindings_stages.go:179` | **None** (in schema only) | Page: Master & QC with the limit it tolerates |

### The project, narrator and credits

| Setting | What it does | Scope | Consumers | Today | Home |
| --- | --- | --- | --- | --- | --- |
| Manuscript | Import or replace | P (action) | Script, Booth, Proof | Manuscript panel | Project |
| Story Bible types ([ADR 0862](../adr/0862-story-bible-types-are-a-stored-editable-list-with-a-colour-and-a-can-speak-flag-and-the-fixed-categories-are-its-defaults.md)) | Entry kinds, colour, can speak | P | `internal/guide/types.go` | Story Bible types panel | Project |
| Marks | Mark vocabulary | P | `internal/marks` | Marks panel (summary) and Script dialog | Project (summary), the editor stays in Script |
| `ManuscriptGuide.build_after_import`, `spacy_model` | Auto-build the Story Bible; its language model | G+P | `ManuscriptImport.tsx`, `guidegate.go:26` | Story Bible panel | Project, "Story Bible" |
| `ManuscriptGuide.analysis_prompt` | Offer better analysis when scanning | G | `scanModel.ts` | Analysis panel checkbox; scan dialog "Don't ask again" | Models & downloads (with the tools) |
| `General.narrator_name` | Default for the `[Narrator]` credits token | G (+ a project value in credits) | `credits/values.go` | General panel; credits setup dialog; Credits panel | Project, "Narrator and credits" |
| `General.credits_room_tone_seconds` | Silence added per credits file (a choice list standing in for a number) | G | `useCreditsRows.ts:16` | General panel | Project, Advanced, as a number |
| Credits templates and values | Opening, closing, retail sample | templates G, values P | `internal/credits` | Credits panel (subtitle says "This project" though templates are global) | Project |
| Project data | Clear derived data | P (action) | Proof, Pickups | Project data panel | Project, Advanced |
| `Editing.fx_cap_pct` | Effects coverage cap | P | `editing/effects/useFxCap.ts` | Editing > Effects tab only | Page: Editing (already) |
| `Editing.max_gap_seconds`, `head_max_seconds`, `tail_max_seconds` | Empty-space policy for the editing readiness signal | G+P | `bindings_editing.go:17` | **None**; unset keeps the check "unknown" | Page: Editing, or drop; owner call |
| `TakeReview.*` | Pickup and duplicate detector thresholds | layered | `internal/takereview/settings.go` | **Not in `fieldSchemas`**; nothing can write them through the settings API | Page: Pickups scan dialog, or drop |

### This computer: look, keys, updates

| Setting | What it does | Scope | Consumers | Today | Home |
| --- | --- | --- | --- | --- | --- |
| Theme | Light, dark or system | B (`localStorage`) | every page | Appearance panel; rail toggle | Appearance & keys; the rail toggle stays |
| Reader text | Font, size, spacing, width | B | Script; Booth reads the font | Reader text panel; Script popover | Appearance & keys |
| `Manuscript.color_note` | Note colour | G+P | CSS `--note` | Own one-field panel ("Note colour" vs label "Note color") | Appearance & keys |
| `Appearance.zoom` | Window zoom | G | `bindings_window.go` | Header chip, Ctrl +/-; **not in `fieldSchemas`** | Appearance & keys (shown), keys keep working |
| `Keymap.overrides` | Key and pedal remaps | G | `useUserKeymap.ts`, every hint | Two panels 20 apart: read-only list and Keyboard & pedals | Appearance & keys, one section |
| Booth text size | Booth reading size | B | Booth | Booth only | Stays on Booth |
| `General.notifications` | Notify when a long task ends | G | `notifications.go:62` | General panel | App & updates |
| `General.debug_logging` | Debug-level run log ([ADR 0251](../adr/0251-tool-runs-are-logged-as-json-lines-through-slog-with-a-run-id-and-content-is-never-logged.md)) | G only | `app.go:469`, `:1852` | General panel | App & updates, Advanced |
| `General.log_verbosity` | Meant to set log level | G | **None found** | General panel, guide, tooltips | **Delete**: no consumer |
| `Updates.check_on_startup`, `channel` | Daily release check; channel | G only | `update.go:44` | About & updates | App & updates |

Not listed: per-viewer memory in browser storage (Story Bible sort, last chapter on Proof and Master, reader scroll position) and `narration.readAloud.flags`, which nothing writes since the Booth swap. They are convenience state, not settings.

## Proposed information architecture

Eight categories in three labelled groups, plus an index of what moved to pages. The mock draws it ([ADR 0865](../adr/0865-settings-are-grouped-by-what-is-configured-with-a-scope-and-a-used-by-list-on-every-setting-and-a-model-list-that-owns-the-downloads.md)).

| Group | Category | Holds |
| --- | --- | --- |
| Shared tools | **Recording & DAW** | Recorder choice and connection status, microphone, REAPER program, launcher, experimental actions, capability table |
| | **Speech to text** | Transcription model (the one default), live engine and model for the Booth, the two-pass check, workers and chunking |
| | **Voice & pronunciation** | Preview voice, definition source, pronunciation source, Merriam-Webster key |
| | **Models & downloads** | The one list of every download with size, status, used-by and in-use; disk use and folder; analysis tools |
| | **Delivery** | This project's profile and its limits; default profile; custom profiles |
| This project | **Project** | Manuscript, Story Bible build and types, marks, narrator and credits, project data |
| This computer | **Appearance & keys** | Theme, reader text, note colour, zoom, shortcuts and pedals |
| | **App & updates** | Updates, notifications, debug logging, version |
| Elsewhere | **Set on a page** | Index of settings that moved, each with where it is now |

### What changes, by problem

- **Shared setting, several homes.** The Whisper model had three settings in three panels (Proof, Recording check, Booth). It becomes one default in Speech to text, used by Production, Proof, Pickups and Editing; the first-pass and re-check models are Advanced; the Booth's live model is its own labelled section.
- **Downloads in six places.** One list owns download, repair and remove. A role's choice stays in its section; choosing a model that is not on the disk offers the download in the row (R-RES2).
- **Page-specific tuning.** Recording check rules, silence cleanup, preview, stage suggestions, compare defaults, punch pre-roll, favourite effects and backups only change what one page does. They move to that page and the Settings page lists them under Set on a page, so search still finds them (R-IA3, R-WIN5).
- **Edited in several places.** The same stored value can have a quick control on a page (theme in the rail, microphone in the Booth, definition source in the Words tab, delivery profile on Delivery). The setting row says "Also set in ..." so a change is not a surprise. One exception: backups, which three places edited, get one home on the page that uses them.
- **Scope.** Every row carries a badge. A project override shows "This project uses the computer setting" with Override, and the reverse (R-IA1, R-IA2). Rows the project cannot meaningfully override (REAPER path, capability gates, microphone) are computer-only.
- **Orphans.** `General.log_verbosity` has no consumer and is deleted from the page. Four settings have no editor in the UI (`Editing.*_max_seconds`, `Proofing.render_length_tolerance_seconds`) and `TakeReview.*` cannot be written through the API at all; each is flagged for the owner below.

## Flagged problems

- **Orphans.** `General.log_verbosity`: no consumer, yet in the UI, guide and tooltips. `Mastering.provider`: stored and read, with no UI caller. Dead palette keys (`color_character` to `color_needs_review`) in `settingsForms.tsx:26-35` and `App.tsx:437-446`; only `color_note` is live. `narration.readAloud.flags` is read and never written.
- **Duplicates.** Backups (three places), delivery profile (three), theme, reader text, definition source, microphone, `narrator_name`, `analysis_prompt`, `capability.record` and `auto_start_launcher` are each edited in more than one place. Two key names, `chunk_seconds`, differ in choices and default (60 against 300) across `TranscriptCompare` and `RecordingCoverage`.
- **Misplaced.** Machine-wide DAW switches offer a Global / This project switch although the project view is replaced by the link block. Credits' subtitle says "This project" for a global template library. A recorder-specific number (punch pre-roll) sits in "Booth".
- **Confusing names.** Tool, panel and label disagree: `Piper` / TTS / "TTS provider"; `TranscriptCompare` / Proof / "Default Whisper model"; `Teleprompter` / Booth / "Microphone"; `RecordingCoverage` / Recording check against the "Recording" panel, which is about the DAW. "Delivery profile" and "Delivery profiles" are two panels. Story Bible is three panels ten positions apart.
- **Structure.** 27 panels, no table of contents, mixed with action panels (Manuscript, Project data); the first ten follow the mock and the rest follow delivery history.
- **Probable bugs, unverified in the app.** The Booth's "DAW settings" link goes to `#daw`, which is not in `SETTINGS_ANCHORS`, so it likely does not scroll. `#delivery` scrolls to the global profiles panel, not the project's. The Backups rows may be drawn twice on the DAW panel (`DawPanel` passes no filter to the generic form while `BackupsSection` renders the same keys).
- **Docs.** [ADR 0365](../adr/0365-the-theme-is-one-global-setting-and-the-booth-and-companion-follow-it.md) says the theme is one global setting; it is stored in browser `localStorage`. There is no settings reference page in `docs/reference/`. The guide omits Moonshine, FFmpeg, `fx_cap_pct`, the record toggle and `Mastering.provider`, and lists `log_verbosity` as live.
- **Fields declared in four places** (`app.go`, `store.go`, `config/defaults.json`, `apps/ui/src/api/mockFixtures.ts`), and tooltips keyed by bare key, so two `chunk_seconds` share one tooltip.

## Design rationale

Each decision in the mock, against the rule it applies.

| Decision | Rule |
| --- | --- |
| Left category list, one category at a time, eight categories in three groups, search above it | R-NAV1, R-IA3 |
| Search matches synonyms and opens Advanced; results name the category; "Changed" and "In this project" filters | R-NAV2, R-IA5 |
| Every row has a scope badge and, where a project may differ, an override line with a way back | R-IA1, R-IA2 |
| "Used by" chips on every shared setting; "Also set in ..." for quick controls | R-IA4 |
| Settings that only change one page moved to it; an index page keeps them findable | R-IA3, R-WIN5 |
| Deep link from a page: open on the row, scroll, focus, highlight, Back to the page; Ctrl+, | R-NAV3, R-NAV4, R-A11Y8 |
| Instant apply with a per-row "Saved"; no Save button | R-EDIT1 |
| Costly change (Whisper model) asks first and says what re-runs | R-EDIT2 |
| Reset only on a changed row; reset a category after confirmation; Changed pill carries text | R-EDIT3, R-EDIT4 |
| Invalid REAPER path keeps the old value and says how to fix it; unwritable file shows a page notice and a row error | R-EDIT5 |
| Rarely changed options behind Advanced, closed by default | R-EDIT6 |
| One Models & downloads table: status, size, used-by, in use; progress, cancel, retry; folder and total | R-RES1, R-RES3, R-RES4 |
| Choosing a model not on the disk offers the download in the row | R-RES2 |
| Removing a model in use names what uses it, moves the setting to another installed one, or refuses | R-RES5, R-EDIT8 |
| Recording tool as a status card with Test connection; capabilities with a reason | R-RES7 |
| Nothing downloaded: empty state with the recommended set; loading and read-error states | R-RES8, R-A11Y4 |
| `nav`, `main`, `search` landmarks; category buttons with `aria-current`; live regions for Saved, errors, progress | R-A11Y1, R-A11Y2, R-A11Y4 |
| Below about 760 px the category list folds into one button and the model table becomes cards | R-A11Y7 |
| Chips and icon buttons at least 24 px, names include the thing acted on | R-A11Y5 |

## Decisions that need the owner

1. **Page-specific settings move out of Settings** (Recording check rules, Silence cleanup, Preview, Stage suggestions, Proof compare defaults, Punch pre-roll, Favourite effects, Backups). The mock shows them as an index; building them on each page is a separate change per page.
2. **Delete `General.log_verbosity`**, which has no consumer.
3. **The four settings with no editor** (`Editing.max_gap_seconds`, `head_max_seconds`, `tail_max_seconds`, `Proofing.render_length_tolerance_seconds`) and `TakeReview.*`: give each a home on its page, or remove it.
4. **`Mastering.provider`:** surface it on Master & QC or retire it.
5. **One transcription default** for compare and recording check, with the cascade models Advanced. Today `TranscriptCompare.model_size` and `RecordingCoverage` have separate settings.
6. **Profile editing stays in Settings** (Delivery > Custom profiles); the Delivery page only chooses. The PRD kept it as built; this keeps it in a category rather than a panel.
7. **Computer-only DAW rows:** drop the project override for REAPER path, launcher, experimental actions, capabilities and microphone.
8. **Scope of theme and reader text:** both live in browser storage. Moving them to the host's global settings would make the theme match [ADR 0365](../adr/0365-the-theme-is-one-global-setting-and-the-booth-and-companion-follow-it.md); the mock labels them "This computer" either way.
9. **Switch control:** the mock's rows use a checkbox with an On/Off word because the primitive set has no switch. Windows guidance prefers a toggle (R-WIN1). Adding one is a Foundations decision.
