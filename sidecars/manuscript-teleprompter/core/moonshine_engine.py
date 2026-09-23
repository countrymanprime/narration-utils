"""
Loads the Moonshine streaming engine for live_asr.py (the Manuscript Teleprompter's second live engine, ADR 0021; see
docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 6). live_asr.py turns the loaded Transcriber's line events into
the same partial/word/segment_end events the Whisper engine produces; this module only decides WHICH model files are loaded.

Two ways in:
- The desktop host (and so the frozen, shipped sidecar) passes --model-dir: a directory the host installed from the hashed
  catalog config/moonshine-assets.json and verified by SHA-256 (apps/desktop/internal/moonshine). It is loaded as it is, after a
  presence check that it holds every file the catalog pins - above all the attention decoder word timestamps need, without
  which Moonshine silently loads and returns lines with no word timings. The frozen sidecar refuses to run without it.
- A developer running live_asr.py from source may omit --model-dir; then moonshine-voice's own downloader fetches the model
  into its own cache. That path is never reached by the shipped program.

moonshine-voice (MIT, https://github.com/moonshine-ai/moonshine) is a Windows-only dependency in pyproject.toml, imported
only here and only when --engine moonshine runs, so the Whisper path never loads it.
"""

import sys
from pathlib import Path

from narration_common.logging_utils import log

# One English streaming model with word timestamps, as config/moonshine-assets.json installs it (the same nine files for tiny
# and small; tests/test_moonshine_engine.py holds this list, the catalog and the pinned library's own manifest to each other).
WORD_TIMESTAMP_FILE = "decoder_kv_with_attention.ort"
MODEL_FILES = (
    "adapter.ort",
    "cross_kv.ort",
    "decoder_kv.ort",
    "encoder.ort",
    "frontend.model.ort",
    "frontend.weights.ort",
    "streaming_config.json",
    "tokenizer.bin",
    WORD_TIMESTAMP_FILE,
)


def missing_model_files(model_dir: str | Path) -> list[str]:
    """The catalog files `model_dir` does not hold, in catalog order (every one of them if the directory does not exist)."""
    directory = Path(model_dir)
    return [name for name in MODEL_FILES if not (directory / name).is_file()]


def self_check() -> dict:
    """Whether this build carries a working Moonshine, as one `engine_check` event (printed by live_asr.py --check-moonshine for
    the packaged app's smoke test, apps/desktop/smoke.go). moonshine_voice loads its native moonshine.dll (and the onnxruntime.dll
    beside it) with ctypes, which PyInstaller cannot see, so a freeze that lost them still starts; asking the native library for
    its language catalog proves it loads and answers, with no model and no network. Transcriber is imported too, since the
    package imports it lazily."""

    def report(ok: bool, detail: str) -> dict:
        return {"type": "engine_check", "engine": "moonshine", "ok": ok, "detail": detail}

    try:
        import moonshine_voice

        moonshine_voice.Transcriber  # noqa: B018 - the package imports its transcriber module on first access
        languages = moonshine_voice.supported_languages()
    except ImportError as error:
        return report(False, f"the moonshine-voice package is not in this build ({error})")
    except Exception as error:  # noqa: BLE001 - whatever stops the native library loading is the finding, reported as is
        return report(False, f"{type(error).__name__}: {error}")
    if "en" not in languages:
        return report(False, f"the native library offers no English model (languages: {', '.join(languages) or 'none'})")
    return report(True, f"moonshine-voice {moonshine_voice.__version__}: native library loaded, {len(languages)} language(s)")


def _is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def _resolve_model_dir(arch_name: str, model_dir: str | None, frozen: bool) -> str | None:
    """The directory to load, or None to let the library download (developer CLI only). Exits with the reason otherwise."""
    if model_dir is None:
        if frozen:
            raise SystemExit(
                "--engine moonshine needs --model-dir: this program only loads a Moonshine model installed and verified from the "
                "app's asset catalog (Settings > Local assets), never one downloaded by the library itself."
            )
        return None
    missing = missing_model_files(model_dir)
    if missing:
        raise SystemExit(
            f"The Moonshine model directory {model_dir} is incomplete (missing: {', '.join(missing)}); "
            "remove the model and install it again from Settings > Local assets."
        )
    log(f"Loading Moonshine {arch_name} from {model_dir}...")
    return model_dir


def load_transcriber(
    arch_name: str,
    model_dir: str | None,
    update_interval: float,
    keyterms: str | None,
    context: str | None,
    *,
    frozen: bool | None = None,
):
    """A Moonshine streaming Transcriber for `arch_name` (a moonshine_voice.ModelArch member name, e.g. "SMALL_STREAMING"),
    with word timestamps on, biased toward `keyterms` (comma-separated) and `context` (e.g. the chapter text)."""
    model_path = _resolve_model_dir(arch_name, model_dir, _is_frozen() if frozen is None else frozen)
    try:
        from moonshine_voice import ModelArch, Transcriber
    except ImportError as error:
        raise SystemExit(
            "--engine moonshine needs the moonshine-voice package, a Windows-only dependency in pyproject.toml "
            "(`uv sync` installs it on Windows; no other platform ships Moonshine yet)."
        ) from error

    arch = getattr(ModelArch, arch_name)
    if model_path is None:
        from moonshine_voice.download import get_model_for_language

        log(f"Loading Moonshine {arch_name} (developer CLI: moonshine-voice downloads it from Moonshine's servers on first run)...")
        model_path, arch = get_model_for_language("en", arch, include_word_timestamps=True)
    transcriber = Transcriber(model_path, arch, update_interval=update_interval, options={"word_timestamps": "true"})
    terms = [term.strip() for term in keyterms.split(",") if term.strip()] if keyterms else []
    if terms:
        transcriber.set_keyterms(terms)
    if context:
        transcriber.set_context(context)
    return transcriber
