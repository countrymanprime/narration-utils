"""Seek control channel for the Manuscript Teleprompter (see script_tracker.py;
ADR: the control channel). The desktop host tells a running sidecar to move
the tracker to a chosen script word by appending one JSON object per line to
a plain sentinel file (`--control-file PATH`):

    {"cmd": "seek", "word": 42}

This is the same sentinel-file pattern `--stop-file` already uses (ADR 0022:
no loopback server, no port): the host appends, and this module tails the
file from a saved byte offset every time it is polled, which `live_asr.py`
does once per chunk of its existing capture loop (CHUNK_SECONDS apart), so a
seek takes effect within about one chunk without any extra I/O between polls.

Only whole trailing lines are consumed; a line still being written by the
host is left for the next poll. A line that is not valid JSON, or not an
object, is skipped - a malformed command must never stop the tracker
following what the narrator actually said.
"""

import json
from pathlib import Path


class ControlChannel:
    """Tails `path` for new command lines appended since the last poll."""

    def __init__(self, path: str | None) -> None:
        self._path = Path(path) if path else None
        self._offset = 0

    def poll(self) -> list[dict]:
        """Whole command lines that arrived since the last call, oldest first."""
        if self._path is None:
            return []
        try:
            data = self._path.read_bytes()
        except FileNotFoundError:
            return []
        chunk = data[self._offset :]
        if not chunk:
            return []
        newline = chunk.rfind(b"\n")
        if newline == -1:
            return []
        complete = chunk[: newline + 1]
        self._offset += len(complete)
        commands = []
        for line in complete.decode("utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                commands.append(parsed)
        return commands


def seek_word(command: dict) -> int | None:
    """The word index a `{"cmd": "seek", "word": N}` command carries, or None
    for anything else (an unknown `cmd`, a missing or non-integer `word`) -
    never raises, so one bad command cannot stop the poll loop."""
    if command.get("cmd") != "seek":
        return None
    word = command.get("word")
    return word if isinstance(word, int) and not isinstance(word, bool) else None
