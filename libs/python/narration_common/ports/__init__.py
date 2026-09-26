"""The provider ports' kit (ADR 0301): the Python mirror of the host's ``internal/port``.

Each provider kind (speech recognition, text to speech, pronunciation, capture) gets a ``typing.Protocol`` beside this kit, a
``Registry`` of its implementations keyed by the name the setting stores, and a conformance suite built from ``conformance``.
Nothing here imports an engine: adapters keep their heavy imports lazy.
"""

from . import conformance, registry
from .registry import PLATFORMS, Described, Descriptor, Level, NotSupportedError, Registry, current_platform
from .vocabulary import levels_in_golden

__all__ = [
    "PLATFORMS",
    "Described",
    "Descriptor",
    "Level",
    "NotSupportedError",
    "Registry",
    "conformance",
    "current_platform",
    "levels_in_golden",
    "registry",
]
