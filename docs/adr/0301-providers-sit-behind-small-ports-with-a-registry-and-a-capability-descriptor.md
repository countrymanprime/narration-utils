# 0301. Providers sit behind small ports with a registry and a capability descriptor

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:** none. It applies [ADR 0300](0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md)'s pattern to the providers that are not a DAW, and reuses its `internal/port` vocabulary.

## Context

ADR 0300 puts every DAW behind one port. The app has other providers, and none of them has an interface:

- **Live speech recognition:** Whisper and Moonshine, chosen by string. Go holds constants and `Engines(platform)` in `apps/desktop/internal/teleprompter/service.go`; Python branches on `args.engine` in `sidecars/manuscript-teleprompter/core/live_asr.py`. The output (`Hypothesis`) is already engine-neutral.
- **Batch speech recognition:** faster-whisper imported directly by `transcribe()` in `sidecars/transcript-compare/core/compare.py`.
- **Text to speech:** Piper only, in `sidecars/manuscript-guide/core/manuscript_guide.py`. The `Piper.tts_provider` setting has one choice and nothing dispatches on it.
- **Pronunciation:** `PRONUNCIATION_SOURCES = {"cmu", "espeak"}` and a string switch in `manuscript_guide.py`.
- **Microphone capture:** Windows dshow only, in `sidecars/manuscript-teleprompter/core/devices.py`.
- **Encoding:** none; render goes through REAPER.

Adding an engine means finding every string comparison, in two languages. Nothing proves the two ASR engines behave the same to their callers. There is no Protocol or ABC anywhere in `libs/python` or `sidecars`.

The repository already has one pattern that works. `assetProvider` (`apps/desktop/assetregistry.go`) is a small interface, with one implementation per asset kind held in one registry, and generic callers. The [audiobook studio benchmark](../research/audiobook-studio-benchmark.md) (§1 and recommendation 7) asks for the audio engine behind a seam, and later for macOS capture and built-in encoding, which need these seams first. The work is specified in [Provider Ports](../prds/provider-ports.prd.md).

## Decision

**The ports:**
- Each provider kind has a port: `AsrEngine` (live and batch roles), `TtsEngine`, `PronunciationSource` (with a declared `BrowserLookup` role for a web lookup the browser opens, never fetched by the app), `CaptureBackend`, and, declared only, `Encoder` and `Packager`.
- A port is four things:
  - a small interface: a Go interface, or a `typing.Protocol` in `libs/python/narration_common/ports`;
  - a registry keyed by the name the setting already stores;
  - a capability descriptor per implementation (platforms, modes, the asset kind its models come from);
  - a conformance suite.

**The shared vocabulary:**
- The Go side uses `apps/desktop/internal/port`: `Level`, `Support` and `NotSupportedError` from ADR 0300, plus a generic `Registry[P]`.
- The Python side mirrors the level names in `narration_common.ports`. A Python test reads a golden that the Go `internal/port` test writes, so the two cannot drift.
- Go registries live one package per port: `internal/asrport`, `internal/ttsport`, `internal/pronunciationport`, `internal/captureport` and `internal/encodeport`.

**Selection:**
- A call site asks the registry by name. It gets the implementation, or a `NotSupportedError` with a message for the narrator.
- No code outside an adapter or a registry compares a provider name. Guard tests in Go and Python enforce this.

**Conformance:**
- Every registered implementation must pass its port's suite: `asrporttest.Run`, `asr_conformance.run` and so on.
- Each registry's own test runs the suite over every row, so a new row cannot skip it.
- Engines that cannot run in CI (Moonshine's Windows-only library, model files) run the suite against a fake model. The packaged smoke test still checks the real library.

**No behaviour change:**
- Setting keys, values and choice lists stay as they are. New rows in `config/defaults.json` are appended only.
- Sidecar flags and error texts stay as they are, and the contract goldens do not change.
- Heavy imports stay lazy inside each adapter, so `narration_common` imports none of them.

**Left alone:**
- Measurement keeps its concrete functions and the func-field seams on `Host`.
- Importers keep their strategy table in `internal/importer/formats.go`.
- Asset downloads keep `assetProvider`; a descriptor names the asset kind it needs.

**Local only:** no port has a remote implementation, and no descriptor has a field for one. This holds [the roadmap's product boundary](../roadmap.md).

## Consequences

**Easier:**
- A new engine is an adapter file and a registry row. The suite checks it, and no call site changes.
- The two ASR engines are proven interchangeable by one suite, not by one caller's tests happening to cover both.
- A read-only `ProviderCapabilities` payload (a Should in the PRD) can explain a missing engine the way `DawCapabilities` explains a missing DAW action, with the same `Support` shape.

**Harder:**
- Each port adds a package and a suite to maintain.
- Every engine needs a fake good enough to run its suite.
- `live_asr.py`, `compare.py` and `manuscript_guide.py` gain one level of indirection.

**Given up:** a quick `if engine == ...` at a call site. The guard tests refuse it.

**Overriding this** needs a new ADR that supersedes this one. Adding a port, a role or a registry row does not; that is a normal change under this decision.
