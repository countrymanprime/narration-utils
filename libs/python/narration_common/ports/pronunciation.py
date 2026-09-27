"""The pronunciation port (ADR 0301, provider-ports P7): what every pronunciation source is to its callers.

A source has two roles, declared separately (interface segregation):

- ``pronounce``: ``pronounce(name)`` gives the name's pronunciation as the Story Bible stores it (``ipa``, ``source``,
  ``confidence``), a new dict each time since the caller marks it ``chosen`` in place. When the source has no entry for the name
  it raises a ``ValueError`` with a sentence for the narrator (a miss, not a ``NotSupportedError``).
- ``browse`` (Q5, the ``BrowserLookup`` role): ``browser()`` gives an object whose ``url_for(name)`` is an https page on the
  descriptor's ``browser_host`` for the host to open in the narrator's browser. The app never fetches it; the host can check a
  URL against the declared host before opening it. No source takes this role yet: the web lookup belongs to benchmark
  recommendation 6's PRD.

A source raises ``descriptor.refuse(mode)`` for a role it does not declare. Callers look a source up in ``SOURCES`` by the name the
narrator chose (``cmu``, ``espeak``) and never compare names; the build-time fallback tries ``SOURCES.fallback_order()``.

Nothing here imports an engine or anything that fetches: the CMU dictionary and eSpeak stay lazy imports inside their adapters (P8).
"""

import re
from dataclasses import dataclass
from typing import Protocol, TypedDict

from .registry import Descriptor, Level, NotSupportedError, Registry

PRONOUNCE = "pronounce"
BROWSE = "browse"
MODES = (PRONOUNCE, BROWSE)

# The confidence a pronunciation carries. "unknown" is only for the caller's own "not generated" placeholder, never a source's.
CONFIDENCES = ("high", "medium", "low")

# What each role does, for the refusal sentence: "<label> cannot <this>."
_ROLE_SENTENCES = {PRONOUNCE: "give a pronunciation", BROWSE: "look a name up in the browser"}
_HOST = re.compile(r"^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$")


class Pronunciation(TypedDict):
    """A name's pronunciation as the Story Bible stores it: the IPA, the source's label and how far to trust it."""

    ipa: str
    source: str
    confidence: str


@dataclass(frozen=True)
class PronunciationDescriptor(Descriptor):
    """A pronunciation source's row: its roles (``pronounce``, ``browse``) and, for a browser lookup, the one host its pages
    are on (a lower-case host name, no scheme, port or path)."""

    browser_host: str = ""

    def __post_init__(self) -> None:
        super().__post_init__()
        if not self.modes:
            raise ValueError(f"pronunciation source {self.name!r} must declare at least one of {', '.join(MODES)}")
        for mode in self.modes:
            if mode not in MODES:
                raise ValueError(f"pronunciation source {self.name!r}: {mode!r} is not one of {', '.join(MODES)}")
        if self.supports(BROWSE) and not self.browser_host:
            raise ValueError(f"pronunciation source {self.name!r} declares browse, so it needs the browser_host its pages are on")
        if self.browser_host and not self.supports(BROWSE):
            raise ValueError(f"pronunciation source {self.name!r} has a browser_host but does not declare browse")
        if self.browser_host and not _HOST.match(self.browser_host):
            raise ValueError(f"pronunciation source {self.name!r}: {self.browser_host!r} is not a lower-case host name")

    def refuse(self, mode: str) -> NotSupportedError:
        """The refusal a source raises when asked for a role it does not declare."""
        return NotSupportedError(self.name, Level.Unsupported, f"{self.label} cannot {_ROLE_SENTENCES.get(mode, mode)}.")


class BrowserLookup(Protocol):
    """A page about a name, for the narrator's browser. ``url_for`` returns an https URL on the source's ``browser_host`` with
    the name encoded into it, and raises a ``ValueError`` for a blank name. It never fetches the page."""

    def url_for(self, name: str) -> str: ...


class PronunciationSource(Protocol):
    """One pronunciation source. Each role raises ``descriptor.refuse(mode)`` when not declared."""

    descriptor: PronunciationDescriptor

    def pronounce(self, name: str) -> Pronunciation: ...

    def browser(self) -> BrowserLookup: ...


class SourceRegistry(Registry[PronunciationSource]):
    """The pronunciation sources, with the order the build-time fallback tries them in."""

    def fallback_order(self, platform: str | None = None) -> list[str]:
        """Every source that gives a pronunciation (and runs on ``platform``), in registration order; never a browser lookup."""
        return self.names(platform, PRONOUNCE)


# Filled by the guide sidecar's adapters when they are imported (provider-ports P8), CMU first: the first registered is the default.
SOURCES = SourceRegistry("pronunciation source")
