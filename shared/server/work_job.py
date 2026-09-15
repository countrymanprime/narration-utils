"""Small in-memory state holder for observable background work."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class WorkJob:
    kind: str
    phase: str
    message: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    percent: int = 0
    logs: list[str] = field(default_factory=list)
    started: float = field(default_factory=time.monotonic)
    preview: dict[str, Any] | None = None
    requires_reset: bool = False
    result: dict[str, Any] | None = None
    error: str = ""
    source: str = ""
    source_fingerprint: tuple[int, int] | None = None
    draft: dict[str, Any] | None = None
    process: Any = None
    progress_path: str = ""
    log_path: str = ""
    log_offset: int = 0
    guide_path: str = ""

    def add_log(self, text: str) -> None:
        for line in text.splitlines():
            if line:
                self.logs.append(line)
        if len(self.logs) > 200:
            self.logs = self.logs[-200:]

    def snapshot(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "phase": self.phase,
            "message": self.message,
            "percent": self.percent,
            "logs": self.logs[-200:],
            "elapsed": max(0, time.monotonic() - self.started),
            "preview": self.preview,
            "requiresReset": self.requires_reset,
            "result": self.result,
            "error": self.error,
        }
