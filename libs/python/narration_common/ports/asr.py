"""The speech recognition port (ADR 0301, provider-ports P3): what every ASR engine is to its callers.

An engine has two roles, asked for separately (interface segregation). ``live`` turns a stream of audio chunks into
``Hypothesis`` readings for the teleprompter; ``batch`` turns a whole recording into timed words for Transcript Compare. Its
``AsrDescriptor`` declares which roles it has, and it refuses the others with ``descriptor.refuse(mode)``. Callers look an engine
up in ``ENGINES`` by the name the setting stores and never compare names themselves.

``Word`` and ``Hypothesis`` moved here from the teleprompter's ``live_asr.py``, which re-exports them. Nothing here imports an
engine or numpy: an audio chunk or recording is whatever the adapter takes (a float32 numpy array for every engine today).
"""

import re
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Protocol

from .registry import Descriptor, Level, NotSupportedError, Registry

LIVE = "live"
BATCH = "batch"
MODES = (LIVE, BATCH)

# What each role does, for the refusal sentence: "<label> cannot <this>."
_ROLE_SENTENCES = {LIVE: "transcribe live", BATCH: "transcribe a recording"}
_LANGUAGE = re.compile(r"^[a-z]{2,3}$")
_ASSET_KIND = re.compile(r"^[a-z0-9][a-z0-9_-]*$")

# (word, start_seconds, end_seconds)
Word = tuple[str, float, float]


@dataclass(frozen=True)
class Hypothesis:
    """An engine's current best reading of one speech segment, in absolute
    stream time. `final` marks the segment's last hypothesis (pause, size cap,
    or end of stream). Every engine produces these; nothing downstream knows
    which engine it was."""

    segment: int
    words: tuple[Word, ...]
    final: bool


@dataclass(frozen=True)
class AsrDescriptor(Descriptor):
    """A speech engine's row: its roles (``live``, ``batch``), the languages it speaks (none means every language Whisper
    does) and the asset kind its models are installed as (``whisper``, ``moonshine``; empty when it needs none)."""

    languages: tuple[str, ...] = field(default=())
    asset_kind: str = ""

    def __post_init__(self) -> None:
        super().__post_init__()
        object.__setattr__(self, "languages", tuple(self.languages))
        if not self.modes:
            raise ValueError(f"speech engine {self.name!r} must declare at least one of {', '.join(MODES)}")
        for mode in self.modes:
            if mode not in MODES:
                raise ValueError(f"speech engine {self.name!r}: {mode!r} is not one of {', '.join(MODES)}")
        for language in self.languages:
            if not _LANGUAGE.match(language):
                raise ValueError(f"speech engine {self.name!r}: {language!r} is not a lower-case ISO 639 language code")
            if self.languages.count(language) > 1:
                raise ValueError(f"speech engine {self.name!r}: language {language!r} is listed twice")
        if self.asset_kind and not _ASSET_KIND.match(self.asset_kind):
            raise ValueError(f"speech engine {self.name!r}: {self.asset_kind!r} is not an asset kind")

    def speaks(self, language: str | None) -> bool:
        """Whether it can transcribe ``language``; ``None`` (let the engine detect it) is always accepted."""
        return language is None or not self.languages or language in self.languages

    def refuse(self, mode: str) -> NotSupportedError:
        """The refusal an engine raises when asked for a role it does not declare."""
        return NotSupportedError(self.name, Level.Unsupported, f"{self.label} cannot {_ROLE_SENTENCES.get(mode, mode)}.")


def _frozen(options: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType(dict(options))


@dataclass(frozen=True)
class LiveRequest:
    """How to load an engine for live transcription. ``model`` is the size the setting stores (``small``) and ``model_dir``
    the verified asset folder the host passes (the engine may download only when it is absent). ``options`` carries what one
    engine alone takes (Whisper's decode interval, Moonshine's context text); the adapter checks its own keys."""

    model: str
    model_dir: str | None = None
    language: str | None = None
    hotwords: str | None = None
    device: str = "cpu"
    options: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ValueError("a speech engine request needs a model")
        object.__setattr__(self, "options", _frozen(self.options))


@dataclass(frozen=True)
class BatchRequest:
    """How to load an engine for a recording, and how to transcribe it. ``progress`` is called with (seconds transcribed,
    total seconds) as the engine goes; raising from it cancels the transcription, and the exception reaches the caller."""

    model: str
    model_dir: str | None = None
    language: str | None = None
    hotwords: str | None = None
    device: str = "cpu"
    progress: Callable[[float, float], None] | None = None
    options: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ValueError("a speech engine request needs a model")
        object.__setattr__(self, "options", _frozen(self.options))


@dataclass(frozen=True)
class BatchResult:
    """A recording's words in order, with the language the engine heard (``None`` when it does not say)."""

    words: tuple[Word, ...]
    language: str | None = None
    language_probability: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "words", tuple(self.words))


class LiveTranscriber(Protocol):
    """A loaded engine listening to one stream. ``hypotheses`` yields readings of the open segment as audio arrives, segment
    numbers never going back and none after that segment's final one. ``close`` releases the engine and is safe to repeat."""

    def hypotheses(self, chunks: Iterable[Any]) -> Iterator[Hypothesis]: ...

    def close(self) -> None: ...


class BatchTranscriber(Protocol):
    """A loaded engine for whole recordings. ``close`` releases the model and is safe to repeat."""

    def transcribe(self, audio: Any, request: BatchRequest) -> BatchResult: ...

    def close(self) -> None: ...


class AsrEngine(Protocol):
    """One speech engine. Each role loads its model when asked, and raises ``descriptor.refuse(mode)`` when not declared."""

    descriptor: AsrDescriptor

    def live(self, request: LiveRequest) -> LiveTranscriber: ...

    def batch(self, request: BatchRequest) -> BatchTranscriber: ...


# Filled by each sidecar's adapters when they are imported (provider-ports P5, P6); the first registered is the default.
ENGINES: Registry[AsrEngine] = Registry("speech engine")
