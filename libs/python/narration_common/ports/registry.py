"""The shared vocabulary of the provider ports (ADR 0301): levels, the refusal, the descriptor and the registry.

``Level`` mirrors ``port.Level`` in Go (ADR 0300): the same names, the same order and the same wire strings, so the desktop host
and a sidecar say "not supported, and why" the same way. A Python test reads the golden the Go test writes, so the two cannot drift.

A registry maps the name a setting already stores (``whisper``, ``cmu``, ``dshow``) to the one object that implements the port.
A call site asks it by name and gets the implementation or a ``NotSupportedError``; it never compares names itself.
"""

import enum
import re
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Generic, Protocol, TypeVar

# The host's platform names are Go's GOOS values; the sidecars run on the same three.
PLATFORMS = ("windows", "darwin", "linux")
_SYS_PLATFORMS = {"win32": "windows", "cygwin": "windows", "darwin": "darwin", "linux": "linux"}
_NAME = re.compile(r"^[a-z0-9][a-z0-9_.-]*$")


class Level(enum.IntEnum):
    """How far an implementation supports something, least to most capable, as Go's ``port.Level`` (ADR 0300)."""

    Unsupported = 0  # it cannot do this at all
    NotYetAvailable = 1  # it could, but this app cannot drive it yet
    Experimental = 2  # built, not yet verified; off unless the narrator turns it on
    Supported = 3  # verified, and on unless the narrator turns it off

    @property
    def wire(self) -> str:
        """The string Go's ``Level.String`` gives and the UI's schemas carry."""
        return _WIRE[self]

    @property
    def usable(self) -> bool:
        """Whether an implementation at this level has a role to hand out (``level >= Experimental`` in Go)."""
        return self >= Level.Experimental

    @classmethod
    def from_wire(cls, text: str) -> "Level":
        for level, wire in _WIRE.items():
            if wire == text:
                return level
        raise ValueError(f"unknown level {text!r}; the levels are {', '.join(_WIRE.values())}")


_WIRE = {
    Level.Unsupported: "unsupported",
    Level.NotYetAvailable: "not_yet_available",
    Level.Experimental: "experimental",
    Level.Supported: "supported",
}


class NotSupportedError(ValueError):
    """A refusal: ``name`` cannot do what was asked, at ``level``, and ``message`` says why in a sentence for the narrator.

    It is a ``ValueError`` because the call sites it replaces raise ``ValueError`` for an unknown engine or source today, and their
    callers catch that.
    """

    def __init__(self, name: str, level: Level, message: str):
        if not message.strip():
            raise ValueError("a NotSupportedError needs a message for the narrator")
        super().__init__(message)
        self.name = name
        self.level = Level(level)
        self.message = message


def current_platform() -> str:
    """This process's platform as the host names it (a GOOS value)."""
    for prefix, goos in _SYS_PLATFORMS.items():
        if sys.platform.startswith(prefix):
            return goos
    raise NotSupportedError(sys.platform, Level.Unsupported, f"Narration Utils does not run on {sys.platform}.")


def _unique(values: tuple[str, ...], what: str) -> None:
    for value in values:
        if values.count(value) > 1:
            raise ValueError(f"{what} {value!r} is listed twice")


@dataclass(frozen=True)
class Descriptor:
    """What one implementation is and can do.

    ``name`` is the value the setting stores and the sidecar flag takes. ``platforms`` are GOOS values; none means every platform.
    ``modes`` are the roles it declares (``live``, ``batch``); a port without roles leaves it empty. A port that needs more (the
    languages, the asset kind its models come from) subclasses this as another frozen dataclass.
    """

    name: str
    label: str
    platforms: tuple[str, ...] = field(default=())
    modes: tuple[str, ...] = field(default=())

    def __post_init__(self) -> None:
        object.__setattr__(self, "platforms", tuple(self.platforms))
        object.__setattr__(self, "modes", tuple(self.modes))
        if not _NAME.match(self.name):
            raise ValueError(f"a descriptor name is the setting's value, lower case with no spaces, not {self.name!r}")
        if not self.label.strip():
            raise ValueError(f"descriptor {self.name!r} needs a label")
        for platform in self.platforms:
            if platform not in PLATFORMS:
                raise ValueError(f"descriptor {self.name!r}: {platform!r} is not one of {', '.join(PLATFORMS)}")
        if any(not mode.strip() for mode in self.modes):
            raise ValueError(f"descriptor {self.name!r} has an empty mode")
        _unique(self.platforms, "platform")
        _unique(self.modes, "mode")

    def runs_on(self, platform: str) -> bool:
        return not self.platforms or platform in self.platforms

    def supports(self, mode: str) -> bool:
        return mode in self.modes


class Described(Protocol):
    """Anything a registry holds: every port's Protocol has a descriptor."""

    descriptor: Descriptor


P = TypeVar("P", bound=Described)


class Registry(Generic[P]):
    """The implementations of one port, by name, in registration order: the first registered is the default.

    ``kind`` names what the rows are, for the refusal sentences ("speech engine", "pronunciation source").
    """

    def __init__(self, kind: str):
        if not kind.strip():
            raise ValueError("a registry needs a kind, such as 'speech engine', for its messages")
        self.kind = kind
        self._rows: dict[str, P] = {}

    def register(self, port: P) -> P:
        """Adds ``port`` under its descriptor's name and returns it. A name registered twice is a bug, so it raises."""
        descriptor = getattr(port, "descriptor", None)
        if not isinstance(descriptor, Descriptor):
            raise TypeError(f"a {self.kind} needs a Descriptor as its descriptor, not {descriptor!r}")
        if descriptor.name in self._rows:
            raise ValueError(f'a {self.kind} called "{descriptor.name}" is already registered')
        self._rows[descriptor.name] = port
        return port

    def lookup(self, name: str, platform: str | None = None) -> P:
        """The implementation called ``name``, or a ``NotSupportedError``; with ``platform``, only one declared for it."""
        port = self._rows.get(name)
        if port is None:
            raise NotSupportedError(name, Level.Unsupported, f'There is no {self.kind} called "{name}".')
        if platform is not None and not port.descriptor.runs_on(platform):
            raise NotSupportedError(name, Level.Unsupported, f"{port.descriptor.label} is not available on {platform}.")
        return port

    def names(self, platform: str | None = None, mode: str | None = None) -> list[str]:
        """The names declared for ``platform`` (and ``mode``), default first; all of them when neither is given."""
        return [
            name
            for name, port in self._rows.items()
            if (platform is None or port.descriptor.runs_on(platform)) and (mode is None or port.descriptor.supports(mode))
        ]

    def default(self, platform: str | None = None, mode: str | None = None) -> str | None:
        """The first name ``names`` gives, or None when nothing is declared for the platform."""
        names = self.names(platform, mode)
        return names[0] if names else None

    def descriptors(self) -> list[Descriptor]:
        return [port.descriptor for port in self._rows.values()]

    def __contains__(self, name: object) -> bool:
        return name in self._rows

    def __iter__(self) -> Iterator[P]:
        return iter(list(self._rows.values()))

    def __len__(self) -> int:
        return len(self._rows)
