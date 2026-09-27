"""Adapters for the guide sidecar's providers (ADR 0301, provider-ports P8; wiktextract row added by prep-depth Phase 8, ADR
0405): Piper as the ``TtsEngine`` row, CMU, Wiktextract and eSpeak as the ``PronunciationSource`` rows. Each adapter wraps
exactly the code ``manuscript_guide.py`` called directly before this phase; importing this module (which
``manuscript_guide.py`` does at load time) registers all four, in the offline precedence order D72/Q7 recommends: CMU (D13's
existing default), then Wiktextract (broader dictionary coverage than CMU alone), then eSpeak (a letter-to-sound guess for
anything neither dictionary has).

Nothing here imports piper, pronouncing or phonemizer at module level: each adapter's import stays lazy inside the call that
needs it, so loading the sidecar for any other command does not pay their cost. ``WiktextractSource`` never imports anything
beyond the standard library: its data is a plain JSON file the Go asset manager derives at install time (Q8), never a
Python package.
"""

from __future__ import annotations

import json
import os
import re
import wave
from pathlib import Path
from typing import Any, NoReturn

from narration_common.ports.pronunciation import BROWSE, PRONOUNCE, SOURCES, PronunciationDescriptor
from narration_common.ports.tts import ENGINES, TtsDescriptor

# --- pronunciation: CMU and eSpeak -------------------------------------------------------------------------------------------

ARPABET_TO_IPA = {
    "AA": "ɑ",
    "AE": "æ",
    "AH": "ʌ",
    "AO": "ɔ",
    "AW": "aʊ",
    "AY": "aɪ",
    "B": "b",
    "CH": "tʃ",
    "D": "d",
    "DH": "ð",
    "EH": "ɛ",
    "ER": "ɝ",
    "EY": "eɪ",
    "F": "f",
    "G": "ɡ",
    "HH": "h",
    "IH": "ɪ",
    "IY": "i",
    "JH": "dʒ",
    "K": "k",
    "L": "l",
    "M": "m",
    "N": "n",
    "NG": "ŋ",
    "OW": "oʊ",
    "OY": "ɔɪ",
    "P": "p",
    "R": "r",
    "S": "s",
    "SH": "ʃ",
    "T": "t",
    "TH": "θ",
    "UH": "ʊ",
    "UW": "u",
    "V": "v",
    "W": "w",
    "Y": "j",
    "Z": "z",
    "ZH": "ʒ",
}


def arpabet_to_ipa(phones: str) -> str:
    output: list[str] = []
    for phone in phones.split():
        output.append(ARPABET_TO_IPA.get(re.sub(r"\d", "", phone), phone.lower()))
    return " ".join(output)


class CmuSource:
    """The CMU Pronouncing Dictionary: quick and high-quality for names it already knows, medium confidence (D13)."""

    descriptor = PronunciationDescriptor("cmu", "CMU dictionary", modes=(PRONOUNCE,))
    # What the build-time fallback logs when this source fails on a name, before it tries the next one.
    unavailable_log = "CMU pronunciation unavailable"

    def pronounce(self, name: str) -> dict[str, str]:
        import pronouncing

        words = re.findall(r"[A-Za-z]+", name)
        phones = [pronouncing.phones_for_word(word.lower())[0] for word in words if pronouncing.phones_for_word(word.lower())]
        if not (words and len(phones) == len(words)):
            raise ValueError(f'The CMU dictionary has no entry for "{name}".')
        return {"ipa": " ".join(arpabet_to_ipa(phone) for phone in phones), "source": "CMU dictionary", "confidence": "medium"}

    def browser(self) -> NoReturn:
        raise self.descriptor.refuse(BROWSE)


class WiktextractSource:
    """Wiktionary's IPA data, through the Wiktextract project's structured extracts (D72, ADR 0405): broader headword and
    variant coverage than the CMU dictionary, still a real dictionary hit rather than eSpeak's letter-to-sound guess, so it
    sits between the two in the offline precedence chain (Q7).

    Reads a small derived ``word -> {ipa, audio}`` index the Go asset manager builds at install time from the Wiktextract
    release and keeps in place of the raw multi-gigabyte dump (Q8, docs/research/wiktextract-pronunciation-source.md). The
    ``audio`` field (a Wikimedia Commons file name, or an empty string) is read here for prep-depth Phase 10 to use later;
    this phase's own ``pronounce`` never touches it.
    """

    descriptor = PronunciationDescriptor("wiktextract", "Wiktionary (via Wiktextract)", modes=(PRONOUNCE,))
    unavailable_log = "Wiktionary pronunciation unavailable"
    # Every displayed answer carries this per the CC BY-SA terms (Q9's attribution requirement); the full notice is in
    # THIRD-PARTY-NOTICES.txt.
    attribution_label = "Wiktionary (CC BY-SA)"

    def __init__(self) -> None:
        # Set once per process from the sidecar's --wiktextract-index flag; None until the asset is installed.
        self.index_path: str | None = None
        self._cache: dict[str, dict[str, str]] | None = None
        self._cache_path: str | None = None

    def _index(self) -> dict[str, dict[str, str]]:
        if not self.index_path:
            raise ValueError("Wiktionary pronunciations are not installed yet.")
        if self._cache is None or self._cache_path != self.index_path:
            with open(self.index_path, encoding="utf-8") as handle:
                document = json.load(handle)
            self._cache = document.get("words", {})
            self._cache_path = self.index_path
        return self._cache

    def pronounce(self, name: str) -> dict[str, str]:
        index = self._index()
        words = re.findall(r"[A-Za-z']+", name)
        entries = [index[word.lower()] for word in words if word.lower() in index]
        if not (words and len(entries) == len(words)):
            raise ValueError(f'Wiktionary has no entry for "{name}".')
        ipa = " ".join(entry["ipa"] for entry in entries)
        return {"ipa": ipa, "source": self.attribution_label, "confidence": "medium"}

    def browser(self) -> NoReturn:
        raise self.descriptor.refuse(BROWSE)


class EspeakSource:
    """eSpeak NG: a letter-to-sound guess (Q9), not a dictionary hit, for a name neither CMU nor Wiktextract has heard of.
    Low confidence, but it can attempt anything."""

    descriptor = PronunciationDescriptor("espeak", "eSpeak NG", modes=(PRONOUNCE,))
    unavailable_log = "eSpeak phonetic fallback unavailable"
    # D72's own words: "a clearly labelled letter-to-sound guess", so a narrator never mistakes this for a dictionary hit
    # (Q9). The descriptor's label stays "eSpeak NG" for the explicit source picker; only the generated answer's own label
    # changes.
    guess_label = "Letter-to-sound guess (eSpeak NG)"

    def __init__(self) -> None:
        # Set by pronounce_source() from the sidecar's --espeak-library flag before each call; None uses phonemizer's own.
        self.espeak_library: str | None = None

    def pronounce(self, name: str) -> dict[str, str]:
        from phonemizer import phonemize

        if self.espeak_library:
            from phonemizer.backend.espeak.wrapper import EspeakWrapper

            EspeakWrapper.set_library(self.espeak_library)
        ipa = phonemize(name, language="en-us", backend="espeak", strip=True, with_stress=True)
        if not ipa:
            raise ValueError(f'eSpeak produced no pronunciation for "{name}".')
        return {"ipa": ipa, "source": self.guess_label, "confidence": "low"}

    def browser(self) -> NoReturn:
        raise self.descriptor.refuse(BROWSE)


SOURCES.register(CmuSource())
SOURCES.register(WiktextractSource())
SOURCES.register(EspeakSource())


# --- text to speech: Piper ----------------------------------------------------------------------------------------------------


def synthesize_to_file(voice: Any, spoken: str, destination: Path) -> None:
    """Synthesizes ``spoken`` and moves the WAV to ``destination`` only once it is complete.

    The host trusts any file at ``destination`` as a cached preview, so a failed run must
    leave nothing there.  Piper initialises espeak lazily inside ``synthesize_wav``, before
    it sets the WAV format; closing a wave writer in that state raises "# channels not
    specified", which would replace the real error.  So the writer is closed by hand and the
    original failure is what gets reported.
    """
    temporary = destination.with_name(f"{destination.name}.{os.getpid()}.part")
    remove_stale_partials(destination, keep=temporary)
    wav_file = wave.open(str(temporary), "wb")  # noqa: SIM115 - a with block would close it mid-error and mask the failure
    try:
        try:
            voice.synthesize_wav(spoken, wav_file)
            frames = wav_file.getnframes()
        except Exception as exc:
            raise ValueError(f'"{spoken}" could not be spoken: {str(exc) or type(exc).__name__}') from exc
        if frames == 0:
            raise ValueError(f'"{spoken}" could not be spoken: the voice produced no audio for it.')
        try:
            wav_file.close()
            os.replace(temporary, destination)
        except OSError as exc:
            raise ValueError(f"The preview could not be saved ({exc}). Close anything that has the file open and try again.") from exc
    except BaseException:
        try:
            wav_file.close()
        except (wave.Error, OSError):
            pass
        temporary.unlink(missing_ok=True)
        raise


def remove_stale_partials(destination: Path, keep: Path) -> None:
    """Deletes ``<name>.<pid>.part`` files that earlier runs left for this output.

    A run the host stopped at its timeout is killed without running any cleanup, and the
    pid in the name means no later run would overwrite its file.  The host serializes
    renders of one output, so no live run owns these.
    """
    for entry in destination.parent.iterdir():
        if entry != keep and entry.name.startswith(destination.name + ".") and entry.name.endswith(".part"):
            entry.unlink(missing_ok=True)


class PiperVoiceAdapter:
    """The port's ``Voice``: wraps a raw Piper voice. ``voice`` stays public so ``load_voice`` can hand it, unwrapped, to
    the free ``synthesize_to_file`` every render already calls."""

    def __init__(self, voice: Any) -> None:
        self.voice = voice

    def synthesize_to_file(self, text: str, destination: Path) -> None:
        synthesize_to_file(self.voice, text, destination)


class PiperEngine:
    """Piper (D3): the one voice engine the narrator's Settings page has ever offered."""

    descriptor = TtsDescriptor("piper", "Piper", asset_kind="tts")

    def load(self, voice_path: str) -> PiperVoiceAdapter:
        from piper.voice import PiperVoice

        return PiperVoiceAdapter(PiperVoice.load(voice_path))


ENGINES.register(PiperEngine())


def load_voice(model_path: str) -> Any:
    """Loads a Piper voice through the TTS registry (ADR 0301): the raw object ``synthesize_to_file`` speaks through.
    Piper is imported lazily inside ``PiperEngine.load``: only ``render-audio`` and the self-check need it, and importing
    it costs about a quarter of a second, which every other command (each Save, lock, rescan) would pay."""
    return ENGINES.lookup("piper").load(model_path).voice
