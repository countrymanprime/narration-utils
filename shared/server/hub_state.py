"""Coordinates transcript runs, settings, Story Bible, Manuscript, and the
REAPER bridge - ported 1:1 from shared/hub/Hub.cs.

Transcript-compare/Story Bible/Manuscript business logic is unchanged from
the .NET build; only the host language changed. See docs/architecture/
daw-integration.md for the REAPER-Lua boundary these all still respect.
"""

import json
import os
import shutil
import threading
import time
from pathlib import Path

from narration_common import config as cfg
from narration_common.ui_bridge import BridgeClient, decode_fields

from .diagnostics import SessionDiagnostics
from .field_schemas import FIELD_SCHEMAS, is_valid_hex
from .guide_service import GuideError, GuideService, preview_url
from .manuscript_service import ManuscriptError, ManuscriptService
from . import process_utils
from .transcript_run import TranscriptRun

API_VERSION = 1


class HubError(Exception):
    """Raised for the same user-facing validation/state errors Hub.cs throws
    InvalidOperationException/ArgumentException for; routers turn this into
    a 400 response."""


class HubState:
    def __init__(
        self,
        session_dir: str,
        project_folder: str = "",
        project_name: str = "",
        daw: str = "",
        manuscript_python: str = "",
        manuscript_backend: str = "",
        compare_python: str = "",
        compare_backend: str = "",
        audio_base_url: str = "",
        diagnostics: SessionDiagnostics | None = None,
    ):
        self.project_folder = project_folder or None
        self.project_name = project_name or (Path(self.project_folder).name if self.project_folder else "Unsaved REAPER project")
        self.daw = daw or "REAPER"
        self._session_dir = session_dir
        self._bridge = BridgeClient(session_dir)
        self.manuscript_python = manuscript_python
        self.manuscript_backend = manuscript_backend
        self.compare_python = compare_python
        self.compare_backend = compare_backend
        self.guide_audio_base_url = audio_base_url
        self.diagnostics = diagnostics or SessionDiagnostics(session_dir)

        self._lock = threading.RLock()
        self._run = TranscriptRun()
        self._last_completed_json: str | None = None
        self._revision = 1
        self.closed = False
        self.show_open_docx_dialog = None  # set by main.py once a dialog implementation is wired up (Phase 4)

        # Tracks whether the browser tab is still around, so main.py's idle
        # watchdog can shut this process down once it's gone - see
        # touch_activity(). Deliberately a timestamp, not a connection count:
        # an earlier version counted SSE connects/disconnects, but a single
        # duplicate/leaked connection (observed happening for reasons outside
        # this app - proxying/tooling, not the browser's own EventSource)
        # permanently wedged the count above zero and the server never shut
        # down. A refreshed-on-every-request timestamp has no such failure
        # mode: it just needs *something* (the periodic heartbeat, or any
        # real usage) to keep touching it, self-healing across duplicates.
        self.last_activity_at = time.monotonic()

        if self.project_folder:
            last_run_path = Path(self.project_folder) / ".narration-last-comparison.json"
            if last_run_path.is_file():
                self._last_completed_json = last_run_path.read_text(encoding="utf-8")

        self.diagnostics.event("hub_created", {"project_folder": self.project_folder, "project_name": self.project_name})
        threading.Thread(target=self._bridge_loop, daemon=True).start()

    # -- health / diagnostics -------------------------------------------------

    def ready(self) -> dict:
        self.diagnostics.event("api_ready_called")
        return {"apiVersion": API_VERSION, "diagnosticId": self.diagnostics.identifier}

    def report_client_diagnostic(self, kind: str, message: str) -> None:
        self.diagnostics.event("client_" + kind[:48], {"message": message[:4000]})

    def _changed(self) -> None:
        with self._lock:
            self._revision += 1

    def _guide(self) -> GuideService:
        return GuideService(self.project_folder, self.manuscript_python, self.manuscript_backend)

    def _manuscript(self) -> ManuscriptService:
        return ManuscriptService(self.project_folder, self.manuscript_python, self.manuscript_backend)

    # -- settings --------------------------------------------------------------

    def settings_for_scope(self, scope: str) -> dict:
        if scope not in ("global", "project"):
            raise HubError("Unsupported settings scope")
        result: dict[str, list[dict]] = {}
        for tool, fields in FIELD_SCHEMAS.items():
            entries = []
            for f in fields:
                if scope == "project":
                    project = cfg.load_project_settings(self.project_folder or "", tool)
                    is_set = f.key in project
                    value = project.get(f.key, "") if is_set else ""
                else:
                    glob = cfg.load_global_settings(tool)
                    is_set = f.key in glob
                    value = glob.get(f.key, "") if is_set else cfg.get_default(tool, f.key, "")
                effective_value, effective_source = cfg.get(tool, f.key, self.project_folder, "")
                entries.append({
                    "key": f.key,
                    "label": f.label,
                    "kind": f.kind,
                    "choices": list(f.choices),
                    "value": value,
                    "isSet": is_set,
                    "effectiveValue": effective_value,
                    "effectiveSource": effective_source,
                })
            result[tool] = entries
        return result

    def save_settings(self, tool: str, scope: str, values: dict) -> dict:
        fields = FIELD_SCHEMAS.get(tool)
        if fields is None or scope not in ("global", "project"):
            raise HubError("Unsupported settings request")
        valid = {f.key: f for f in fields}
        clean: dict[str, object] = {}
        for key, value in values.items():
            field = valid.get(key)
            if field is None:
                raise HubError(f"Unknown setting: {key}")
            if value is not None and field.kind == "color" and not is_valid_hex(value):
                raise HubError(f"{field.label} must be a six-digit hexadecimal color.")
            if value is not None and field.kind == "choice" and value not in field.choices:
                raise HubError(f"Invalid value for {field.label}.")
            clean[key] = value
        cfg.save_scope_settings(tool, clean, self.project_folder if scope == "project" else None)
        self._changed()
        return self.bootstrap()

    # -- bootstrap / poll --------------------------------------------------------

    def bootstrap(self) -> dict:
        manuscript_path = Path(self.project_folder) / "Manuscript.docx" if self.project_folder else None
        manuscript = str(manuscript_path) if manuscript_path and manuscript_path.exists() else ""
        with self._lock:
            transcript = self._run.snapshot()
        self.diagnostics.event("bootstrap_completed", {"manuscript_found": bool(manuscript)})
        return {
            "apiVersion": API_VERSION,
            "diagnosticId": self.diagnostics.identifier,
            "projectFolder": self.project_folder or "",
            "projectName": self.project_name,
            "daw": self.daw,
            "manuscriptPath": manuscript,
            "runtime": {
                "ManuscriptGuide": {"python_exe": self.manuscript_python, "backend": self.manuscript_backend},
                "TranscriptCompare": {"python_exe": self.compare_python, "compare_script": self.compare_backend},
            },
            "transcript": transcript,
        }

    def poll(self) -> dict:
        with self._lock:
            return {"revision": self._revision, "transcript": self._run.snapshot()}

    def select_manuscript(self) -> dict:
        if not self.project_folder:
            raise HubError("Save the REAPER project before selecting its manuscript.")
        selected = self.show_open_docx_dialog() if self.show_open_docx_dialog else None
        if not selected:
            return {"path": ""}
        destination = str(Path(self.project_folder) / "Manuscript.docx")
        shutil.copyfile(selected, destination)
        cfg.save_global_setting("_shared", "last_docx_path", selected)
        self._changed()
        return {"path": destination}

    # -- transcript-compare lifecycle --------------------------------------------

    def transcript_start(self, options: dict) -> None:
        with self._lock:
            if self._run.phase in ("preparing", "running"):
                raise HubError("A comparison is already running.")
            if not self.project_folder or not (Path(self.project_folder) / "Manuscript.docx").is_file():
                raise HubError("Save the REAPER project and select its manuscript first.")
            run_id = str(int(time.time() * 1000)) + "000"
            hints_path = Path(self.project_folder) / "TranscriptCompare" / "vocabulary_hints.txt"
            hints_path.parent.mkdir(parents=True, exist_ok=True)
            hints_path.write_text(options.get("hints", "").strip(), encoding="utf-8")
            self._run = TranscriptRun(
                phase="preparing",
                run_id=run_id,
                message="Preparing the selected REAPER audio…",
                started=TranscriptRun.monotonic_seconds(),
                pending_options=dict(options),
            )
            self._bridge.send("prepare_compare", run_id)
        self._changed()

    def transcript_cancel(self) -> None:
        with self._lock:
            if self._run.phase in ("preparing", "need_chapter"):
                self._run.phase = "cancelled"
            if self._run.progress:
                Path(self._run.progress + ".cancel").write_text("cancel", encoding="utf-8")
            self._run.message = "Cancellation requested…"
        self._changed()

    def transcript_reset(self) -> None:
        with self._lock:
            if self._run.phase in ("preparing", "running"):
                raise HubError("Cancel the active comparison before starting a new one.")
            self._run = TranscriptRun()
        self._changed()

    def transcript_last_completed(self) -> dict | None:
        with self._lock:
            return json.loads(self._last_completed_json) if self._last_completed_json and self._last_completed_json.strip() else None

    def transcript_jump(self, row_id: str) -> None:
        with self._lock:
            if not any(row.get("id") == row_id for row in self._run.rows):
                raise HubError("That discrepancy is no longer available.")
            self._bridge.send("jump_to_compare_marker", self._run.run_id, row_id)

    def transcript_export_markers(self) -> None:
        with self._lock:
            if self._run.phase != "success" or not self._run.run_id or not self._run.output:
                raise HubError("Run a comparison in this session before exporting its markers.")
            if self._run.marker_export_phase == "exporting":
                raise HubError("Marker export is already in progress.")
            pending = sum(1 for row in self._run.rows if row.get("markerState") == "pending")
            if pending == 0:
                raise HubError("There are no new markers ready to export.")
            colors = [
                cfg.get("TranscriptCompare", "color_misread", self.project_folder, "FF4040")[0],
                cfg.get("TranscriptCompare", "color_skipped", self.project_folder, "FFC000")[0],
                cfg.get("TranscriptCompare", "color_extra", self.project_folder, "40A0FF")[0],
            ]
            self._run.marker_export_phase = "exporting"
            self._run.marker_export_message = f"Exporting {pending} marker{'' if pending == 1 else 's'} to REAPER…"
            self._run.marker_export_added = 0
            self._run.marker_export_skipped = 0
            self._bridge.send("export_compare_markers", self._run.run_id, self._run.output, *colors)
        self._changed()

    def transcript_add_equivalence(self, row_id: str) -> str:
        with self._lock:
            row = next((r for r in self._run.rows if r.get("id") == row_id), None)
        doc_text = row.get("docText") if row else None
        audio_text = row.get("audioText") if row else None
        if (
            row is None
            or row.get("kind") != "MISREAD"
            or not doc_text
            or not audio_text
            or " " in doc_text
            or " " in audio_text
        ):
            raise HubError("Select a single-word MISREAD result to add an equivalence.")
        path = Path(self.project_folder) / "TranscriptCompare" / "equivalences.csv"
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.is_file():
            path.write_text("# Transcript Compare - custom word equivalences\n# One comma-separated group per line.\n", encoding="utf-8")
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(f"{doc_text}, {audio_text}\n")
        return f"Added equivalence: {doc_text} = {audio_text}"

    def transcript_suggest_hints(self) -> str:
        accepted = self.transcript_hints()
        accepted_lower = {a.lower() for a in accepted}
        try:
            candidates = self._guide().vocabulary_candidates()
        except GuideError as exc:
            raise HubError(str(exc)) from exc
        return ", ".join(c for c in candidates if c.lower() not in accepted_lower)

    def _vocab_hints_path(self) -> Path:
        return Path(self.project_folder) / "TranscriptCompare" / "vocab_hints.json"

    def transcript_hints(self) -> list[str]:
        if not self.project_folder or not self._vocab_hints_path().is_file():
            return []
        try:
            return json.loads(self._vocab_hints_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []

    def transcript_save_hints(self, accepted: list[str]) -> None:
        if not self.project_folder:
            raise HubError("Select a manuscript first.")
        path = self._vocab_hints_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        # Case-insensitive de-dup keeping the first-seen casing, matching
        # C#'s Distinct(StringComparer.OrdinalIgnoreCase) - a plain set
        # comprehension is case-sensitive and would keep both "aurelian"
        # and "Aurelian" as distinct entries.
        seen: dict[str, str] = {}
        for h in accepted:
            trimmed = h.strip()
            if trimmed and trimmed.casefold() not in seen:
                seen[trimmed.casefold()] = trimmed
        cleaned = sorted(seen.values(), key=str.casefold)
        path.write_text(json.dumps(cleaned), encoding="utf-8")

    # -- Story Bible / Guide ------------------------------------------------------

    def guide_build(self) -> str:
        try:
            return self._guide().build()
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_entities(self) -> list:
        return self._guide().entities()

    def guide_edit(self, entity_id: str, values: dict) -> None:
        try:
            self._guide().edit(entity_id, values)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_set_locked(self, entity_id: str, locked: bool) -> None:
        try:
            self._guide().set_locked(entity_id, locked)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_rescan(self, entity_id: str) -> None:
        try:
            self._guide().rescan(entity_id)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_create(self, name: str, category: str, aliases: list[str]) -> str:
        try:
            return self._guide().create(name, category, aliases)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_merge(self, source_id: str, target_id: str) -> None:
        try:
            self._guide().merge(source_id, target_id)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_delete(self, entity_id: str) -> None:
        try:
            self._guide().delete(entity_id)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_relate(self, entity_id: str, other_id: str, label: str) -> None:
        try:
            self._guide().relate(entity_id, other_id, label)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_unrelate(self, entity_id: str, other_id: str, label: str) -> None:
        try:
            self._guide().unrelate(entity_id, other_id, label)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_export(self) -> str:
        try:
            return self._guide().export_hotwords()
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    def guide_preview(self, entity_id: str, alias_index: int | None = None) -> str:
        try:
            return preview_url(self._guide(), self.guide_audio_base_url, entity_id, alias_index)
        except GuideError as exc:
            raise HubError(str(exc)) from exc

    # -- Manuscript reader --------------------------------------------------------

    def manuscript_chapters(self) -> list[dict]:
        try:
            return self._manuscript().chapters()
        except ManuscriptError as exc:
            raise HubError(str(exc)) from exc

    def manuscript_reader(self) -> dict:
        try:
            return self._manuscript().reader()
        except ManuscriptError as exc:
            raise HubError(str(exc)) from exc

    def manuscript_reader_state(self) -> dict:
        return self._manuscript().get_reader_state()

    def manuscript_reader_state_save(self, active_chapter, active_source_line, expanded_chapters=None) -> dict:
        return self._manuscript().save_reader_state(active_chapter, active_source_line, expanded_chapters)

    def manuscript_bookmark_create(self, kind, chapter, paragraph, source_line, note_id) -> dict:
        try:
            return self._manuscript().create_bookmark(kind, chapter, paragraph, source_line, note_id)
        except ManuscriptError as exc:
            raise HubError(str(exc)) from exc

    def manuscript_bookmark_delete(self, bookmark_id: str) -> None:
        self._manuscript().delete_bookmark(bookmark_id)

    def manuscript_paragraphs(self, chapter: str) -> list[dict]:
        try:
            return self._manuscript().paragraphs(chapter)
        except ManuscriptError as exc:
            raise HubError(str(exc)) from exc

    def manuscript_search(self, query: str) -> list[dict]:
        try:
            return self._manuscript().search(query)
        except ManuscriptError as exc:
            raise HubError(str(exc)) from exc

    def manuscript_set_chapter_status(self, chapter: str, status: str) -> dict:
        try:
            return self._manuscript().set_chapter_status(chapter, status)
        except ManuscriptError as exc:
            raise HubError(str(exc)) from exc

    def manuscript_note_list(self, chapter: str | None) -> list[dict]:
        return self._manuscript().note_list(chapter)

    def manuscript_note_create(self, chapter, paragraph, text, anchor_start=None, anchor_end=None, anchor_text=None) -> dict:
        try:
            return self._manuscript().note_create(chapter, paragraph, text, anchor_start, anchor_end, anchor_text)
        except ManuscriptError as exc:
            raise HubError(str(exc)) from exc

    def manuscript_note_delete(self, note_id: str) -> None:
        self._manuscript().note_delete(note_id)

    # -- REAPER bridge loop -----------------------------------------------------

    def _append_log(self, text: str) -> None:
        with self._lock:
            if text:
                self._run.logs.extend(text.split("\n"))
            if len(self._run.logs) > 500:
                self._run.logs = self._run.logs[-500:]
        self._changed()

    def _bridge_loop(self) -> None:
        while not self.closed:
            try:
                for raw in self._bridge.read_events():
                    self._handle_event(decode_fields(raw))
                self._poll_backend()
            except Exception as exc:  # noqa: BLE001 - mirrors Hub.cs's catch-all bridge-loop guard
                self._append_log(f"Bridge error: {exc}")
            time.sleep(0.15)

    @staticmethod
    def _parse_float(value: str) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _parse_int(value: str) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return 0

    def _handle_event(self, fields: list[str]) -> None:
        if not fields:
            return
        tag, rest = fields[0], fields[1:]

        if tag == "COMPARE_PREPARED" and len(rest) >= 5:
            run_id, manifest, docx, track, diff_path = rest[0], rest[1], rest[2], rest[3], rest[4]
            with self._lock:
                if run_id != self._run.run_id or self._run.phase != "preparing":
                    return
                self._run.manifest = manifest
                self._run.diff_path = diff_path
            self._launch_backend(docx, track)

        elif tag == "COMPARE_MARKER" and len(rest) >= 8:
            run_id, row_id, kind, name, doc_text, audio_text, project_time, item_index = rest[:8]
            with self._lock:
                if run_id == self._run.run_id and self._run.phase == "inspecting":
                    self._run.rows.append({
                        "id": row_id, "kind": kind, "name": name, "docText": doc_text, "audioText": audio_text,
                        "projectTime": self._parse_float(project_time), "itemIndex": self._parse_int(item_index),
                        "srcpos": self._parse_float(rest[14]) if len(rest) > 14 else 0,
                        "chapter": rest[8] if len(rest) > 8 else "", "paragraph": self._parse_int(rest[9]) if len(rest) > 9 else 0,
                        "scriptContext": rest[10] if len(rest) > 10 else doc_text, "audioContext": rest[11] if len(rest) > 11 else audio_text,
                        "markerState": rest[12] if len(rest) > 12 else "pending",
                        "existingMarkerName": rest[13] if len(rest) > 13 else "",
                    })
            self._changed()

        elif tag == "COMPARE_INSPECTED" and len(rest) >= 4:
            run_id, summary, _total, existing = rest[0], rest[1], rest[2], rest[3]
            with self._lock:
                if run_id == self._run.run_id and self._run.phase == "inspecting":
                    self._run.phase = "success"
                    self._run.percent = 100
                    existing_count = self._parse_int(existing)
                    self._run.summary = f"{summary} {existing_count} already marked." if existing_count > 0 else summary
                    self._run.message = "Comparison complete — review discrepancies before exporting markers."
                    self._persist_last_comparison()
            self._changed()

        elif tag == "COMPARE_EXPORT_MARKER" and len(rest) >= 3:
            run_id, row_id, marker_state = rest[0], rest[1], rest[2]
            with self._lock:
                if run_id == self._run.run_id and self._run.marker_export_phase == "exporting":
                    row = next((r for r in self._run.rows if r.get("id") == row_id), None)
                    if row is not None:
                        row["markerState"] = marker_state
                        row["existingMarkerName"] = rest[3] if len(rest) > 3 else ""
            self._changed()

        elif tag == "COMPARE_EXPORTED" and len(rest) >= 3:
            run_id, added, skipped = rest[0], self._parse_int(rest[1]), self._parse_int(rest[2])
            with self._lock:
                if run_id == self._run.run_id and self._run.marker_export_phase == "exporting":
                    self._run.marker_export_phase = "complete"
                    self._run.marker_export_added = added
                    self._run.marker_export_skipped = skipped
                    self._run.marker_export_message = f"Exported {added} marker{'' if added == 1 else 's'}; skipped {skipped} existing."
                    self._persist_last_comparison()
            self._changed()

        elif tag == "ERROR":
            with self._lock:
                message = rest[0] if rest else "REAPER integration failed."
                if self._run.marker_export_phase == "exporting":
                    self._run.marker_export_phase = "error"
                    self._run.marker_export_message = message
                else:
                    self._run.phase = "error"
                    self._run.message = message
            self._changed()

    def _persist_last_comparison(self) -> None:
        self._last_completed_json = json.dumps(self._run.snapshot())
        if self.project_folder:
            (Path(self.project_folder) / ".narration-last-comparison.json").write_text(self._last_completed_json, encoding="utf-8")

    def _launch_backend(self, docx: str, track: str) -> None:
        with self._lock:
            run = self._run
            if run.manifest is None:
                return
            options = run.pending_options
            run.output = str(Path(self._session_dir) / f"results_{run.run_id}.txt")
            run.progress = str(Path(self._session_dir) / f"progress_{run.run_id}.txt")
            run.log_path = str(Path(self._session_dir) / f"log_{run.run_id}.txt")
            args = [
                self.compare_backend, "--manifest", run.manifest, "--docx", docx, "--track-name", track,
                "--out", run.output, "--diff-out", run.diff_path or "", "--model", options.get("model", "small"),
                "--progress", run.progress, "--log", run.log_path,
            ]
            chapter_title = options.get("chapterTitle")
            if chapter_title:
                args += ["--chapter-title", chapter_title]
            chunk_seconds = options.get("chunk")
            if chunk_seconds and chunk_seconds.lstrip("-").isdigit():
                workers = options.get("workers")
                args += ["--chunk-seconds", chunk_seconds, "--parallel-workers", "0" if workers == "Auto" else (workers or "0")]
            run.phase = "running"
            run.message = "Launching transcript backend…"
            run.backend_process = process_utils.start_detached_silently(self.compare_python, args)
        self._changed()

    def _poll_backend(self) -> None:
        with self._lock:
            run = self._run
            if run.phase != "running":
                return
            progress, log_path, process, output = run.progress, run.log_path, run.backend_process, run.output

        if progress and os.path.isfile(progress):
            lines = Path(progress).read_text(encoding="utf-8", errors="replace").splitlines()
            last = lines[-1] if lines else ""
            if last:
                stage, _, rest = last.partition("|")
                if rest:
                    pct, _, detail = rest.partition("|")
                    with self._lock:
                        run.percent = self._parse_float(pct)
                        run.message = detail or stage
                    self._changed()
                    if stage in ("CANCELLED", "ERROR"):
                        with self._lock:
                            run.phase = "cancelled" if stage == "CANCELLED" else "error"
                        self._changed()
                        return

        if log_path and os.path.isfile(log_path):
            with open(log_path, "rb") as handle:
                handle.seek(run.log_offset)
                raw = handle.read()
                run.log_offset = handle.tell()
            text = raw.decode("utf-8", errors="replace")
            if text:
                self._append_log(text)

        if process is not None and process.has_exited and output and os.path.isfile(output):
            content = Path(output).read_text(encoding="utf-8", errors="replace")
            if content.startswith("NEED_CHAPTER|"):
                with self._lock:
                    run.phase = "need_chapter"
                    run.chapters = [v for v in content[content.index("|") + 1:].strip().split("|") if v]
                    run.message = "Choose the manuscript chapter."
                self._changed()
                return
            if process.exit_code == 2:
                with self._lock:
                    run.phase = "cancelled"
                    run.message = "Cancelled — no markers were added."
                self._changed()
                return
            if process.exit_code != 0:
                with self._lock:
                    run.phase = "error"
                    run.message = "Transcript backend failed."
                self._changed()
                return
            self._bridge.send("inspect_compare_results", run.run_id, output)
            with self._lock:
                run.phase = "inspecting"
                run.message = "Checking existing take markers in REAPER…"
                run.backend_process = None
                if run.diff_path and os.path.isfile(run.diff_path):
                    run.diff = Path(run.diff_path).read_text(encoding="utf-8", errors="replace")
            self._changed()

    def close(self) -> None:
        self.diagnostics.event("hub_close_requested")
        self.transcript_cancel()
        self.closed = True
        self._bridge.send("close")

    # -- browser-tab liveness (see main.py's idle watchdog) ----------------------

    def touch_activity(self) -> None:
        self.last_activity_at = time.monotonic()
