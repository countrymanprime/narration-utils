# Story Bible Preview: TTS Failures

**Source:** user report of 2026-09-20 ("I got an error trying to run TTS for a record"). Citations are `file:line` on branch `claude/narration-utils-planning-00e3c8` at dc9d01a. The exact error text was not captured, and nothing was run; every cause below is from reading code, except one reproduced in memory (cause 2). Phase 1 was delivered by stack S04 of [implementation-plan.md](implementation-plan.md) (issue #65), which reproduced the causes on a dev build (see Reproduction results below). Related: [story-bible-entries-and-actions.prd.md](story-bible-entries-and-actions.prd.md) (gating the play button), [release-readiness-provisioning-and-docs-site.prd.md](release-readiness-provisioning-and-docs-site.prd.md) Phase 1 (install flow), [interaction feedback](../architecture/interaction-feedback.md) (the audit's install rows are owned by release-readiness Phase 1).

## Problem Statement

Pressing play on a Story Bible entry or alias ("run TTS") can fail, and the narrator cannot tell why or recover: failures surface as opaque text, a failed run can leave a zero-byte file that every later attempt reuses, and the first-use voice download flow is already recorded as broken against the real host.

## Evidence

- **Path.** Play button `GuideDetail.tsx:392-404` and alias buttons `:435-447` call `playPreview` (`usePreviewAudio.ts:54-100`), then `api.guidePreview` (`wailsClient.ts:100`) and `Host.GuidePreview` (`apps/desktop/bindings.go:158-173`). The binding reads `Piper.tts_voice_id`, calls `tts.Voice` and `tts.Paths` (any `Paths` error is reported as `asset_required`, `:167-170`), then `guide.Preview` (`apps/desktop/internal/guide/service.go:264-298`) and returns base64 WAV (ADR 0012's pattern for short clips). `Preview` resolves the spoken text, builds a cache filename from a sha256 of version tag, provider, version and text (`:284-285`), returns any existing file (`os.Stat`, `:288`), else runs `render-audio` (`Run`, `:107-133`, `context.Background()`, no timeout). Python `render_audio` (`manuscript_guide.py:1046-1071`) speaks the entry's name text.
- **Messages the user can see.** "story Bible preview is unavailable" (`bindings.go:160`); "the selected preview voice is not in the approved catalog" (`:165`); "the requested Story Bible name no longer exists" (`service.go:282`); "save the REAPER project and import a manuscript first" (`:109`); "configure the Manuscript Guide executable/backend before continuing" (`:141,:147`); "could not start ..." (`process/supervisor.go:90`); any non-zero sidecar exit returns the whole trimmed stderr (`service.go:122-130`), which Python prefixes "ERROR: ..." (`manuscript_guide.py:1151`): "Install a verified Piper voice...", "Alias index out of range.", "Guide file does not exist; build it first." (`:1049-1058`). A 0-byte WAV makes `audio.play()` reject with the browser's error via `String(error)` (`usePreviewAudio.ts:87-90`), or the hook shows "Preview audio could not be played." (`:80-84`).
- **Probable causes (ranked by how likely they explain "an error"):**

| # | Cause | Evidence | Testable without the app |
| --- | --- | --- | --- |
| 1 | First-use voice install flow broken: the Go install job reports `phase:"running"` (`apps/desktop/app.go:735`) while the UI keys on `'downloading'` (`GuideDetail.tsx:153-176`, `contracts/tts.ts:26-33`). The narrator gets a toast with "Downloading..." text and the dialog never updates; repeated clicks start extra jobs. | Recorded in `release-readiness...prd.md:23` and the interaction feedback audit (its PRD is deleted; the install rows are in the catalog, [#209](https://github.com/countrymanprime/narration-utils/issues/209)); found by reading, not run | Vitest with `ttsInstall` returning `'running'`; Go test for `startTtsInstall` (none exists per the audit PRD) |
| 2 | Any synthesis failure is masked. Piper's espeak init is lazy inside `synthesize`, which runs inside the `with wave.open` block; when it raises, `wave.close()` raises "# channels not specified" and replaces the real error. A name that phonemizes to no audio chunk produces the same message with no exception. | Masking reproduced in memory with a BytesIO on the project's Python 3.12; the empty-phoneme case is inferred from `synthesize_wav` | Yes: patch `PiperVoice.load` with a voice whose `synthesize_wav` raises or yields nothing (pattern `tests/test_manuscript_guide.py:247-274`) |
| 3 | Failure leaves a 0-byte cached file: `wave.open(path,"wb")` creates the file, and `Preview` trusts any existing file (`service.go:288`), so every later attempt returns empty audio and fails in the browser. | By reading | Yes: pre-create a zero-byte file at the hashed path and call `Preview`; no sidecar needed |
| 4 | Frozen build lacks piper data: `scripts/release/prepare-resources.py:68-73` freezes the guide with no `collect_data`; Piper needs `piper/espeak-ng-data` (about 19 MB, initialised at `phonemize_espeak.py:20`); no piper hook exists in `_pyinstaller_hooks_contrib`; the file's own comment at `:74-76` describes the same class of bug for faster_whisper | By reading; frozen-sidecar startup is also listed unverified in the briefs PRD | Partly (static check of the freeze arguments); a real check needs a frozen build |
| 5 | Non-cp1252 project paths: `print("AUDIO|"+path)` (`:1071`) and error logging go through the Windows pipe encoding; the WAV is written but the sidecar exits 1, the second attempt then hits the cache and works | Inference | Yes, an encoding test |
| 6 | Cache key ignores the voice id (`provider` and `version` are constant), so a stale WAV survives a voice change | By reading | Yes, in Go |

- **Latency.** `tts.Paths` runs `assets.State`, which SHA-256 hashes the whole 114 MB model on every preview click (`assets/store.go:35-65`).
- **Coverage.** Python: only the happy path (`test_preview_uses_bundled_piper_api_not_a_checkout_executable`, `tests/test_manuscript_guide.py:247-274`); no failure test for `render_audio`, none for `pronunciation()`. Go: no `Preview` test (`service_test.go`), no `GuidePreview` test (`bindings_test.go`; the Whisper `asset_required` pattern is at `:50-112`). UI: `GuideDetail.test.tsx:99-157` covers the mock happy path; `usePreviewAudio.test.tsx` covers stale request and unmount only, with no error case; the mock returns `audioBase64: ''` (`mockApi.ts:509-512`) so it cannot show any real failure.
- **Not testable without running the app:** real Piper synthesis on real names and WebView2 audio decoding. Preview of a name with no pronunciation is a separate UI gating change (entries PRD Phase 3).

## Reproduction results (Phase 1, dev build)

The reporter's toast text and entry (T1, T2) were never supplied, so Phase 1 diagnosed every candidate cause instead of guessing. The dev build ran the real Go host code, the real Python sidecar from `.venv` and the real installed `en_US-ljspeech-high` voice. The tests named below failed first and now pass.

| # | Cause | Result on the dev build | Test |
| --- | --- | --- | --- |
| 1 | Install flow reports `running`, UI keys on `downloading` | **Confirmed by reading** (`startTtsInstall` sets `phase: "running"`, and `GuideDetail.tsx` only loops on `downloading`, so a fresh install shows a "Downloading..." toast and no progress). It needs no synthesis, so it is the most likely reporter case on a first run. **Not fixed here:** Phase 2, owned by release-readiness Phase 1. | Phase 2 |
| 2 | Synthesis failure masked as "# channels not specified" | **Confirmed.** Names that phonemize to nothing (`...`, `---`, an em dash, a lone space) exit 1 with that message; names with letters, digits, Cyrillic and CJK all speak. | `test_a_synthesis_error_is_reported_not_masked_by_the_wave_writer`, `test_a_name_that_produces_no_audio_says_so` |
| 3 | Failure leaves a 0-byte cached file that later attempts reuse | **Confirmed.** The failed run above leaves a 0-byte `.wav`, and the old `os.Stat` cache check trusted it. | `test_a_failed_render_leaves_no_file_behind`, `TestPreviewIgnoresAZeroByteCachedFileAndReplacesIt`, `TestPreviewRejectsAnEmptyResultAndDoesNotKeepIt` |
| 4 | Frozen build lacks piper data | **Not testable on a dev build.** Left for Phase 3. | Phase 3 |
| 5 | Non-cp1252 project path | **Confirmed.** A project folder with CJK and accented characters wrote the WAV, then exited 1 with `'charmap' codec can't encode characters`; the second click hit the cache and worked. | `test_main_writes_utf8_to_a_legacy_codepage_pipe` |
| 6 | Cache key ignores the voice | **Confirmed by reading and by test** (the hash used a constant provider and version). | `TestPreviewCacheIsKeyedOnTheVoice` |

After the fix, the same real setup (real host code, real sidecar, real voice, non-ASCII project path) was run again: an unspeakable name fails with `"..." could not be spoken: the voice produced no audio for it.` every time and leaves no file, the next name speaks, and a repeated preview is served from the cache in about 1 ms.

## Proposed Solution

Make every failure both correct and legible: capture the actual error, never trust a zero-byte cache, key the cache on the voice, add timeouts and tests for each path, and let the install flow report real progress. First, get the real error text from the user's failing case to confirm which cause applies.

## Key Hypothesis

We believe surfacing real errors and removing the poisoned-cache and masking paths will make preview either work or fail with a message the narrator can act on. We'll know we're right when each cause above has a failing-then-passing test, a failed run never poisons later attempts, and the toast names the real reason (for example "voice not installed").

## What We're NOT Building

- Making the preview speak IPA or a chosen phoneme string (briefs PRD Phase 10).
- A second TTS provider or voice picker.
- New audio playback infrastructure; ADR 0012's base64 route stays for short clips.
- The full install-flow contract fix, which release-readiness Phase 1 owns; this PRD only depends on it and adds the tests that expose it.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Synthesis error is legible | A voice that raises during synthesis produces that error, not "# channels not specified" | Python test |
| No poisoned cache | A failed render leaves no file; a pre-existing zero-byte file is ignored and replaced | Go test, Python test |
| Cache key | Changing the voice changes the cache path | Go test |
| Timeout | A hung sidecar returns an error after a bounded time | Go test with a fake process |
| Error path in the UI | Each user-visible message has a test; the hook resets to idle and the button is usable again | Vitest (`usePreviewAudio`, `GuideDetail`) |
| Install flow | `running` and every other job phase render as progress in the install dialog; extra clicks do not start extra jobs | Vitest; Go test for `startTtsInstall` |
| Frozen sidecar | Piper voice loads and synthesizes in the frozen guide sidecar | Manual check on a frozen build, recorded in the PR |
| Latency | Model hash not recomputed on every click | Go test on `assets.State` caching; manual timing |

## Open Questions

- [ ] **T1. What was the exact error?** Still unanswered by the owner. Phase 1 reproduced every cause it could on a dev build instead (see Reproduction results): causes 2, 3, 5 and 6 are confirmed and fixed, cause 1 is confirmed by reading and waits for Phase 2. If the reporter's error was the first preview after a fresh install, cause 1 is the likely one.
- [ ] **T2. Which entry?** Still unanswered. Both variants are now handled: a name that phonemizes to nothing fails legibly, and an entry that failed before no longer poisons the cache.
- [x] **T3. Write to a temp file and rename, or catch the exception before `wave` closes?** Answered (recommendation adopted, D22): render to `<name>.<pid>.part` next to the target, rename on success, remove on failure. The wave writer is closed by hand so its own error cannot replace the real one.
- [x] **T4. Timeout value** for `render-audio` and where to enforce it (context with deadline in `Run`). Answered: `previewTimeout` is 2 minutes in `guide/service.go`, enforced by a context deadline around the sidecar run in `Preview`. `Run` itself is unchanged and unbounded for the other commands.
- [ ] **T5. Cache the model hash?** Recommendation adopted (hash at install and on change of size or mtime); it is a Phase 3 item and not built yet.
- [ ] **T6. Frozen build data.** Recommendation adopted (yes: `collect_data` plus a release smoke test, sequenced with the release-readiness provisioning phases); Phase 3, not built yet.
- [x] **T7. Message wording** for each failure (voice missing, name not speakable, sidecar unavailable). Answered: one cause line with the raw reason inside it, because the toast has no details area yet (the interaction feedback work delivered a toast queue with sticky errors but still no details area). Messages: `"<name>" could not be spoken: <reason>`; `The preview voice could not be loaded (<reason>). If its files are damaged, remove it in Settings and install it again.`; `The preview could not be saved (<reason>). Close anything that has the file open and try again.`; `the preview took longer than 2m0s and was stopped; try again, and restart the app if it keeps happening`; and the existing asset-required prompt for a missing voice. The UI drops any `Error:` prefix and capitalizes the first letter.

## Users & Context

**Primary User**: a narrator checking how a name sounds before recording, Windows first.
**Current behavior**: presses play, gets an error or silence, tries again with the same result.
**Trigger**: reviewing entries or aliases in the Story Bible.
**Success state**: the name plays, or a clear message says what to fix.
**Job to Be Done**: When I check a name, I want to hear it or know why I cannot, so I do not record it wrong.
**Non-Users**: narrators who do not use the preview.

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | Capture the real error in `render_audio`; write to a temp file and rename; delete on failure | 1 |
| Must | Ignore and replace zero-byte cache files; key the cache on the voice id | 1 |
| Must | Bounded timeout for `render-audio` | 1 |
| Must | Tests for causes 2, 3, 5 and 6 and the missing Go `Preview`/`GuidePreview` tests | 1 |
| Must | Real progress in the install dialog and no duplicate jobs (with release-readiness Phase 1) | 2 |
| Should | Piper data files in the frozen sidecar, plus a release smoke test | 3 |
| Should | Cache the model verification | 3 |
| Should | Distinct user messages for each failure | 1 |
| Could | Diagnostic bundle button that copies the last error and versions | 3 |
| Won't | IPA-speaking preview, new providers | - |

**User flow**: press play; a spinner shows real in-flight state; audio plays, or a toast says "The voice is not installed. Install it?" or "This name could not be spoken" with the reason available in details; pressing play again after a failure works.

## Technical Approach

**Feasibility**: HIGH for Steps 1 and 2 (all in Go and Python, tests exist as patterns); MEDIUM for Step 3 (frozen build verification needs a real build).

**Architecture notes**
- `manuscript_guide.py`: build the WAV in memory or a temp file, call `synthesize_wav`, write only on success; catch and re-raise the real exception; print the `AUDIO|` path through a UTF-8-safe stream (encoding test).
- `service.go`: treat `size == 0` as a miss; add the voice id to the hash input; run with `context.WithTimeout`; add `Preview` tests with a fake process supervisor (as the Whisper tests do).
- `bindings.go`: a `GuidePreview` test for each failure class and for `asset_required`; read services through `h.services()` (`docs/architecture/host-binding-concurrency.md`).
- UI: the hook already resets on error; add tests and distinct messages; the mock gains a failing-preview seam (`?mockPreviewError=`) and an install job with `phase:'running'`.
- Frozen sidecar: `prepare-resources.py` gains `collect_data` for piper (the comment at `:74-76` is the pattern); a release smoke test synthesizes one word.
- Docs: a troubleshooting note in `docs/guides/using-the-app/story-bible.md`; no ADR unless the cache contract changes ADR 0012.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| The user's failure is a different cause | Medium | T1 first; each cause has its own test |
| Fixes hide behind a mock that always succeeds | High | Failing mock seams and Go/Python tests, not just UI tests |
| Frozen-build behavior differs from dev | Medium | Manual frozen-build check recorded in the PR |
| Overlap with the install-flow work | High | Coordinate with release-readiness Phase 1 and the audit PRD; keep this PRD's UI part to tests and messages |
| Host API version bump collisions | Low here | No binding signature change planned |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Correct and legible failures | Real errors, temp-and-rename, zero-byte and voice-keyed cache, timeout, tests, messages | complete | - | T1 (diagnosed instead) | [plan](implementation-plan.md) (S04) |
| 2 | Install flow honesty | `running` phase handling, single job, tests | complete (delivered with release-readiness Phase 1, stack S16, [ADR 0077](../adr/0077-every-asset-install-is-one-job-with-real-bytes-a-second-start-joins-it-and-one-hook-follows-it.md)) | 1 | release-readiness Phase 1 (owner) | [plan](implementation-plan.md) (S16) |
| 3 | Frozen build and latency | Piper data files, release smoke test, model verification cache | pending (release-readiness stack, S16) | - | 1 | - |

**Phase 1.** Goal: a failed preview never poisons later attempts and always says why. Success: tests for causes 2, 3, 5, 6; a manual retry after a forced failure works.
**Phase 2.** Goal: first-use install works end to end in the UI. Success: Vitest with `phase:'running'`; a Go test for `startTtsInstall`.
**Phase 3.** Goal: the frozen sidecar can synthesize, and previews are fast. Success: a frozen-build smoke test; measured click-to-audio time recorded.

**Parallelism Notes**: Phase 1 and 2 touch different files; Phase 3 follows Phase 1.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `manuscript_guide.py` and tests, `apps/desktop/internal/guide/service.go` and tests, `bindings_test.go`, `usePreviewAudio*`, `GuideDetail.tsx`, mock | Entries PRD Phase 3 (`GuideDetail.tsx`), briefs Phase 10 (`manuscript_guide.py` preview), audit Phase 4 |
| 2 | `apps/desktop/app.go` (`startTtsInstall`), `GuideDetail.tsx`, `contracts/tts.ts` | release-readiness Phase 1, teleprompter-engines Phase 4 (`useAssetInstall`) |
| 3 | `scripts/release/prepare-resources.py`, workflows, `apps/desktop/internal/assets/store.go` | release-readiness provisioning phases, the delivered in-app update (`scripts/release/wails-build.mjs`, [ADR 0072](../adr/0072-the-app-updates-itself-from-this-repositorys-releases-and-never-installs-without-a-click.md)) |

Cross-cutting: `hostAPIVersion` unchanged unless a binding changes; each phase follows `CLAUDE.md`: plan, `change-impact-scan`, TDD (tests first, they must fail before the fix), `full-verification-gate`, `feature-cleanup`; UI-visible states add `visual-catalog-sync`; sidecar changes rebuild the frozen sidecars.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Short clips return base64 (prior, ADR 0012) | Kept | `/media` route | Standing decision |
| Real progress only (prior, ADR 0015) | Install and preview show real state | Faked spinner | Standing decision |
| Error handling | Temp file, rename on success (proposed) | Catch and delete | No partial file can exist |
| Zero-byte cache | Treated as a miss; a file no larger than a WAV header is a miss (delivered) | Trust the cache | Poisoned-cache fix |
| Cache key | Hash input is the version tag, voice id, provider, version and text; the tag moved to `v2` so files rendered under the old key are never trusted (delivered) | Keep `v1` and add the voice | Old files may be zero-byte or belong to another voice |
| Diagnosis without T1/T2 | Reproduce every cause on a dev build with the real sidecar and voice, and fix what is proven (S04) | Wait for the toast text | The owner was unavailable; causes 2, 3, 5 and 6 are confirmed, 1 by reading, 4 unproven |
| Output encoding | The guide sidecar writes UTF-8 to stdout and stderr (`use_utf8_stdio`), the encoding the Go host reads | Encode the path to cp1252 | The host reads UTF-8; the fix stays local to the guide sidecar |
| Timeout | 2 minutes, enforced in `Preview` only (delivered) | Time out every sidecar command | Other commands (build) are long-running by design |

## Research Summary

**Technical Context**: verified in code: the UI-to-Python path, every error message, cache behavior, the freeze arguments, and test coverage. Cause 2's masking was reproduced in memory only.
**Not verified**: the user's actual error, real Piper output for real names, the frozen sidecar, WebView2 decoding, and whether the install flow mismatch reproduces against the real host.

---

*Generated: 2026-09-20*
*Status: IN DELIVERY - Phase 1 complete (stack S04); Phases 2 and 3 pending*
