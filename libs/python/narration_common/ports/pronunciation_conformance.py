"""The pronunciation port's conformance suite (ADR 0301, Liskov): what every ``PronunciationSource`` must do, checked the same way.

``run(source, known=..., unknown=...)`` asks the source for each role. A declared role must work; an undeclared one must refuse
with a ``NotSupportedError`` naming the source. A source that pronounces must give ``known`` a pronunciation with IPA, a source
label and a confidence, in a new dict each call, and must raise a ``ValueError`` (a miss, not a refusal) with a message for
``unknown``. A browser lookup must give https URLs on its declared host, different per name, that a hostile name cannot move to
another host, and must refuse a blank name. Real sources run it with their dictionary faked where CI lacks it;
``conformance.run_over_registry(SOURCES, ...)`` runs it over every row.
"""

from typing import Any
from urllib.parse import urlsplit

from . import conformance
from .conformance import ConformanceError
from .pronunciation import BROWSE, CONFIDENCES, PRONOUNCE, PronunciationDescriptor
from .registry import NotSupportedError

# Names a manuscript could hold that try to leave the lookup's query: a path, a fragment, a query, an authority, whitespace.
HOSTILE_NAMES = ("Zoë Ash", "a/../../b", "x#frag", "x?q=1&r=2", "@evil.test", "//evil.test/x", "x\ny", "%2F%2Fevil.test")


def check_pronunciation(value: Any, where: str) -> None:
    if not isinstance(value, dict):
        raise ConformanceError(f"{where} gave a {type(value).__name__}, not a dict")
    for key in ("ipa", "source"):
        text = value.get(key)
        if not (isinstance(text, str) and text.strip()):
            raise ConformanceError(f"{where} gave a blank {key}: {text!r}")
    confidence = value.get("confidence")
    if confidence not in CONFIDENCES:
        raise ConformanceError(f"{where} gave the confidence {confidence!r}, not one of {', '.join(CONFIDENCES)}")


def check_pronounce(source: Any, descriptor: PronunciationDescriptor, known: str, unknown: str) -> None:
    name = descriptor.name
    first = source.pronounce(known)
    check_pronunciation(first, f'"{name}" pronouncing "{known}"')
    second = source.pronounce(known)
    check_pronunciation(second, f'"{name}" pronouncing "{known}" again')
    if first is second:
        raise ConformanceError(f'"{name}" gave the same dict twice; the caller marks it chosen in place, so each call needs a new one')

    try:
        value = source.pronounce(unknown)
    except NotSupportedError as exc:
        raise ConformanceError(f'"{name}" has no entry for "{unknown}", which is a miss, not a NotSupportedError') from exc
    except ValueError as exc:
        if not str(exc).strip():
            raise ConformanceError(f'"{name}" has no entry for "{unknown}" and said so with no message for the narrator') from exc
    except Exception as exc:
        raise ConformanceError(f'"{name}" has no entry for "{unknown}" and raised {type(exc).__name__}, not a ValueError') from exc
    else:
        raise ConformanceError(f'"{name}" has no entry for "{unknown}" but did not raise; it gave {value!r}')


def check_url(url: Any, descriptor: PronunciationDescriptor, where: str) -> None:
    """``url`` is an absolute https URL on the declared host, with no credentials, port or whitespace."""
    if not isinstance(url, str):
        raise ConformanceError(f"{where} gave a {type(url).__name__}, not a string")
    if any(character.isspace() for character in url):
        raise ConformanceError(f"{where} gave a URL with whitespace in it: {url!r}")
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise ConformanceError(f"{where} gave {url!r}, which is not https")
    if parts.username is not None or parts.password is not None:
        raise ConformanceError(f"{where} gave {url!r}, which carries credentials")
    if parts.port is not None:
        raise ConformanceError(f"{where} gave {url!r}, which names a port")
    if parts.hostname != descriptor.browser_host:
        raise ConformanceError(f"{where} gave a URL on {parts.hostname}, not the declared {descriptor.browser_host}")


def check_browser(lookup: Any, descriptor: PronunciationDescriptor, known: str, unknown: str) -> None:
    name = descriptor.name
    urls = {}
    for asked in (known, unknown, *HOSTILE_NAMES):
        url = lookup.url_for(asked)
        check_url(url, descriptor, f'"{name}" looking up {asked!r}')
        urls[asked] = url
    if len(set(urls.values())) < len(urls):
        raise ConformanceError(f'"{name}" gave the same URL for different names, so the name is not in it')

    try:
        url = lookup.url_for("  ")
    except ValueError as exc:
        if not str(exc).strip():
            raise ConformanceError(f'"{name}" refused a blank name with no message for the narrator') from exc
    except Exception as exc:
        raise ConformanceError(f'"{name}" refused a blank name with {type(exc).__name__}, not a ValueError') from exc
    else:
        raise ConformanceError(f'"{name}" gave {url!r} for a blank name instead of raising a ValueError')


def run(source: Any, *, known: str, unknown: str) -> None:
    """Checks one source. ``known`` is a name it has an entry for and ``unknown`` one it has none for."""
    descriptor = conformance.check_descriptor(source)
    if not isinstance(descriptor, PronunciationDescriptor):
        raise ConformanceError(f'"{descriptor.name}" has a {type(descriptor).__name__}, not a PronunciationDescriptor')

    roles: dict[str, Any] = {}

    def ask(mode: str, call):
        role = call()
        roles[mode] = role
        return role

    conformance.check_roles(
        source,
        {
            PRONOUNCE: lambda port: ask(PRONOUNCE, lambda: port.pronounce(known)),
            BROWSE: lambda port: ask(BROWSE, port.browser),
        },
    )

    if PRONOUNCE in roles:
        check_pronounce(source, descriptor, known, unknown)
    if BROWSE in roles:
        check_browser(roles[BROWSE], descriptor, known, unknown)
