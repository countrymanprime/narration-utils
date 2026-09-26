# Provider Ports

**Source:** [Audiobook studio benchmark](../research/audiobook-studio-benchmark.md) recommendation 7 and §1 ("the audio engine behind a seam"), and the benchmark train plan ([agent train](../operations/agent-train.md)). **Sibling:** [DAW Port and Capabilities](daw-port-and-capabilities.prd.md) ([ADR 0300](../adr/0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md)), which creates the shared `internal/port` vocabulary this PRD reuses. **Decision record:** [ADR 0301](../adr/0301-providers-sit-behind-small-ports-with-a-registry-and-a-capability-descriptor.md) (Proposed).

Citations are `file:line` on `main` at 91bbf98 for anything checked in code; "TBD - needs <what>" marks an unknown.

## Problem Statement

The DAW port puts the audio engine behind a seam. The other things the app plugs in do not have one. Speech recognition, text to speech, pronunciation lookup, microphone capture and (later) encoding each have one or two implementations, chosen by a string compared at the call site. None has an interface, a registry or a statement of what it can do. So adding a second TTS voice engine, a third ASR engine or a capture backend for macOS means finding every `if engine == ...`, in Go and in Python, and hoping none is missed. Nothing proves that the two ASR engines that exist today behave the same way to their callers, except that the tests of one caller happen to cover both.

## Evidence

Verified in code (main at 91bbf98):

- **Live ASR: two engines, chosen by string in both languages.**
  - Go: `EngineWhisper`/`EngineMoonshine` constants, `Engines(platform)` and `SupportsEngine` in `apps/desktop/internal/teleprompter/service.go:29-55`; the engine goes on the sidecar's argv at `service.go:244`. The host picks it in `resolveTeleprompterEngine` (`apps/desktop/app.go:1180`), fills the setting's choices from `teleprompter.Engines` (`app.go:1318`) and checks it in `TeleprompterStart` (`apps/desktop/bindings.go:546`).
  - Python: the output is already engine-neutral. `Hypothesis` (`sidecars/manuscript-teleprompter/core/live_asr.py:190-199`) says "nothing downstream knows which engine it was", and `Word`/`Decoder` are plain types (`live_asr.py:115-116`). But the engine is chosen by `if`/`else`: argument checks at `live_asr.py:626-632`, the loader at `live_asr.py:885`, and `choices=["whisper", "moonshine"]` at `live_asr.py:794`. Moonshine's loader lives in `moonshine_engine.py`.
- **Batch ASR: one engine, no seam.** `transcribe()` imports faster-whisper directly (`sidecars/transcript-compare/core/compare.py:416-434`) and is called at `compare.py:530`, `:606` and `:1775`. The Go side passes `--model` and a verified `--model-dir` from `internal/whisper` (`apps/desktop/internal/transcript/service.go:623-628`); the model comes from `TranscriptCompare.model_size` (`app.go:1206`).
- **TTS: one engine, a setting nobody reads.** Piper is loaded and called in `manuscript_guide.py` (`load_voice` at `:1197-1202`, `render_audio` at `:1205-1233`). `Piper.tts_provider` is a setting with one choice (`app.go:1204`, `config/defaults.json`, `internal/settings/store.go:65`); it is read only to be echoed back in the catalog payload (`bindings.go:64`). The guide service always passes `--piper-model` (`apps/desktop/internal/guide/service.go:625`).
- **Pronunciation: a string switch.** `PRONUNCIATION_SOURCES = {"cmu", "espeak"}` (`sidecars/manuscript-guide/core/manuscript_guide.py:449`); `pronounce_source` branches on the name and raises on an unknown one (`:452-478`); the build-time fallback hard-codes the order (`:484-490`); argparse takes `--source` from the set (`:1391`). Go passes the narrator's choice through unchecked (`internal/guide/service.go:299-300`).
- **Capture: Windows dshow only.** `list_input_devices` reads FFmpeg's dshow listing through PyAV (`sidecars/manuscript-teleprompter/core/devices.py:91,117`); `iter_microphone_chunks` opens the device (`live_asr.py:452`). Off Windows the lister returns an error string. The Go side has a `deviceLister` seam for tests (`apps/desktop/teleprompterinput.go:35-36`) and `daw.MatchInputDevice` (`apps/desktop/internal/daw/inputmatch.go:54`).
- **Encoding: none.** Render goes through REAPER. `internal/chaptertags` writes ID3 chapters with `bogem/id3v2` (`apps/desktop/internal/chaptertags/chaptertags.go:11`).
- **Measurement: concrete functions with func-field seams.** `measureFile` and `diagnoseFile` on `Host` (`app.go:165-168`; types at `measure_job.go:332`, `diagnostics_job.go:61`). One implementation, in process; it needs no port.
- **Prior art that works.**
  - Model downloads: the unexported `assetProvider` interface (`apps/desktop/assetregistry.go:46`) with one implementation per kind (`apps/desktop/assetproviders.go:15,63,111`) held by `assetRegistry` (`assetregistry.go:65`). Its comment says a new kind "implements this and is registered, and the generic bindings ... serve it without further change". This is the pattern to mirror.
  - Importers: a strategy table keyed by extension (`apps/desktop/internal/importer/formats.go:17-36`). It is already open for extension; this PRD leaves it alone.
- **Python has no Protocol or ABC anywhere** in `libs/python` or `sidecars` (a search for `Protocol`, `from abc import` and `(ABC)` finds nothing outside tests). `libs/python/narration_common` is the shared library every sidecar already imports.

## Proposed Solution

Apply the DAW port's pattern to the other providers. Each provider kind gets a **port**: a small interface (a Go interface or a Python `typing.Protocol`), a **registry** keyed by the name the setting already stores, a **capability descriptor** saying what each implementation can do (platforms, modes, the asset kind its models come from), and a **conformance suite** that every registered implementation must pass. Call sites ask the registry by name and get an implementation or a `NotSupportedError`; they never compare names. The generic pieces (`Level`, `Support`, `NotSupportedError`, a generic `Registry[P]`) live in `apps/desktop/internal/port`, which the DAW port creates, and are mirrored in `libs/python/narration_common/ports`. Every phase is a refactor: existing tests stay green unmodified, settings keep their keys and values, and the narrator sees nothing change.

## Key Hypothesis

We believe that a port per provider kind, with a registry and a conformance suite, will make a new engine an adapter file plus a registry row, and will prove the engines we have are interchangeable. We'll know we're right when a test-only fake engine can be registered for each port and pass its suite without editing any call site, and when no provider name is compared outside an adapter or a registry (a guard test says so).

## What We're NOT Building

| Item | Why |
| --- | --- |
| New engines (a second TTS, a third ASR, WASAPI or CoreAudio capture) | This PRD builds the seam. Engines come from their own PRDs |
| Cloud providers of any kind | The app is local-only ([roadmap product boundary](../roadmap.md)); a port does not change that, and no descriptor has a "remote" field |
| Any change the narrator can see | Settings keep their keys, choices and defaults; sidecar command lines keep their flags |
| A port for measurement | One in-process implementation; the func-field seams on `Host` already serve tests |
| A port for importers | `internal/importer/formats.go` is already a strategy table; it is cited as prior art |
| Folding `assetProvider` into these ports | Assets are downloads, not providers. A descriptor names the asset kind it needs; `assetRegistry` stays as it is |
| An encoder implementation | The Encoder and Packager ports are declared only. The future render-encode-master PRD implements them |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Call sites that compare a provider name | Zero outside adapter and registry code | Guard tests in Go and Python (phase 15), like `hostguard_test.go` |
| Registered implementations passing their suite | All of them | Each registry's test runs the suite over every registered row, so a new row cannot skip it |
| Behaviour change | None | Existing tests pass unmodified; `tests/fixtures/contracts/` goldens unchanged; the settings schema payload unchanged |
| Cost of a new engine | One adapter file and one registry row | A test-only fake per port, registered in its suite's test, with no other file edited |
| Vocabulary drift between Go and Python | None | A Python test reads the level names from a golden the Go `internal/port` test writes |

## Open Questions

Not yet answered by the owner. Each has a recommended option.

- [ ] **Q1.** One Go package per port (`internal/asrport`, `internal/ttsport`, ...) or one `internal/providers`? **Recommended:** one per port, like `dawport`, so parallel phases touch disjoint folders.
- [ ] **Q2.** How does Go learn a Python engine's runtime capability (for example that this build can load Moonshine)? **Recommended:** a static descriptor in Go plus the probes that exist (`--check-moonshine`, the asset catalogs). A `--capabilities` flag on each sidecar is a later Could.
- [ ] **Q3.** Do `Word` and `Hypothesis` move from `live_asr.py` into `narration_common/ports/asr.py`? **Recommended:** move them and re-export from `live_asr.py`, so the Protocol and the existing imports both work.
- [ ] **Q4.** Does the one-choice `Piper.tts_provider` row stay on the Settings page? **Recommended:** yes, unchanged (D3). Its choices come from the registry, which today has one row.
- [ ] **Q5.** Is "web lookup opens in the browser" a `PronunciationSource`? **Recommended:** yes, as a separate role (`BrowserLookup`, returns a URL the host opens, never fetched by the app). The role is declared here with no implementation; the source itself belongs to benchmark recommendation 6's PRD.

## Users & Context

- **The owner and agents adding an engine.** Today they read three call sites in two languages. With this, they write an adapter, add a row and run the suite.
- **The owner reviewing a port migration.** Each phase changes the path a call takes, not its result, so review is "same tests, same goldens".
- **The narrator.** Unaffected. A later PRD may use the `ProviderCapabilities` payload to explain a disabled choice (for example Moonshine off Windows) the way the DAW port explains a disabled control.

## Solution Detail

### Core capabilities (MoSCoW)

| Priority | Capability |
| --- | --- |
| Must | Python port kit in `narration_common/ports`: `Level`, `NotSupportedError`, `Registry`, `Descriptor`, a conformance runner |
| Must | Go `port.Registry[P]` beside DAW port's `Level`, `Support` and `NotSupportedError` in `internal/port` |
| Must | `AsrEngine` port: live and batch roles in one Python module; a Go registry with platform and mode capability; Whisper and Moonshine adapters (live), faster-whisper adapter (batch) |
| Must | `TtsEngine` port with the Piper adapter; Go registry feeding `Piper.tts_provider`'s choices |
| Must | `PronunciationSource` port with CMU and eSpeak adapters; the build-time fallback order comes from the registry |
| Must | `CaptureBackend` port with the dshow adapter; a Go registry that says which platform has a backend |
| Must | A conformance suite per port that every implementation passes (Liskov) and selection by setting key through the registry (open/closed) |
| Should | `BrowserLookup` role declared on `PronunciationSource` (no implementation) |
| Should | Read-only `ProviderCapabilities` binding, after the DAW port's `DawCapabilities` |
| Could | `Encoder` and `Packager` ports declared, no implementation |
| Could | WASAPI and CoreAudio capture adapters (later, own PRD) |
| Won't | New engines, cloud providers, user-visible change |

### MVP scope

Phases 1 to 6: the kits and the ASR port end to end. ASR is the one provider with two engines today, so it proves the pattern. TTS, pronunciation and capture follow the same shape.

### User flow

There is no narrator flow. The developer flow after this PRD:

1. Write `sidecars/<sidecar>/core/<engine>_adapter.py` implementing the port's Protocol, and register it under the name the setting will store.
2. Add a Go registry row with its descriptor (platforms, modes, asset kind).
3. Run the port's conformance suite; it picks up the new row by itself.
4. Add the name to the setting's choices by appending a row to `config/defaults.json` if it becomes a default; nothing else changes.

## Technical Approach

**Feasibility: high.** Every adapter wraps code that exists and is tested. The Python output types (`Hypothesis`, the pronunciation dict, the WAV file) are already engine-neutral; only selection is not.

**Architecture:**

```go
package port // apps/desktop/internal/port, created by daw-port P1
// Level, Support, NotSupportedError: as ADR 0300 defines them.
type Registry[P any] struct{ /* ordered rows: name → Entry[P] */ }
type Entry[P any] struct{ Name string; Descriptor Descriptor; New func() P }
func (r *Registry[P]) Register(e Entry[P])            // panics on a duplicate name
func (r *Registry[P]) Lookup(name string) (Entry[P], error) // *NotSupportedError when absent
func (r *Registry[P]) Names(platform string) []string // declared for platform, default first

package asrport // one per port: ttsport, pronunciationport, captureport, encodeport
type Mode string // "live" | "batch"
var Engines = port.Registry[Engine]{} // rows: whisper {live, batch, all platforms, asset "whisper"}, moonshine {live, windows, asset "moonshine"}
```

```python
# libs/python/narration_common/ports/asr.py
class LiveTranscriber(Protocol):
    def hypotheses(self, chunks: Iterable[Any]) -> Iterator[Hypothesis]: ...
    def close(self) -> None: ...
class BatchTranscriber(Protocol):
    def transcribe(self, audio: Any, request: BatchRequest) -> BatchResult: ...
class AsrEngine(Protocol):
    descriptor: Descriptor           # name, modes, platforms, languages
    def live(self, request: LiveRequest) -> LiveTranscriber: ...   # NotSupportedError if not declared
    def batch(self, request: BatchRequest) -> BatchTranscriber: ...
ENGINES: Registry[AsrEngine]        # filled by each sidecar's adapters at import
```

- **Single responsibility:** an adapter only loads and calls its engine; the registry only maps names to adapters; the shared layers (`confirmed_events`, the tracker, the diff) stay engine-blind.
- **Open/closed:** selection is `registry.lookup(setting_value)`; a new engine is a new row. The guard tests in phase 15 fail on a name compared anywhere else.
- **Liskov:** `asr_conformance.run(engine)` (Python) and `asrporttest.Run(t, entry)` (Go) check the same things for every row: declared roles return a working object, undeclared ones raise `NotSupportedError` with a message, output timings are monotonic and non-negative, and `close()` is safe twice. Real engines run the suite with a fake model (as `test_moonshine_engine.py` does today) so CI needs no model files.
- **Interface segregation:** live and batch are separate roles; `BrowserLookup` is separate from `PronunciationSource.pronounce`.
- **Dependency inversion:** call sites take the role, not the engine module. Heavy imports (`faster_whisper`, `moonshine_voice`, `piper`, `av`) stay lazy inside each adapter, as they are today, so `narration_common` never imports them and needs no numpy at import time.
- **Settings and wire:** setting keys and values are unchanged; choice lists come from `Registry.Names(platform)`, which returns today's lists. `ProviderCapabilities()` (Should) returns `{asr, tts, pronunciation, capture: {<name>: {modes, support}}}` using the `Support` schema of `api/schemas/daw.ts`.

**Risks:**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A migration changes behaviour silently | Medium | Existing tests pass unmodified; goldens unchanged; each B phase adds only conformance tests |
| PyInstaller misses `narration_common.ports` or an adapter registered only by import | Low | Adapters are imported by name from the sidecar's entry module; the packaged smoke test (`apps/desktop/smoke.go`) already runs the frozen sidecars |
| Moonshine cannot run in CI (Windows-only native library) | High | Its conformance run uses a fake transcriber, as `test_moonshine_engine.py` does; the real library stays checked by the smoke test |
| `live_asr.py` edited by two phases (ASR and capture) | Medium | Phase 11 depends on phase 5 |
| Registry names drift from setting values | Low | The registry test asserts `Names(platform)` equals the settings choice list at `app.go:1204-1206,1318` |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Python port kit | `narration_common/ports`: `Level`, `NotSupportedError`, `Registry`, `Descriptor`, conformance runner; level golden check | complete | with 2, daw-port P1 | - | - |
| 2 | Go port registry | `port.Registry[P]` in `internal/port/registry.go` with its tests | pending | with 1 | daw-port P1 | - |
| 3 | ASR contract (Python) | `ports/asr.py`: `AsrEngine`, `LiveTranscriber`, `BatchTranscriber`; `Word`, `Hypothesis` moved; `asr_conformance` | complete | with 4, 7, 9, 10, 12 | 1 | - |
| 4 | ASR registry (Go) | `internal/asrport` + `asrporttest`; `teleprompter.Engines`/`SupportsEngine` delegate to it | pending | with 3, 7, 9, 10, 12 | 2 | - |
| 5 | Live ASR adapters | Whisper and Moonshine adapters; `live_asr.py` selects through the registry | pending | with 6, 8 | 3 | - |
| 6 | Batch ASR adapter | faster-whisper adapter; `compare.py`'s `transcribe()` goes through it | pending | with 5, 8 | 3 | - |
| 7 | TTS and pronunciation contracts (Python) | `ports/tts.py`, `ports/pronunciation.py` (with the `BrowserLookup` role, Should) and their suites | pending | with 3, 4, 9, 10, 12 | 1 | - |
| 8 | Piper and pronunciation adapters | Piper, CMU and eSpeak adapters; `manuscript_guide.py` selects through the registries | pending | with 5, 6 | 7 | - |
| 9 | TTS and pronunciation registries (Go) | `internal/ttsport`, `internal/pronunciationport`; setting choices and the catalog payload from them; `Pronounce` checks the source | pending | with 3, 4, 7, 10, 12 | 2 | - |
| 10 | Capture contract (Python) | `ports/capture.py`: `CaptureBackend` (`list_devices`, `chunks`) and its suite | pending | with 3, 4, 7, 9, 12 | 1 | - |
| 11 | dshow capture adapter | `devices.py` and `iter_microphone_chunks` behind a dshow adapter | pending | with 6, 8 | 5, 10 | - |
| 12 | Capture registry (Go) | `internal/captureport` with the dshow row (Windows) | pending | with 3, 4, 7, 9, 10 | 2 | - |
| 13 | Encoder and Packager ports (Could) | `internal/encodeport`: interfaces, empty registry, suite | pending | with any | 2 | - |
| 14 | Provider capabilities on the wire (Should) | `ProviderCapabilities` binding; schema, golden, `wireContracts` row, mock; `hostAPIVersion` + 1 | pending | no | 4, 9, 12, daw-port P4 | - |
| 15 | Guards and steady state | Go and Python guard tests; `docs/architecture/provider-ports.md`; codebase map; threat-model row 4a re-read; accept ADR 0301; delete this PRD | pending | no | 5, 6, 8, 11 (and 13, 14 if taken) | - |

### Phase details

Each phase lists the port it defines or migrates. All are refactors: existing tests pass unmodified and the phase adds conformance tests.

- **P1 (lane K). Port: the Python kit.**
  - `libs/python/narration_common/ports/__init__.py` and `registry.py`: `Level` (the four names of ADR 0300), `NotSupportedError(name, level, message)`, `Descriptor` (frozen dataclass: name, label, platforms, modes), `Registry[P]` (a dict with `register`, `lookup`, `names(platform)`, duplicate names refused), and `conformance.py` with the shared checks.
  - The Go `internal/port` test writes `tests/fixtures/contracts/port-levels.json` (`UPDATE_CONTRACTS=1`); a Python test reads it and fails if the names differ. Until daw-port P1 lands the golden is absent and the test skips with a reason.
  - Validate: `libs/python/tests/test_ports.py`.
- **P2 (lane K). Port: the Go registry.**
  - `apps/desktop/internal/port/registry.go` (a new file in the package daw-port P1 creates): `Registry[P]`, `Entry[P]`, `Lookup` returning `*port.NotSupportedError`. If daw-port P1 has already added a generic registry, this phase reuses it and only adds the tests below.
  - Validate: `go test ./internal/port/...`.
- **P3 (lane K). Port: `AsrEngine` (Python).**
  - `ports/asr.py` with the roles above and `asr_conformance.py`. `Word` and `Hypothesis` move here (Q3); `live_asr.py` re-exports them so every existing import works.
  - A fake engine in the test passes the suite; a fake that declares live but raises from `live()` fails it.
  - Built: `LiveRequest` and `BatchRequest` carry the model, `model_dir`, language, hotwords and device, plus a read-only `options` map for what one engine alone takes (the adapter checks its own keys); `BatchRequest.progress(done, total)` replaces `write_progress`/`check_cancelled` for P6 (raising from it cancels). `BatchResult` carries the words and the detected language and probability. `AsrDescriptor` adds `languages` and `asset_kind`, and `refuse(mode)` gives the refusal. `ENGINES` is empty until P5 and P6 register their adapters. `asr_conformance.run(engine, live_request=, batch_request=, chunks=, audio=)` also checks that segments never go back or reopen after a final hypothesis, and that words are non-blank. Validate: `libs/python/tests/test_ports_asr.py`.
- **P4 (lane K). Port: `AsrEngine` (Go).**
  - `internal/asrport`: rows `whisper` (live and batch, every platform, asset kind `whisper`) and `moonshine` (live, `windows`, asset kind `moonshine`, ADR 0107). `asrporttest.Run` over every row.
  - `teleprompter.Engines` and `SupportsEngine` keep their signatures and call `asrport.Engines.Names`. `app.go` and `bindings.go` are untouched.
  - Validate: `internal/teleprompter` tests unchanged; a test that `Names("windows")` and `Names("darwin")` equal today's lists.
- **P5 (lane B). Port: `AsrEngine`, live adapters.**
  - `sidecars/manuscript-teleprompter/core/asr_adapters.py`: `WhisperEngine` (wraps `_load_whisper_decoder` and `whisper_hypotheses`) and `MoonshineEngine` (wraps `moonshine_engine.load_transcriber` and `moonshine_hypotheses`). Each descriptor carries its own argument rules (Moonshine's model sizes and English only).
  - `live_asr.py`: the loader at `:885` and the checks at `:626-632` become a registry lookup and `descriptor.check(args)`; argparse `choices` come from `ENGINES.names()`. The error texts stay word for word. `--locate` keeps the Whisper decoder, obtained from the Whisper adapter.
  - Validate: `test_live_asr.py`, `test_moonshine_engine.py` unchanged; the suite over both adapters (Moonshine with a fake transcriber).
- **P6 (lane B). Port: `AsrEngine`, batch adapter.**
  - `sidecars/transcript-compare/core/asr_batch.py`: `FasterWhisperEngine` with the body of `transcribe()`; `transcribe()` stays as a thin function with its signature, so its three callers and `coverage_mode.py` are unchanged.
  - Validate: `test_compare.py`, the coverage tests and goldens unchanged; the suite with a fake `WhisperModel`.
- **P7 (lane K). Ports: `TtsEngine` and `PronunciationSource` (Python).**
  - `ports/tts.py`: `TtsEngine.load(voice_path) -> Voice`, `Voice.synthesize_to_file(text, destination)`, with the rule `synthesize_to_file` already keeps: nothing is left at `destination` on failure.
  - `ports/pronunciation.py`: `PronunciationSource.pronounce(name) -> dict` raising `ValueError` with a narrator message when it has no entry; `fallback_order` on the registry; and the `BrowserLookup` role (`url_for(name) -> str`), declared with no implementation (Q5).
- **P8 (lane B). Ports: `TtsEngine` and `PronunciationSource`, adapters.**
  - `sidecars/manuscript-guide/core/providers.py`: `PiperEngine`, `CmuSource`, `EspeakSource`. `PRONUNCIATION_SOURCES` becomes `SOURCES.names()`; `pronounce_source` and `pronunciation` look up the registry; `render_audio` gets Piper from the TTS registry. `--piper-model` and `--source` keep their names.
  - Validate: `test_pronounce.py`, `test_manuscript_guide.py`, the contract goldens unchanged; the suites over each adapter with the fakes those tests use.
- **P9 (lane K). Ports: `TtsEngine` and `PronunciationSource` (Go).**
  - `internal/ttsport` (row `piper`, asset kind `tts`) and `internal/pronunciationport` (rows `cmu`, `espeak`). `fieldSchemas`' `Piper.tts_provider` choices and `ttsCatalogPayload` read the TTS registry; `guide.Service.Pronounce` refuses an unregistered source with a `*port.NotSupportedError` before starting the sidecar (today the sidecar refuses it; the narrator sees the same refusal).
  - Validate: the settings schema test and `tests/fixtures/contracts/` goldens unchanged.
- **P10 (lane K). Port: `CaptureBackend` (Python).**
  - `ports/capture.py`: `list_devices() -> (devices, error)` and `chunks(device, chunk_seconds) -> Iterator[array]`, matching `list_input_devices` and `iter_microphone_chunks` today. Descriptor platforms.
- **P11 (lane B). Port: `CaptureBackend`, dshow adapter.**
  - `sidecars/manuscript-teleprompter/core/capture_dshow.py` wraps `devices.py` and the body of `iter_microphone_chunks`; `live_asr.py`'s two capture callers, the session (`:886`) and the level meter (`:769`), look up the backend for this platform. Off Windows the lookup gives today's error string.
  - Validate: `test_devices.py`, `test_levels.py`, `test_live_asr.py` unchanged; the suite with the fake log capture `test_devices.py` uses.
- **P12 (lane K). Port: `CaptureBackend` (Go).**
  - `internal/captureport`: one row, `dshow`, platform `windows`. Nothing calls it yet except P14; `deviceLister` stays the test seam of `teleprompterinput.go`.
- **P13 (lane K, Could). Ports: `Encoder` and `Packager`.**
  - `internal/encodeport`: `Encoder.Encode(ctx, wav, dst, spec)` and `Packager.Package(ctx, file, chapters, tags)`, an empty registry and `encodeporttest.Run`. `chaptertags` is the likely first `Packager`; moving it is left to the render-encode-master PRD.
- **P14 (lane K, Should). Provider capabilities on the wire.**
  - A new read-only `ProviderCapabilities()` binding in `apps/desktop/bindings_providers.go`, reading the registries and the asset catalogs' install state. It follows the wire contract rules in CLAUDE.md: `apps/ui/src/api/schemas/providers.ts` (reusing the `Support` schema), a golden written by a Go test, a row in `wireContracts.test.ts`, a mock. `hostAPIVersion` + 1. No screen reads it in this PRD.
- **P15 (lane K, then D). Guards and steady state.**
  - `apps/desktop/providerguard_test.go` fails on a comparison with a provider name outside `internal/*port` and adapters; `libs/python/tests/test_provider_guard.py` does the same for `engine ==`, `source ==` and name sets in `sidecars/`.
  - `docs/architecture/provider-ports.md` (the port table), the codebase map, the threat-model row 4a (the engine check now names the registry) and `SECURITY.md` if its wording changes. ADR 0301 to Accepted. This PRD is deleted, with the unbuilt Coulds moved to their own PRDs.

### Parallelism notes

- P1 and P2 are independent: Python and Go. P2 waits for daw-port P1's `internal/port`.
- The contract phases (P3, P7, P10 in Python; P4, P9, P12 in Go) touch new files only and can all run at once.
- The adapter phases split by sidecar: P5 (teleprompter), P6 (transcript compare) and P8 (manuscript guide) run together. P11 is also in the teleprompter sidecar, so it follows P5.
- P14 waits for the DAW port's binding (daw-port P4) so both share one `Support` schema, and for the Go registries it reports.
- P15 is last.

### Parallel-session compatibility

| Phase | Files it touches | Collides with |
| --- | --- | --- |
| 1 | `libs/python/narration_common/ports/**` (new), `libs/python/tests/test_ports.py` (new) | none |
| 2 | `apps/desktop/internal/port/registry.go`, `registry_test.go` (new), `tests/fixtures/contracts/port-levels.json` (new) | daw-port P1 (same package; waits for it) |
| 3 | `narration_common/ports/asr.py`, `asr_conformance.py` (new), `sidecars/manuscript-teleprompter/core/live_asr.py` (the `Word`/`Hypothesis` re-export only) | P5, P11 on `live_asr.py` (serialized by Depends) |
| 4 | `apps/desktop/internal/asrport/**` (new), `internal/teleprompter/service.go` (`Engines`, `SupportsEngine`) | Teleprompter Engines and Input Devices phases 8 and 12 |
| 5 | `sidecars/manuscript-teleprompter/core/live_asr.py`, `asr_adapters.py` (new), `moonshine_engine.py`, `tests/test_asr_conformance.py` (new) | P11; Teleprompter Manuscript Integration phase 13; Read Aloud PRDs editing `live_asr.py` |
| 6 | `sidecars/transcript-compare/core/compare.py`, `asr_batch.py` (new), `tests/test_asr_batch.py` (new) | Recording Check Model Cascade; Proofing Vocabulary Hints |
| 7 | `narration_common/ports/tts.py`, `pronunciation.py` and their suites (new) | none |
| 8 | `sidecars/manuscript-guide/core/manuscript_guide.py`, `providers.py` (new), `tests/test_providers.py` (new) | Story Bible and Import UX Briefs phases 10 and 11 |
| 9 | `apps/desktop/internal/ttsport/**`, `internal/pronunciationport/**` (new), `app.go` (`fieldSchemas` Piper row), `bindings.go` (`ttsCatalogPayload`), `internal/guide/service.go` (`Pronounce`) | Any phase adding a settings row in `app.go`; Story Bible PRDs editing `guide/service.go` |
| 10 | `narration_common/ports/capture.py` and its suite (new) | none |
| 11 | `sidecars/manuscript-teleprompter/core/devices.py`, `live_asr.py` (`iter_microphone_chunks` and its two callers), `capture_dshow.py` (new) | P5 (waits for it); Read Aloud Control Bar (level meter) |
| 12 | `apps/desktop/internal/captureport/**` (new) | none |
| 13 | `apps/desktop/internal/encodeport/**` (new) | none |
| 14 | `apps/desktop/bindings_providers.go` (new), `app.go` and `app_test.go` (`hostAPIVersion`), `apps/ui/src/hostApi.ts`, `api/contracts/providers.ts`, `api/schemas/providers.ts`, `api/providersMock.ts`, `wireContracts.test.ts`, `tests/fixtures/contracts/provider-capabilities*.json`, regenerated `Host.*` | Any phase that bumps `hostAPIVersion` (daw-port P4 first) |
| 15 | `apps/desktop/providerguard_test.go`, `libs/python/tests/test_provider_guard.py` (new), `docs/architecture/provider-ports.md` (new), `docs/architecture/codebase-map.md`, `docs/architecture/threat-model.md`, `SECURITY.md`, `docs/adr/0301-*`, `docs/prds/README.md` | Other doc phases editing the codebase map or row 4a |

## Decisions Log

| # | Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- | --- |
| D1 | Shared vocabulary | Ports use `internal/port` (`Level`, `Support`, `NotSupportedError`, `Registry[P]`), created by daw-port P1; Python mirrors the level names and a golden keeps them equal | A vocabulary per port | One way to say "not supported, and why" for the DAW and every provider; one `Support` schema on the wire |
| D2 | Python shape | `typing.Protocol` for each port and plain dict registries filled at import | ABCs; entry-point plugins | Protocols need no inheritance, so existing classes and fakes fit as they are; a dict is enough for a handful of in-tree engines, and plugins would widen the trust boundary |
| D3 | Behaviour | No change the narrator or a sidecar's caller can see: same settings, same flags, same messages, same goldens | Tidy the settings (for example hide the one-choice TTS row) while here | Keeps every phase a reviewable refactor; visible changes go to the PRD that needs them |

## Research Summary

- **Codebase:** see Evidence. `assetProvider` is the in-repo template (a small interface, one implementation per kind, one registry, generic callers). `internal/importer/formats.go` shows the same idea as a table. The Python sidecars already emit engine-neutral output, so selection is the only coupling to remove.
- **Sibling work:** the [DAW port](daw-port-and-capabilities.prd.md) defines the level vocabulary, `Role[T]` and the conformance-suite style this PRD copies. Its P1 creates `internal/port`; its P4 adds the `Support` schema P14 reuses.
- **Language:** Go generics (1.18+) give a typed `Registry[P]` with no reflection. `typing.Protocol` (Python 3.8+) is checked structurally by type checkers and needs no runtime base class; the conformance suites check behaviour at runtime.
