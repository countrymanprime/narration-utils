"""The voice engine port's conformance suite (ADR 0301, Liskov): what every ``TtsEngine`` must do, checked the same way for each.

``run(engine, voice_path=..., workdir=...)`` loads the voice and speaks a line: the WAV must be at the destination, readable and
not empty. It then speaks blank text, which no voice can: that must raise a ``ValueError`` with a message and leave the workdir as
it was, so no half-written file is ever taken for a finished preview. Unless told not to, it also checks that loading a voice from
a path with none raises. Real engines run it with a fake model, so CI needs no voice files;
``conformance.run_over_registry(ENGINES, ...)`` runs it over every row.
"""

import contextlib
import wave
from pathlib import Path
from typing import Any

from . import conformance
from .conformance import ConformanceError
from .tts import TtsDescriptor

DEFAULT_TEXT = "hello"
BLANK_TEXT = "   "


def _listing(workdir: Path) -> set[str]:
    return {entry.name for entry in workdir.iterdir()}


def check_wav(path: Path, where: str) -> None:
    """``path`` is a readable WAV holding some audio."""
    if not path.is_file():
        raise ConformanceError(f"{where} left no file at the destination")
    try:
        with wave.open(str(path), "rb") as wav_file:
            frames = wav_file.getnframes()
    except (wave.Error, EOFError) as exc:
        raise ConformanceError(f"{where} wrote a file that is not a WAV ({exc})") from exc
    if frames == 0:
        raise ConformanceError(f"{where} wrote a WAV with no audio in it")


def check_failure_leaves_nothing(voice: Any, workdir: Path, name: str) -> None:
    """Speaking blank text raises a ``ValueError`` with a message, and leaves nothing at the destination or beside it."""
    destination = workdir / "blank.wav"
    before = _listing(workdir)
    try:
        voice.synthesize_to_file(BLANK_TEXT, destination)
    except ValueError as exc:
        if not str(exc).strip():
            raise ConformanceError(f'"{name}" refused blank text with no message for the narrator') from exc
    except Exception as exc:
        raise ConformanceError(f'"{name}" refused blank text, but raised {type(exc).__name__}, not a ValueError') from exc
    else:
        destination.unlink(missing_ok=True)
        raise ConformanceError(f'"{name}" spoke blank text instead of raising a ValueError')
    if destination.exists():
        destination.unlink()
        raise ConformanceError(f'"{name}" failed, but left a file at the destination, which the host would take for a preview')
    left = sorted(_listing(workdir) - before)
    if left:
        for entry in left:
            (workdir / entry).unlink(missing_ok=True)
        raise ConformanceError(f'"{name}" failed, but left {", ".join(left)} beside the destination')


def run(engine: Any, *, voice_path: str, workdir: Path, text: str = DEFAULT_TEXT, check_missing_voice: bool = True) -> None:
    """Checks one engine. ``voice_path`` is a voice it can load (a fake's placeholder for a fake), ``workdir`` an empty folder
    the suite writes into and leaves empty. ``check_missing_voice=False`` is for an adapter tested with its loader faked."""
    workdir = Path(workdir)
    if _listing(workdir):
        raise ValueError(f"the conformance workdir {workdir} must be empty")
    descriptor = conformance.check_descriptor(engine)
    if not isinstance(descriptor, TtsDescriptor):
        raise ConformanceError(f'"{descriptor.name}" has a {type(descriptor).__name__}, not a TtsDescriptor')
    name = descriptor.name

    try:
        voice = engine.load(voice_path)
    except Exception as exc:
        raise ConformanceError(f'"{name}" could not load a voice: {type(exc).__name__}: {exc}') from exc
    if voice is None:
        raise ConformanceError(f'"{name}" load() returned None')

    if check_missing_voice:
        loaded = False
        # Any refusal will do: the caller wraps it in its own sentence.
        with contextlib.suppress(Exception):
            engine.load(str(workdir / "no-such-voice.onnx"))
            loaded = True
        if loaded:
            raise ConformanceError(f'"{name}" loaded a voice from a path with no voice, instead of raising')

    destination = workdir / "spoken.wav"
    try:
        try:
            voice.synthesize_to_file(text, destination)
        except Exception as exc:
            raise ConformanceError(f'"{name}" could not speak "{text}": {type(exc).__name__}: {exc}') from exc
        check_wav(destination, f'"{name}" speaking "{text}"')
    finally:
        destination.unlink(missing_ok=True)

    check_failure_leaves_nothing(voice, workdir, name)
