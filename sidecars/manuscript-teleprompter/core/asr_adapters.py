"""Live ASR engine adapters for the Manuscript Teleprompter (provider-ports P5, ADR 0301): what `live_asr.py`'s
`--engine whisper`/`--engine moonshine` become underneath. `WhisperEngine` wraps `live_asr`'s own
`_load_whisper_decoder` and `whisper_hypotheses`; `MoonshineEngine` wraps `moonshine_engine.load_transcriber` and
`live_asr`'s `moonshine_hypotheses`. Each also carries its own argument rules (`check`), checked before either engine
loads a model, so a bad `--model` or `--language` is refused exactly as it always was.

Only live is declared here: batch (Transcript Compare's faster-whisper adapter, provider-ports P6) registers its own
"whisper" row in that sidecar's own process, so there is no name clash - each sidecar's `ENGINES` is a separate
process-local registry.

`live_asr.py` imports this module (after putting this directory on `sys.path`, so this module can be loaded on its
own too) to register both rows in `ENGINES`. The engines call back into `live_asr` for the actual decode/transcribe
logic with a late import, since `live_asr` imports this module at its own top level.
"""

import sys
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

_CORE_DIR = Path(__file__).resolve().parent
if str(_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(_CORE_DIR))

_SHARED_PYTHON = Path(__file__).resolve().parents[3] / "libs" / "python"
if str(_SHARED_PYTHON) not in sys.path:
    sys.path.insert(0, str(_SHARED_PYTHON))

from narration_common.ports.asr import BATCH, ENGINES, LIVE, AsrDescriptor, BatchRequest, BatchTranscriber, LiveRequest, LiveTranscriber

# Moonshine streaming model sizes selectable with --engine moonshine (English only for now).
MOONSHINE_ARCHS = {"tiny": "TINY_STREAMING", "small": "SMALL_STREAMING", "medium": "MEDIUM_STREAMING"}


class _HypothesesTranscriber:
    """Adapts a `chunks -> Iterator[Hypothesis]` callable, and an optional real resource to release, into the port's
    `LiveTranscriber`. `close()` is made safe to call twice even when the wrapped resource's own close is not."""

    def __init__(self, hypotheses: Callable[[Iterable[Any]], Iterator[Any]], close: Callable[[], None] = lambda: None):
        self._hypotheses = hypotheses
        self._close = close
        self._closed = False

    def hypotheses(self, chunks: Iterable[Any]) -> Iterator[Any]:
        return self._hypotheses(chunks)

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._close()


class WhisperEngine:
    """faster-whisper, live only in this sidecar (batch is Transcript Compare's own adapter)."""

    descriptor = AsrDescriptor(name="whisper", label="Whisper", modes=(LIVE,), asset_kind="whisper")

    def check(self, ap: Any, args: Any) -> None:
        if args.context:
            ap.error("--context is only supported with --engine moonshine")

    def live(self, request: LiveRequest) -> LiveTranscriber:
        import live_asr
        from live_asr import _load_whisper_decoder, whisper_hypotheses

        decoder_args = SimpleNamespace(
            model=request.model,
            model_dir=request.model_dir,
            language=request.language,
            hotwords=request.hotwords,
            device=request.device,
            timing=bool(request.options.get("timing", False)),
        )
        decode = _load_whisper_decoder(decoder_args)
        decode_interval = request.options.get("decode_interval", live_asr.DECODE_INTERVAL_SECONDS)

        def hypotheses(chunks: Iterable[Any]) -> Iterator[Any]:
            return whisper_hypotheses(chunks, decode, decode_interval_seconds=decode_interval)

        return _HypothesesTranscriber(hypotheses)

    def batch(self, request: BatchRequest) -> BatchTranscriber:
        raise self.descriptor.refuse(BATCH)


class MoonshineEngine:
    """Moonshine, Windows only (ADR 0107), English only, streaming model sizes only."""

    descriptor = AsrDescriptor(name="moonshine", label="Moonshine", platforms=("windows",), modes=(LIVE,), languages=("en",), asset_kind="moonshine")

    def check(self, ap: Any, args: Any) -> None:
        if args.model not in MOONSHINE_ARCHS:
            ap.error(f"--engine moonshine supports --model {'/'.join(MOONSHINE_ARCHS)}, not {args.model!r}")
        if args.language not in (None, "en"):
            ap.error("--engine moonshine is English only for now")

    def live(self, request: LiveRequest) -> LiveTranscriber:
        import live_asr
        from moonshine_engine import load_transcriber

        arch = MOONSHINE_ARCHS[request.model]
        decode_interval = request.options.get("decode_interval", live_asr.DECODE_INTERVAL_SECONDS)
        context_text = request.options.get("context_text")
        transcriber = load_transcriber(arch, request.model_dir, decode_interval, request.hotwords, context_text)

        def hypotheses(chunks: Iterable[Any]) -> Iterator[Any]:
            return live_asr.moonshine_hypotheses(chunks, transcriber)

        return _HypothesesTranscriber(hypotheses, close=transcriber.close)

    def batch(self, request: BatchRequest) -> BatchTranscriber:
        raise self.descriptor.refuse(BATCH)


ENGINES.register(WhisperEngine())
ENGINES.register(MoonshineEngine())
