"""The batch role of the Whisper engine (ADR 0301, provider-ports P6): wraps faster-whisper for Transcript Compare.

``FasterWhisperEngine`` is the body of ``compare.transcribe()`` behind the ``AsrEngine`` port. It declares ``batch`` only -
Transcript Compare never listens live - and refuses ``live``. ``compare.transcribe()`` stays a thin function with its
existing signature: it builds a ``BatchRequest`` (translating its own ``progress_path``/cancellation into the request's
``progress`` callback), looks the engine up, and unwraps the ``BatchResult``, so its three callers and ``coverage_mode.py``
see no change.
"""

from narration_common.logging_utils import log
from narration_common.ports.asr import BATCH, ENGINES, LIVE, AsrDescriptor, BatchRequest, BatchResult, BatchTranscriber


class _FasterWhisperTranscriber:
    """One loaded faster-whisper model, transcribing a whole recording."""

    def __init__(self, model):
        self._model = model

    def transcribe(self, audio, request: BatchRequest) -> BatchResult:
        if request.hotwords:
            log(f"Using vocabulary hints: {request.hotwords}")
        log("Transcribing audio (this can take a while for long tracks)...")
        segments, info = self._model.transcribe(
            audio,
            language=request.language,
            word_timestamps=True,
            vad_filter=True,
            hotwords=request.hotwords or None,
        )

        words = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    words.append((w.word.strip(), w.start, w.end))
            if request.progress:
                request.progress(seg.end, info.duration)

        log(f"Detected language: {info.language} (p={info.language_probability:.2f})")
        return BatchResult(words, language=info.language, language_probability=info.language_probability)

    def close(self) -> None:
        pass  # faster-whisper needs no explicit release; safe to call any number of times.


class FasterWhisperEngine:
    """Wraps faster-whisper's ``WhisperModel`` behind the ``AsrEngine`` port's batch role."""

    descriptor = AsrDescriptor(name="whisper", label="Whisper (faster-whisper)", modes=(BATCH,), asset_kind="whisper")

    def live(self, request):
        raise self.descriptor.refuse(LIVE)

    def batch(self, request: BatchRequest) -> BatchTranscriber:
        from faster_whisper import WhisperModel

        model_size, device, model_dir = request.model, request.device, request.model_dir
        # model_dir is a Narration Utils asset-cache directory whose contents were already hash-verified before this
        # process was started (see apps/desktop/internal/whisper). Passing it with local_files_only=True stops
        # faster-whisper/huggingface_hub from ever reaching the network here - without it, only a bare model_size
        # falls back to that legacy download path, kept for direct/manual CLI use outside the desktop host.
        if model_dir:
            log(f"Loading Whisper model '{model_size}' from the locally verified asset cache...")
        else:
            log(f"Loading Whisper model '{model_size}' on {device} (first run downloads it once)...")
        compute_type = "int8" if device == "cpu" else "float16"
        model = WhisperModel(model_dir or model_size, device=device, compute_type=compute_type, local_files_only=bool(model_dir))
        return _FasterWhisperTranscriber(model)


ENGINE = FasterWhisperEngine()
ENGINES.register(ENGINE)
