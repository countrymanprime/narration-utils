# Provider ports

The things the app plugs in that are not a DAW (speech recognition, text to speech, pronunciation lookup, microphone capture and, later, encoding) each sit behind a **port**: a small interface, a registry keyed by the name the setting stores, a capability descriptor per implementation, and a conformance suite every implementation passes. Call sites ask the registry by name and never compare names; guard tests in Go and Python fail the build otherwise. The decision is [ADR 0301](../adr/0301-providers-sit-behind-small-ports-with-a-registry-and-a-capability-descriptor.md); it applies the pattern of the DAW port ([ADR 0300](../adr/0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md), [DAW integration](daw-integration.md)) and shares its vocabulary. It was built by the provider ports PRD (phases 1 to 15, 2026-09-26 to 2026-09-27), which this page replaces.

Nothing about ports is visible to the narrator: setting keys, values and choice lists, sidecar flags, error texts and the contract goldens are what they were before the ports existed.

## The ports

| Port | Roles (modes) | Go registry (host) | Python protocol and registry | Rows today | Suites |
| --- | --- | --- | --- | --- | --- |
| Speech recognition, `AsrEngine` | `live` (the teleprompter), `batch` (transcript compare) | `internal/asrport`: `asrport.Engines` | `narration_common.ports.asr`: `AsrEngine`, `LiveTranscriber`, `BatchTranscriber`; `ENGINES` | `whisper` (live and batch, every platform, asset kind `whisper`), `moonshine` (live, Windows, asset kind `moonshine`, English only, runs only from a verified install: [ADR 0107](../adr/0107-moonshine-ships-inside-the-windows-teleprompter-sidecar-and-runs-only-from-a-verified-catalog-install.md)) | `asrporttest.Run`; `asr_conformance.run` |
| Text to speech, `TtsEngine` | none | `internal/ttsport`: `ttsport.Engines` | `narration_common.ports.tts`: `TtsEngine`, `Voice`; `ENGINES` | `piper` (asset kind `tts`) | `ttsporttest.Run`; `tts_conformance.run` |
| Pronunciation, `PronunciationSource` | `pronounce`; `browse` (the `BrowserLookup` role: a URL the narrator's browser opens, never fetched by the app) | `internal/pronunciationport`: `pronunciationport.Sources` | `narration_common.ports.pronunciation`: `PronunciationSource`, `BrowserLookup`; `SOURCES` (its `fallback_order()` is the build-time order) | `cmu`, `espeak` (both `pronounce`; no `browse` row yet) | `pronunciationporttest.Run`; `pronunciation_conformance.run` |
| Capture, `CaptureBackend` | none (one backend per platform) | `internal/captureport`: `captureport.Backends`, `captureport.For(platform)` | `narration_common.ports.capture`: `CaptureBackend`, `InputDevice`; `BACKENDS` | `dshow` (Windows) | `captureporttest.Run`; `capture_conformance.run` |
| Encoding, `Encoder` and `Packager` | the formats a row handles (`mp3`, `m4b`) | `internal/encodeport`: `NewEncoders()`, `NewPackagers()` | none (the host would run them) | none: declared only | `encodeporttest.RunEncoder`, `RunPackager` |

The Python adapters that fill the registries live beside the code that used to call the engine directly, and register themselves when their sidecar imports them:

| Sidecar | Adapter module | Rows |
| --- | --- | --- |
| `manuscript-teleprompter` | `core/asr_adapters.py` (wrapping `live_asr.py`'s Whisper decoder and `moonshine_engine.py`) | `whisper`, `moonshine` (live) |
| `manuscript-teleprompter` | `core/capture_dshow.py` (wrapping `devices.py` and the microphone reader) | `dshow` |
| `transcript-compare` | `core/asr_batch.py` (the body of `compare.py`'s `transcribe()`) | `whisper` (batch) |
| `manuscript-guide` | `core/providers.py` | `piper`, `cmu`, `espeak` |

Each sidecar is its own process, so the teleprompter's live `whisper` row and transcript compare's batch `whisper` row never share a registry.

## The shared vocabulary

- **Go:** `apps/desktop/internal/port` holds `Level` (unsupported, not yet available, experimental, supported), `Support`, `NotSupportedError` and the generic `Registry[P]` with `Entry[P]` (name, `Descriptor`, constructor). `Register` panics on a duplicate name or a missing label; `Lookup` returns a `*port.NotSupportedError` with a sentence for the narrator ("There is no speech engine called …"); `Names(platform)` lists the rows declared for a platform, default first. The DAW port uses the same `Level` and `Support`.
- **Python:** `libs/python/narration_common/ports` mirrors them: `Level`, `NotSupportedError` (a `ValueError`, so older `except ValueError` callers still catch it), a frozen `Descriptor` (name, label, platforms, modes) and `Registry` (`register`, `lookup`, `names(platform)`). The Go `internal/port` test writes `tests/fixtures/contracts/port-levels.json`, and a Python test fails if the level names differ.
- **A descriptor** says what a row can do without starting it: platforms (empty means every platform), modes, and per port the asset kind its models or voices install from, its languages, or its browser host. A refusal for an undeclared mode comes from the descriptor (`refuse(mode)`), so every port words it the same way.
- Heavy imports (`faster_whisper`, `moonshine_voice`, `piper`, `av`) stay inside the adapters and load lazily, so importing `narration_common` needs no engine and no numpy.

## Selection

A call site asks the registry, by the name the setting stores, and gets an implementation or a `NotSupportedError`:

- **Host:** the Teleprompter's engine choices and its start check are `teleprompter.Engines`/`SupportsEngine`, which read `asrport`. `liveModelDir` picks the model catalog by the engine's asset kind (`asrport.AssetKind`), and the service refuses a session with no install directory for an engine that runs only from one (`asrport.NeedsInstalledModel`). The `Piper.tts_provider` setting's choices and the voice catalog payload read `ttsport`. `guide.Service.Pronounce` refuses an unregistered source before it starts the sidecar (`pronunciationport.CheckPronounce`).
- **Sidecars:** `live_asr.py` loads the `--engine` row of `ENGINES` with one `LiveRequest` whose `options` each adapter reads its own keys from, checks the arguments with the row's own `check`, and takes `--engine`'s choices from `ENGINES.names()`. `compare.py`'s `transcribe()` goes through the batch row. `manuscript_guide.py` takes `--source`'s choices, the build-time fallback order and each source's failure message from `SOURCES`, and gets Piper from the TTS registry. The microphone reader (`iter_microphone_chunks`, used by a session and the level meter) takes its chunks from the `dshow` row of `BACKENDS`; `--list-devices` still calls the adapter's lister in `devices.py` directly, and off Windows both give the same error text as before.

## Conformance

Every registered row passes its port's suite, and each registry's own test runs the suite over every row, so a new row cannot skip it (Liskov). The suites check the same things in both languages where both exist: a declared role returns a working object and an undeclared one raises `NotSupportedError` with a message; output timings are monotonic and non-negative and a closed segment never reopens; `close()` is safe twice; a TTS failure leaves nothing at the destination; a pronunciation miss is a `ValueError`, not a `NotSupportedError`, and a browser URL is https on the declared host whatever the name; a capture backend's listing never raises and a missing device raises instead of going quiet. Engines that cannot run in CI (Moonshine's Windows-only library, model files) run their suite against a fake model; the packaged smoke test (`apps/desktop/smoke.go`, `--check-moonshine`) still checks the real library. Each suite's own tests register a test-only fake and show it passing with no other file edited.

## The guards

- **Go:** `apps/desktop/providerguard_test.go` parses every non-test Go file of the module and fails on `==`, `!=`, a `switch` case, or a composite literal listing two or more names, where a side is a provider name: a string literal of a registered name, or a constant that spells one (a port package's own constants, and any constant defined as one of them, such as `teleprompter.EngineWhisper`). Code inside `internal/*port` is exempt. An asset kind that happens to share a name (`installKindMoonshine`) is not a provider name. The one exception, `smoke.go`'s `checkFrozenMoonshine` (it checks the report names the engine it asked about), carries its reason, and an exception that stops being needed fails the guard.
- **Python:** `libs/python/tests/test_provider_guard.py` reads the provider names from the adapters' own `descriptor = …Descriptor(…)` declarations and fails on a comparison (`==`, `!=`, `in`, `is`, a `match` case) with one, or a set, list, tuple or dict literal listing two or more, in any `sidecars/*/core/` module that is not an adapter. Its two exceptions (`devices.py`, the dshow adapter's lister, where `"dshow"` is FFmpeg's log context; `locate.py`, a Whisper-only tool that refuses other engines) carry their reasons and fail when no longer needed.
- Both guards run their own fixtures to prove they fire.

## Capabilities on the wire

`ProviderCapabilities()` (`apps/desktop/bindings_providers.go`) is a read-only binding that reports every row of the speech recognition, voice, pronunciation and capture registries: label, whether it is the default, platforms, modes, the asset kind with the installed count when its catalog is present, and a `support` in the DAW port's `Support` shape (supported on this platform, or unsupported with a reason and a sentence for the narrator). It takes no input and changes nothing. Its schema is `apps/ui/src/api/schemas/providers.ts`, its goldens `tests/fixtures/contracts/provider-capabilities-{windows,darwin}.json`, and its mock `apps/ui/src/api/providersMock.ts` ([wire contracts](wire-contracts.md)). No screen reads it yet; a later feature may use it to explain a disabled choice (Moonshine off Windows) the way `DawCapabilities` explains a disabled DAW control. The empty encoder and packager registries are left off it until a row lands.

## Adding an engine

1. Write the adapter beside its sidecar's code (`sidecars/<sidecar>/core/<engine>_adapter.py` or a row in the existing adapter module), implementing the port's Protocol, with a descriptor under the name the setting will store. Keep its heavy imports inside its methods.
2. Import it from the sidecar's entry module, so it registers and PyInstaller sees it.
3. Add the Go registry row with the same name and its descriptor (platforms, modes, asset kind). A new speech engine whose models install from a new asset kind also needs a branch in `liveModelDir` (`TestEveryLiveEngineInstallsFromACatalogLiveModelDirServes` fails until it has one).
4. Run the port's suites: they pick up the new row by themselves. The guards need no change.
5. If it becomes a default, append its row to `config/defaults.json`; nothing else changes.

## What is not a port

- **Measurement** keeps its concrete, in-process functions and the func-field seams on `Host` (`measureFile`, `diagnoseFile`): one implementation needs no registry.
- **Importers** keep their strategy table keyed by extension (`internal/importer/formats.go`), which is already open for extension.
- **Asset downloads** keep `assetProvider` and `assetRegistry` ([ADR 0079](../adr/0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md)). A provider's descriptor names the asset kind it needs; assets are downloads, not providers.
- **Remote providers:** none. No descriptor has a field for one, which holds [the roadmap's product boundary](../roadmap.md).

## Not built here, and where it went

| Item | Home |
| --- | --- |
| An `Encoder` and a `Packager` (MP3, M4B, chapters) | [Render, Encode and Master](../prds/render-encode-master.prd.md), phases 1, 2 and 4; `internal/chaptertags` is the likely first `Packager` |
| `BrowserLookup` rows (web pronunciation lookups the narrator's browser opens) | [Prep Depth](../prds/prep-depth.prd.md), phase 2 |
| WASAPI capture | [Native Recording Suite](../prds/native-recording-suite.prd.md) (its capture engine spike, Q3); if the engine stays in a Python sidecar it is a `CaptureBackend` row |
| CoreAudio (macOS) capture | [CoreAudio Capture](../prds/coreaudio-capture.prd.md); a `CaptureBackend` row (`coreaudio`), a PyAV `avfoundation` sidecar adapter mirroring `dshow`'s shape (ADR 0402, Proposed) |
| A `--capabilities` flag on each sidecar so the host learns an engine's runtime capability instead of from a static descriptor and the existing probes | [Sidecar Capabilities Flag](../prds/sidecar-capabilities-flag.prd.md); reports what a sidecar process actually registered, consumed by `smoke.go` (ADR 0403, Proposed) |

## Decisions taken while building it

- One Go package per port (`asrport`, `ttsport`, `pronunciationport`, `captureport`, `encodeport`), like `dawport`, so parallel work touched disjoint folders.
- Go learns a Python engine's capability from a static descriptor plus the probes that exist, not from asking the sidecar.
- `Word` and `Hypothesis` moved into `narration_common.ports.asr`; `live_asr.py` re-exports them, so every existing import works.
- The one-choice `Piper.tts_provider` row stays on the Settings page, its choices from the registry.
- Python ports are `typing.Protocol`s with plain registries filled at import, not ABCs or entry-point plugins: existing classes and fakes fit as they are, and plugins would widen the trust boundary.
- No change the narrator or a sidecar's caller can see; visible changes belong to the feature that needs them.

The trust-boundary side (the engine and pronunciation-source checks before a sidecar starts) is row 4a of the [threat model](threat-model.md).
