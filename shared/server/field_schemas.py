"""Settings field schemas, ported 1:1 from FieldSchemas in shared/hub/Hub.cs."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class FieldSchema:
    key: str
    label: str
    kind: str
    choices: tuple[str, ...] = ()


FIELD_SCHEMAS: dict[str, tuple[FieldSchema, ...]] = {
    "General": (
        FieldSchema("log_verbosity", "Log verbosity", "choice", ("quiet", "normal", "verbose")),
    ),
    "ManuscriptGuide": (
        FieldSchema("spacy_model", "spaCy model", "text"),
        FieldSchema("espeak_library", "eSpeak NG DLL", "text"),
        FieldSchema("piper_model", "Piper voice model", "text"),
    ),
    "TranscriptCompare": (
        FieldSchema("model_size", "Default Whisper model", "choice", ("tiny", "small", "medium", "large-v3-turbo", "large-v3")),
        FieldSchema("chunk_seconds", "Default chunk length", "choice", ("30", "60", "300", "600")),
        FieldSchema("color_misread", "Misread marker color", "color"),
        FieldSchema("color_skipped", "Skipped marker color", "color"),
        FieldSchema("color_extra", "Extra marker color", "color"),
    ),
}


def is_valid_hex(value: str) -> bool:
    return len(value) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in value)
