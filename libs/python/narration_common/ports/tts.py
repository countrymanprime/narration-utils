"""The text to speech port (ADR 0301, provider-ports P7): what every voice engine is to its callers.

An engine loads a voice from the model file the host verified (``load``); a voice speaks one line into a WAV file
(``synthesize_to_file``). The guide sidecar's preview is the one caller today. It keeps one rule every voice must keep: the host
trusts any file at the destination as a finished preview, so a failed run raises a ``ValueError`` with a sentence for the narrator
and leaves nothing at the destination or beside it. Callers look an engine up in ``ENGINES`` by the name ``Piper.tts_provider``
stores and never compare names themselves.

Nothing here imports an engine: Piper stays a lazy import inside its adapter (P8).
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .registry import Descriptor, Registry

_ASSET_KIND = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


@dataclass(frozen=True)
class TtsDescriptor(Descriptor):
    """A voice engine's row: the asset kind its voices are installed as (``tts``; empty when it needs none). A voice engine
    has one job and so no modes."""

    asset_kind: str = ""

    def __post_init__(self) -> None:
        super().__post_init__()
        if self.modes:
            raise ValueError(f"voice engine {self.name!r} has no modes to declare, not {', '.join(self.modes)}")
        if self.asset_kind and not _ASSET_KIND.match(self.asset_kind):
            raise ValueError(f"voice engine {self.name!r}: {self.asset_kind!r} is not an asset kind")


class Voice(Protocol):
    """One loaded voice.

    ``synthesize_to_file`` speaks ``text`` into a WAV at ``destination``, which appears only once it is complete. When the text
    cannot be spoken (blank, or the voice produced no audio) or the file cannot be saved, it raises a ``ValueError`` whose message
    is a sentence for the narrator, and leaves nothing at ``destination`` and no partial file beside it.
    """

    def synthesize_to_file(self, text: str, destination: Path) -> None: ...


class TtsEngine(Protocol):
    """One voice engine. ``load`` reads the voice at ``voice_path`` and raises when there is none, or it cannot be read."""

    descriptor: TtsDescriptor

    def load(self, voice_path: str) -> Voice: ...


# Filled by the guide sidecar's adapter when it is imported (provider-ports P8); the first registered is the default.
ENGINES: Registry[TtsEngine] = Registry("voice engine")
