"""The pronunciation port (provider-ports P7): its descriptor, its two roles, the fallback order and its conformance suite."""

import ast
from pathlib import Path
from urllib.parse import quote

import pytest
from narration_common.ports import Descriptor, Level, NotSupportedError, Registry, conformance, pronunciation, pronunciation_conformance
from narration_common.ports.pronunciation import (
    BROWSE,
    PRONOUNCE,
    SOURCES,
    PronunciationDescriptor,
    SourceRegistry,
)

# --- the fakes ------------------------------------------------------------------------------------------------------------------

KNOWN = {"hello": "h ə l oʊ"}


class FakeLookup:
    def __init__(self, host: str = "dictionary.example.org"):
        self.host = host

    def url_for(self, name: str) -> str:
        if not name.strip():
            raise ValueError("Type a name to look up.")
        return f"https://{self.host}/search?q={quote(name, safe='')}"


class FakeSource:
    """A test-only source that implements the port by shape alone: no base class, as a real adapter will."""

    def __init__(self, descriptor: PronunciationDescriptor, entries=KNOWN, lookup: FakeLookup | None = None):
        self.descriptor = descriptor
        self.entries = dict(entries)
        self.lookup = lookup or FakeLookup()

    def pronounce(self, name: str) -> dict[str, str]:
        if not self.descriptor.supports(PRONOUNCE):
            raise self.descriptor.refuse(PRONOUNCE)
        ipa = self.entries.get(name.lower())
        if ipa is None:
            raise ValueError(f'The fake dictionary has no entry for "{name}".')
        return {"ipa": ipa, "source": self.descriptor.label, "confidence": "medium"}

    def browser(self) -> FakeLookup:
        if not self.descriptor.supports(BROWSE):
            raise self.descriptor.refuse(BROWSE)
        return self.lookup


DICTIONARY = PronunciationDescriptor("fake", "Fake dictionary", modes=(PRONOUNCE,))
WEB = PronunciationDescriptor("fake-web", "Fake web lookup", modes=(BROWSE,), browser_host="dictionary.example.org")
BOTH = PronunciationDescriptor("fake-both", "Fake both", modes=(PRONOUNCE, BROWSE), browser_host="dictionary.example.org")


def _run(source, **cases) -> None:
    pronunciation_conformance.run(source, known="hello", unknown="Zzyzxqq", **cases)


def _fails(source, complaint: str, **cases) -> None:
    with pytest.raises(conformance.ConformanceError, match=complaint):
        _run(source, **cases)


# --- the port itself ------------------------------------------------------------------------------------------------------------


def test_the_port_imports_no_engine_and_nothing_that_fetches():
    """A browser lookup only builds a URL for the host to open; nothing in the port may fetch it (Q5)."""
    sources = (Path(pronunciation.__file__).read_text(encoding="utf-8"), Path(pronunciation_conformance.__file__).read_text(encoding="utf-8"))
    modules = {
        (node.module or "") if isinstance(node, ast.ImportFrom) else alias.name
        for text in sources
        for node in ast.walk(ast.parse(text))
        if isinstance(node, ast.Import | ast.ImportFrom)
        for alias in node.names
    }

    banned = {"pronouncing", "phonemizer", "piper", "requests", "httpx", "socket", "http", "webbrowser"}
    assert not {m for m in modules if m.split(".")[0] in banned or m == "urllib.request"}


def test_the_sources_registry_speaks_of_pronunciation_sources_and_starts_empty():
    """The CMU and eSpeak adapters (P8) fill it at import; the port itself registers nothing."""
    assert isinstance(SOURCES, SourceRegistry) and isinstance(SOURCES, Registry)
    assert SOURCES.kind == "pronunciation source" and len(SOURCES) == 0


def test_the_fallback_order_is_every_source_that_pronounces_in_registration_order():
    """The build-time fallback (today CMU, then eSpeak, hard-coded) comes from the registry; a browser lookup is never in it."""
    sources = SourceRegistry("pronunciation source")
    sources.register(FakeSource(PronunciationDescriptor("cmu", "CMU dictionary", modes=(PRONOUNCE,))))
    sources.register(FakeSource(WEB))
    sources.register(FakeSource(PronunciationDescriptor("espeak", "eSpeak NG", modes=(PRONOUNCE,))))
    sources.register(FakeSource(PronunciationDescriptor("win", "Windows only", platforms=("windows",), modes=(PRONOUNCE,))))

    assert sources.fallback_order() == ["cmu", "espeak", "win"]
    assert sources.fallback_order("linux") == ["cmu", "espeak"]
    assert sources.names(mode=BROWSE) == ["fake-web"]


# --- the descriptor -------------------------------------------------------------------------------------------------------------


def test_pronunciation_descriptor_is_a_descriptor_with_a_browser_host():
    assert isinstance(WEB, Descriptor)
    assert WEB.browser_host == "dictionary.example.org" and DICTIONARY.browser_host == ""


@pytest.mark.parametrize(
    ("kwargs", "complaint"),
    [
        ({"modes": ()}, "at least one"),
        ({"modes": ("fetch",)}, "fetch"),
        ({"modes": (BROWSE,)}, "browser_host"),
        ({"modes": (PRONOUNCE,), "browser_host": "example.org"}, "does not declare browse"),
        ({"modes": (BROWSE,), "browser_host": "https://example.org"}, "host name"),
        ({"modes": (BROWSE,), "browser_host": "example.org/path"}, "host name"),
        ({"modes": (BROWSE,), "browser_host": "Example.org"}, "host name"),
    ],
)
def test_pronunciation_descriptor_refuses_a_malformed_row(kwargs, complaint):
    with pytest.raises(ValueError, match=complaint):
        PronunciationDescriptor("x", "X", **kwargs)


def test_refuse_names_the_source_and_the_role_in_a_sentence():
    refusal = WEB.refuse(PRONOUNCE)

    assert isinstance(refusal, NotSupportedError)
    assert (refusal.name, refusal.level) == ("fake-web", Level.Unsupported)
    assert str(refusal) == "Fake web lookup cannot give a pronunciation."
    assert str(DICTIONARY.refuse(BROWSE)) == "Fake dictionary cannot look a name up in the browser."


# --- the conformance suite: sources that pass -----------------------------------------------------------------------------------


def test_a_dictionary_source_passes_by_refusing_the_browser_role():
    _run(FakeSource(DICTIONARY))


def test_a_browser_only_source_passes_by_refusing_to_pronounce():
    """The Q5 role: a web lookup opens in the browser and gives no pronunciation of its own."""
    _run(FakeSource(WEB))


def test_a_source_with_both_roles_passes():
    _run(FakeSource(BOTH))


def test_the_suite_runs_over_a_registry_of_fakes_without_editing_a_call_site():
    sources = SourceRegistry("pronunciation source")
    for descriptor in (DICTIONARY, WEB, BOTH):
        sources.register(FakeSource(descriptor))

    conformance.run_over_registry(sources, _run)


# --- the conformance suite: sources that fail -----------------------------------------------------------------------------------


def test_a_plain_descriptor_is_not_enough():
    _fails(FakeSource(Descriptor("plain", "Plain", modes=(PRONOUNCE,))), "PronunciationDescriptor")  # type: ignore[arg-type]


def test_a_source_that_cannot_pronounce_its_known_name_fails():
    _fails(FakeSource(DICTIONARY, entries={}), '"fake" declares pronounce, but it raised ValueError')


def test_a_source_that_pronounces_without_declaring_it_fails():
    class Eager(FakeSource):
        def pronounce(self, name):
            return {"ipa": "x", "source": "Eager", "confidence": "low"}

    _fails(Eager(WEB), "does not declare pronounce, but it did not raise NotSupportedError")


@pytest.mark.parametrize(
    ("value", "complaint"),
    [
        (["h ə l oʊ"], "not a dict"),
        ({"ipa": "", "source": "Fake", "confidence": "medium"}, "blank ipa"),
        ({"ipa": "x", "source": " ", "confidence": "medium"}, "blank source"),
        ({"ipa": "x", "source": "Fake", "confidence": "certain"}, "confidence 'certain'"),
        ({"ipa": "x", "source": "Fake"}, "confidence None"),
        ({"ipa": 1, "source": "Fake", "confidence": "low"}, "blank ipa"),
    ],
)
def test_a_pronunciation_is_a_dict_with_ipa_a_source_label_and_a_confidence(value, complaint):
    class Odd(FakeSource):
        def pronounce(self, name):
            return value

    _fails(Odd(DICTIONARY), complaint)


def test_a_source_that_hands_out_the_same_dict_twice_fails():
    """The guide sidecar marks the result ``chosen`` in place, so a shared dict would mark every later answer too."""

    class Caching(FakeSource):
        def __init__(self, descriptor):
            super().__init__(descriptor)
            self.cached = {"ipa": "x", "source": "Caching", "confidence": "low"}

        def pronounce(self, name):
            if name == "hello":
                return self.cached
            return super().pronounce(name)

    _fails(Caching(DICTIONARY), "same dict")


def test_a_miss_must_raise_rather_than_return_an_empty_pronunciation():
    class Quiet(FakeSource):
        def pronounce(self, name):
            if name == "hello":
                return super().pronounce(name)
            return {"ipa": "", "source": "not generated", "confidence": "unknown"}

    _fails(Quiet(DICTIONARY), 'has no entry for "Zzyzxqq" but did not raise')


def test_a_miss_must_be_a_value_error_with_a_message():
    class Crashing(FakeSource):
        def pronounce(self, name):
            if name == "hello":
                return super().pronounce(name)
            raise KeyError(name)

    class Terse(FakeSource):
        def pronounce(self, name):
            if name == "hello":
                return super().pronounce(name)
            raise ValueError(" ")

    _fails(Crashing(DICTIONARY), "raised KeyError, not a ValueError")
    _fails(Terse(DICTIONARY), "no message")


def test_a_miss_is_not_a_refusal():
    """``NotSupportedError`` says the source cannot pronounce anything; a miss says it has no entry for this name."""

    class Refusing(FakeSource):
        def pronounce(self, name):
            if name == "hello":
                return super().pronounce(name)
            raise NotSupportedError(self.descriptor.name, Level.Unsupported, "No.")

    _fails(Refusing(DICTIONARY), "a miss, not a NotSupportedError")


@pytest.mark.parametrize(
    ("url", "complaint"),
    [
        ("http://dictionary.example.org/search?q=x", "not https"),
        ("https://elsewhere.example.org/search?q=x", "elsewhere.example.org, not the declared dictionary.example.org"),
        ("https://dictionary.example.org.evil.test/?q=x", "not the declared"),
        ("https://user@dictionary.example.org/?q=x", "credentials"),
        ("https://dictionary.example.org:8443/?q=x", "port"),
        ("/search?q=x", "not https"),
        ("https://dictionary.example.org/search?q=a b", "whitespace"),
    ],
)
def test_a_browser_url_is_https_on_the_declared_host(url, complaint):
    class Odd(FakeLookup):
        def url_for(self, name):
            return url

    _fails(FakeSource(WEB, lookup=Odd()), complaint)


def test_a_hostile_name_cannot_move_the_browser_url_to_another_host():
    """Names come from a manuscript. One built to escape the query must still land on the declared host."""

    class Naive(FakeLookup):
        def url_for(self, name):
            return f"https://{self.host}/search?q={name}"

    _fails(FakeSource(WEB, lookup=Naive()), "not the declared|whitespace")


def test_a_browser_url_that_is_not_a_string_fails():
    class Odd(FakeLookup):
        def url_for(self, name):
            return None

    _fails(FakeSource(WEB, lookup=Odd()), "not a string")


def test_a_browser_lookup_refuses_a_blank_name_with_a_value_error():
    class Eager(FakeLookup):
        def url_for(self, name):
            return f"https://{self.host}/search?q={quote(name, safe='')}"

    _fails(FakeSource(WEB, lookup=Eager()), "blank name")


def test_a_browser_url_must_differ_per_name():
    class Fixed(FakeLookup):
        def url_for(self, name):
            if not name.strip():
                raise ValueError("Type a name.")
            return f"https://{self.host}/"

    _fails(FakeSource(WEB, lookup=Fixed()), "same URL")


@pytest.mark.parametrize(("error", "complaint"), [(ValueError(" "), "no message"), (KeyError("blank"), "KeyError, not a ValueError")])
def test_a_browser_lookup_refuses_a_blank_name_with_a_sentence(error, complaint):
    class Odd(FakeLookup):
        def url_for(self, name):
            if not name.strip():
                raise error
            return super().url_for(name)

    _fails(FakeSource(WEB, lookup=Odd()), complaint)
