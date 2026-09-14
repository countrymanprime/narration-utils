"""Mutable state for one Transcript Compare pass, ported from TranscriptRun in shared/hub/Hub.cs."""

import time
from dataclasses import dataclass, field


@dataclass
class TranscriptRun:
    phase: str = "idle"
    run_id: str = ""
    percent: float = 0
    message: str = "Select a track in REAPER, then start a comparison."
    logs: list[str] = field(default_factory=list)
    chapters: list[str] = field(default_factory=list)
    rows: list[dict] = field(default_factory=list)
    diff: str = ""
    summary: str = ""
    marker_export_phase: str = "idle"
    marker_export_message: str = ""
    marker_export_added: int = 0
    marker_export_skipped: int = 0
    started: float = 0
    manifest: str | None = None
    output: str | None = None
    progress: str | None = None
    log_path: str | None = None
    diff_path: str | None = None
    backend_process: object | None = None
    log_offset: int = 0
    pending_options: dict[str, str] = field(default_factory=dict)

    @staticmethod
    def monotonic_seconds() -> float:
        return time.monotonic()

    def snapshot(self) -> dict:
        return {
            "runId": self.run_id or None,
            "phase": self.phase,
            "percent": self.percent,
            "message": self.message,
            "logs": self.logs[-500:],
            "chapters": self.chapters,
            "rows": self.rows,
            "diff": self.diff,
            "summary": self.summary,
            "markerExport": {
                "phase": self.marker_export_phase,
                "message": self.marker_export_message,
                "added": self.marker_export_added,
                "skipped": self.marker_export_skipped,
            },
            "elapsed": max(0, self.monotonic_seconds() - self.started) if self.started > 0 else 0,
        }
