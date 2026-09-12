"""Small, versioned file bridge between the Tk hub and a DAW adapter.

The format intentionally uses one percent-encoded line per command instead
of JSON.  Python can write it without dependencies and REAPER's Lua adapter
can parse it without bundling a JSON library.  Commands are immutable files;
the adapter removes each file only after it has handled it.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import count
from pathlib import Path
from urllib.parse import quote, unquote

PROTOCOL_VERSION = 1


def encode_fields(*fields: object) -> str:
    """Encode fields safely for the ``|``-delimited on-disk protocol."""
    return "|".join(quote(str(field), safe="") for field in fields)


def decode_fields(line: str) -> list[str]:
    return [unquote(field) for field in line.rstrip("\r\n").split("|")]


@dataclass(frozen=True)
class BridgeCommand:
    action: str
    fields: tuple[str, ...] = ()

    def serialize(self) -> str:
        return encode_fields(PROTOCOL_VERSION, self.action, *self.fields) + "\n"

    @classmethod
    def parse(cls, line: str) -> "BridgeCommand":
        fields = decode_fields(line)
        if len(fields) < 2 or fields[0] != str(PROTOCOL_VERSION):
            raise ValueError("Unsupported Narration Utils bridge command")
        return cls(action=fields[1], fields=tuple(fields[2:]))


class BridgeClient:
    """Writes ordered command files and tails optional adapter status text."""

    def __init__(self, session_dir: str | Path):
        self.session_dir = Path(session_dir)
        self.commands_dir = self.session_dir / "commands"
        self.commands_dir.mkdir(parents=True, exist_ok=True)
        self._counter = count()
        self._event_offset = 0

    def send(self, action: str, *fields: object) -> Path:
        sequence = next(self._counter)
        target = self.commands_dir / f"{sequence:08d}.cmd"
        temporary = target.with_suffix(".tmp")
        temporary.write_text(BridgeCommand(action, tuple(map(str, fields))).serialize(), encoding="utf-8")
        temporary.replace(target)
        return target

    def read_events(self) -> list[str]:
        events_path = self.session_dir / "events.log"
        try:
            with events_path.open("r", encoding="utf-8") as handle:
                handle.seek(self._event_offset)
                text = handle.read()
                self._event_offset = handle.tell()
        except OSError:
            return []
        return [line for line in text.splitlines() if line]
