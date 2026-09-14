"""Append-only startup/runtime diagnostics, ported 1:1 from shared/hub/Diagnostics.cs."""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path


class SessionDiagnostics:
    def __init__(self, session_dir: str):
        self.session_dir = session_dir
        os.makedirs(session_dir, exist_ok=True)
        self.path = Path(session_dir) / "host.log"
        self.identifier = Path(session_dir).name
        self._lock = threading.Lock()

    def event(self, name: str, details: dict | None = None) -> None:
        record = {
            "time": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "event": name,
            "session": self.identifier,
        }
        if details:
            record.update(details)
        line = json.dumps(record, ensure_ascii=False)
        with self._lock:
            with open(self.path, "a", encoding="utf-8") as handle:
                handle.write(line + "\n")

    def exception(self, name: str, exc: Exception) -> None:
        self.event(name, {"error": str(exc), "traceback": repr(exc)})
