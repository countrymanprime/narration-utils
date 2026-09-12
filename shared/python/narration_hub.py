"""The persistent, centered Narration Utils Tk/ttk workspace.

The window is deliberately DAW-agnostic.  REAPER supplies project context
and receives DAW-only requests through :mod:`narration_common.ui_bridge`.
Analyzer configuration and the Manuscript Guide backend remain normal local
Python processes, so no analysis behavior is moved into the UI layer.
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
import tkinter as tk

from narration_common import config
from narration_common.ui_bridge import BridgeClient

TOOL_TITLES = {
    "ManuscriptGuide": "Manuscript Guide",
    "TranscriptCompare": "Transcript Compare",
}

FIELD_SCHEMAS = {
    "ManuscriptGuide": [
        ("spacy_model", "spaCy model", "text", ()),
        ("espeak_library", "eSpeak NG DLL", "text", ()),
        ("piper_exe", "Piper executable", "text", ()),
        ("piper_model", "Piper voice model", "text", ()),
    ],
    "TranscriptCompare": [
        ("model_size", "Default Whisper model", "choice", ("tiny", "base", "small", "medium", "large-v3")),
        ("color_misread", "Misread marker color", "color", ()),
        ("color_skipped", "Skipped marker color", "color", ()),
        ("color_extra", "Extra marker color", "color", ()),
    ],
}


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def validate_hex(value: str) -> bool:
    return len(value) == 6 and all(char in "0123456789abcdefABCDEF" for char in value)


class BackgroundWork:
    def __init__(self, root: tk.Misc):
        self.root = root

    def run(self, fn, on_done) -> None:
        results: queue.Queue[tuple[bool, object]] = queue.Queue()
        def worker() -> None:
            try:
                results.put((True, fn()))
            except Exception as exc:  # shown in the UI, never on a Tk worker thread
                results.put((False, exc))
        threading.Thread(target=worker, daemon=True).start()

        def poll() -> None:
            try:
                ok, result = results.get_nowait()
            except queue.Empty:
                self.root.after(80, poll)
                return
            on_done(ok, result)
        self.root.after(80, poll)


class GuideService:
    def __init__(self, project_folder: str, python_exe: str, backend: str):
        self.project_folder = Path(project_folder) if project_folder else None
        self.python_exe = python_exe
        self.backend = backend

    @property
    def manuscript(self) -> Path | None:
        if not self.project_folder:
            return None
        path = self.project_folder / "Manuscript.docx"
        return path if path.is_file() else None

    @property
    def data_dir(self) -> Path | None:
        return self.project_folder / "ManuscriptGuide" if self.project_folder else None

    @property
    def guide_path(self) -> Path | None:
        return self.data_dir / "manuscript_guide.json" if self.data_dir else None

    def _run(self, *args: str) -> subprocess.CompletedProcess[str]:
        if not self.python_exe or not Path(self.python_exe).is_file():
            raise RuntimeError("Configure the Manuscript Guide Python executable in Global Settings.")
        if not self.backend or not Path(self.backend).is_file():
            raise RuntimeError("Configure the Manuscript Guide backend in Global Settings.")
        return subprocess.run([self.python_exe, self.backend, *args], text=True, capture_output=True, check=False)

    def build(self) -> str:
        manuscript, guide, data = self.manuscript, self.guide_path, self.data_dir
        if not manuscript or not guide or not data:
            raise RuntimeError("Save the REAPER project and select a manuscript first.")
        data.mkdir(parents=True, exist_ok=True)
        model, _ = config.get("ManuscriptGuide", "spacy_model", str(self.project_folder), "en_core_web_sm")
        arguments = ["build", "--docx", str(manuscript), "--out", str(guide), "--spacy-model", str(model)]
        espeak, _ = config.get("ManuscriptGuide", "espeak_library", str(self.project_folder), "")
        if espeak:
            arguments.extend(("--espeak-library", str(espeak)))
        result = self._run(*arguments)
        if result.returncode or not guide.is_file():
            raise RuntimeError(result.stderr.strip() or "Manuscript Guide build failed.")
        return "Guide rebuilt."

    def index(self) -> list[dict[str, str]]:
        guide, data = self.guide_path, self.data_dir
        if not guide or not guide.is_file() or not data:
            return []
        out = data / "hub-index.txt"
        result = self._run("index", "--guide", str(guide), "--out", str(out))
        if result.returncode or not out.is_file():
            raise RuntimeError(result.stderr.strip() or "Could not read the guide.")
        records = []
        from urllib.parse import unquote
        for line in out.read_text(encoding="utf-8").splitlines():
            fields = line.split("|", 11)
            if len(fields) == 12 and fields[0] == "ENTITY":
                records.append(dict(zip(("tag", "id", "category", "name", "say", "ipa", "count", "locks", "description", "traits", "chapter", "evidence"), map(unquote, fields))))
        return records

    def edit(self, entity_id: str, field: str, value: str, locked: bool) -> None:
        guide = self.guide_path
        if not guide:
            raise RuntimeError("No project guide is available.")
        result = self._run("edit", "--guide", str(guide), "--entity-id", entity_id, "--field", field, "--value", value, "--lock", "on" if locked else "off")
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or "Could not save the guide entry.")

    def export_hotwords(self) -> str:
        guide, data = self.guide_path, self.data_dir
        if not guide or not data:
            raise RuntimeError("No project guide is available.")
        out = data / "whisper_hotwords.txt"
        result = self._run("export-hotwords", "--guide", str(guide), "--out", str(out))
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or "Could not export hotwords.")
        return str(out)

    def preview(self, entity_id: str) -> str:
        guide, data = self.guide_path, self.data_dir
        if not guide or not data:
            raise RuntimeError("No project guide is available.")
        piper, _ = config.get("ManuscriptGuide", "piper_exe", str(self.project_folder), "")
        voice, _ = config.get("ManuscriptGuide", "piper_model", str(self.project_folder), "")
        if not piper or not voice:
            raise RuntimeError("Set Piper executable and voice model in Global or This Project settings.")
        audio = data / "audio"
        result = self._run("render-audio", "--guide", str(guide), "--entity-id", entity_id, "--audio-dir", str(audio), "--piper-exe", str(piper), "--piper-model", str(voice))
        if result.returncode:
            raise RuntimeError(result.stderr.strip() or "Could not render the preview.")
        # The backend writes a deterministic entity-id WAV name.
        output = audio / f"{entity_id}.wav"
        if not output.is_file():
            raise RuntimeError("Preview rendering finished without an audio file.")
        os.startfile(output)  # type: ignore[attr-defined]  # Windows-only REAPER host
        return str(output)


class SettingsPage(ttk.Frame):
    def __init__(self, parent, app: "NarrationHub"):
        super().__init__(parent, padding=20)
        self.app = app
        self.scope = tk.StringVar(value="global")
        self.tool = tk.StringVar(value="ManuscriptGuide")
        self.values: dict[str, tk.StringVar] = {}
        self.info = tk.StringVar()
        self.form = ttk.Frame(self)
        ttk.Label(self, text="Settings", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(self, text="Project values override global defaults. Runtime paths are global only.").pack(anchor="w", pady=(3, 14))
        scope_box = ttk.Frame(self)
        scope_box.pack(fill="x")
        ttk.Radiobutton(scope_box, text="Global", variable=self.scope, value="global", command=self.reload).pack(side="left")
        ttk.Radiobutton(scope_box, text="This Project", variable=self.scope, value="project", command=self.reload).pack(side="left", padx=14)
        ttk.Label(scope_box, textvariable=self.info).pack(side="right")
        ttk.Combobox(self, textvariable=self.tool, values=list(TOOL_TITLES), state="readonly", width=28).pack(anchor="w", pady=14)
        self.tool.trace_add("write", lambda *_: self.reload())
        self.form.pack(fill="x")
        bottom = ttk.Frame(self)
        bottom.pack(fill="x", pady=(18, 0))
        ttk.Button(bottom, text="Save", command=self.save).pack(side="right")
        ttk.Button(bottom, text="Revert selected project values", command=self.revert_project).pack(side="right", padx=8)

    def reload(self) -> None:
        for child in self.form.winfo_children():
            child.destroy()
        self.values.clear()
        is_project = self.scope.get() == "project"
        if is_project and not self.app.project_folder:
            self.info.set("Save the REAPER project to enable project settings.")
            return
        self.info.set("Global defaults" if not is_project else f"Overrides for {Path(self.app.project_folder).name}")
        row = 0
        for key, label, field_type, options in FIELD_SCHEMAS[self.tool.get()]:
            ttk.Label(self.form, text=label).grid(row=row, column=0, sticky="w", pady=7)
            if is_project:
                project = config.load_project_settings(self.app.project_folder, self.tool.get())
                value = str(project.get(key, ""))
                inherited, source = config.get(self.tool.get(), key, None, config.get_default(self.tool.get(), key, ""))
                helper = f"Blank inherits {inherited!s} ({source})"
            else:
                value = str(config.load_global_settings(self.tool.get()).get(key, config.get_default(self.tool.get(), key, "")))
                helper = "Global default"
            variable = tk.StringVar(value=value)
            self.values[key] = variable
            if field_type == "choice":
                widget = ttk.Combobox(self.form, textvariable=variable, values=options, state="readonly", width=32)
            else:
                widget = ttk.Entry(self.form, textvariable=variable, width=42)
            widget.grid(row=row, column=1, sticky="ew", padx=(14, 0), pady=7)
            ttk.Label(self.form, text=helper).grid(row=row, column=2, sticky="w", padx=10)
            row += 1
        if not is_project:
            ttk.Separator(self.form).grid(row=row, columnspan=3, sticky="ew", pady=14)
            ttk.Label(self.form, text="Advanced runtime", style="Subheading.TLabel").grid(row=row + 1, column=0, sticky="w")
            runtime = self.app.runtime_fields(self.tool.get())
            for offset, (key, label, value) in enumerate(runtime, start=2):
                ttk.Label(self.form, text=label).grid(row=row + offset, column=0, sticky="w", pady=7)
                variable = tk.StringVar(value=value)
                self.values[key] = variable
                ttk.Entry(self.form, textvariable=variable, width=42).grid(row=row + offset, column=1, sticky="ew", padx=(14, 0), pady=7)
        self.form.columnconfigure(1, weight=1)

    def save(self) -> None:
        tool, is_project = self.tool.get(), self.scope.get() == "project"
        updates = {}
        for key, _label, field_type, _options in FIELD_SCHEMAS[tool]:
            value = self.values[key].get().strip()
            if field_type == "color" and value and not validate_hex(value):
                messagebox.showerror("Invalid color", f"{key} must be a six-digit hexadecimal color.", parent=self)
                return
            if is_project:
                updates[key] = None if value == "" else value
            else:
                updates[key] = value
        config.save_scope_settings(tool, updates, self.app.project_folder if is_project else None)
        if not is_project:
            for key, _label, _value in self.app.runtime_fields(tool):
                value = self.values[key].get().strip()
                self.app.runtime[tool][key] = value
                self.app.bridge.send("runtime_setting", tool, key, value)
        self.reload()
        self.app.set_status("Settings saved.")

    def revert_project(self) -> None:
        if self.scope.get() != "project" or not self.app.project_folder:
            return
        config.save_scope_settings(
            self.tool.get(),
            {key: None for key, *_rest in FIELD_SCHEMAS[self.tool.get()]},
            self.app.project_folder,
        )
        self.reload()
        self.app.set_status("Project overrides reverted.")


class GuidePage(ttk.Frame):
    def __init__(self, parent, app: "NarrationHub"):
        super().__init__(parent, padding=20)
        self.app = app
        self.entities: list[dict[str, str]] = []
        self.current: dict[str, str] | None = None
        self.query = tk.StringVar()
        self.name = tk.StringVar()
        self.category = tk.StringVar()
        self.say = tk.StringVar()
        self.ipa = tk.StringVar()
        self.locks = tk.StringVar()
        ttk.Label(self, text="Manuscript Guide", style="Heading.TLabel").pack(anchor="w")
        self.subtitle = ttk.Label(self, text="Build a local reference from the project manuscript.")
        self.subtitle.pack(anchor="w", pady=(3, 14))
        actions = ttk.Frame(self); actions.pack(fill="x", pady=(0, 12))
        ttk.Button(actions, text="Build / refresh", command=self.build).pack(side="left")
        ttk.Button(actions, text="Export hotwords", command=self.export).pack(side="left", padx=8)
        ttk.Button(actions, text="Play preview", command=self.preview).pack(side="left")
        pane = ttk.PanedWindow(self, orient="horizontal"); pane.pack(fill="both", expand=True)
        left = ttk.Frame(pane, padding=(0, 0, 12, 0)); right = ttk.Frame(pane, padding=(12, 0, 0, 0)); pane.add(left, weight=1); pane.add(right, weight=2)
        ttk.Entry(left, textvariable=self.query).pack(fill="x", pady=(0, 8)); self.query.trace_add("write", lambda *_: self.populate())
        self.listbox = tk.Listbox(left, height=16, activestyle="none", exportselection=False); self.listbox.pack(fill="both", expand=True); self.listbox.bind("<<ListboxSelect>>", self.select)
        for row, (label, variable) in enumerate((("Name", self.name), ("Category", self.category), ("Say it as", self.say), ("IPA", self.ipa), ("Locked fields (;)", self.locks))):
            ttk.Label(right, text=label).grid(row=row * 2, column=0, sticky="w", pady=(0, 3)); ttk.Entry(right, textvariable=variable, width=48).grid(row=row * 2 + 1, column=0, sticky="ew", pady=(0, 10))
        ttk.Label(right, text="Description").grid(row=10, column=0, sticky="w")
        self.description = tk.Text(right, height=3, wrap="word"); self.description.grid(row=11, column=0, sticky="ew", pady=(3, 8))
        ttk.Label(right, text="Personality note").grid(row=12, column=0, sticky="w")
        self.traits = tk.Text(right, height=3, wrap="word"); self.traits.grid(row=13, column=0, sticky="ew", pady=(3, 8))
        ttk.Label(right, text="Evidence (read-only)").grid(row=14, column=0, sticky="w")
        self.evidence = tk.Text(right, height=5, wrap="word"); self.evidence.grid(row=15, column=0, sticky="nsew", pady=(3, 4)); self.evidence.configure(state="disabled")
        ttk.Button(right, text="Save selected entry", command=self.save).grid(row=16, column=0, sticky="e", pady=(8, 0)); right.columnconfigure(0, weight=1); right.rowconfigure(15, weight=1)

    def service(self) -> GuideService:
        return self.app.guide_service()

    def show(self) -> None:
        manuscript = self.service().manuscript
        self.subtitle.configure(text=str(manuscript) if manuscript else "Select a manuscript from Home after saving the REAPER project.")
        self.load()

    def build(self) -> None:
        self.app.set_status("Building Manuscript Guide…")
        self.app.work.run(self.service().build, lambda ok, result: self._after_build(ok, result))

    def _after_build(self, ok: bool, result: object) -> None:
        if not ok:
            messagebox.showerror("Manuscript Guide", str(result), parent=self)
            self.app.set_status("Build failed.")
            return
        self.app.set_status(str(result)); self.load()

    def load(self) -> None:
        self.app.work.run(self.service().index, self._after_load)

    def _after_load(self, ok: bool, result: object) -> None:
        if not ok:
            self.app.set_status(str(result)); return
        self.entities = result  # type: ignore[assignment]
        self.populate()

    def populate(self) -> None:
        selected = self.current.get("id") if self.current else ""
        needle = self.query.get().lower()
        self.listbox.delete(0, "end")
        self.filtered = [entry for entry in self.entities if not needle or needle in entry["name"].lower() or needle in entry["category"].lower()]
        for entry in self.filtered:
            self.listbox.insert("end", f"{entry['name']}  —  {entry['category']}")
        for index, entry in enumerate(self.filtered):
            if entry["id"] == selected:
                self.listbox.selection_set(index); break

    def select(self, _event=None) -> None:
        selection = self.listbox.curselection()
        if not selection: return
        self.current = self.filtered[selection[0]]
        self.name.set(self.current["name"]); self.category.set(self.current["category"]); self.say.set(self.current["say"]); self.ipa.set(self.current["ipa"]); self.locks.set(self.current["locks"])
        self.description.delete("1.0", "end"); self.description.insert("1.0", self.current["description"])
        self.traits.delete("1.0", "end"); self.traits.insert("1.0", self.current["traits"])
        self.evidence.configure(state="normal"); self.evidence.delete("1.0", "end"); self.evidence.insert("1.0", self.current["evidence"]); self.evidence.configure(state="disabled")

    def save(self) -> None:
        if not self.current: return
        def action() -> None:
            locked = {field.strip().lower() for field in self.locks.get().split(";") if field.strip()}
            edits = (
                ("canonical_name", self.name.get()), ("category", self.category.get()),
                ("say_as", self.say.get()), ("ipa", self.ipa.get()),
                ("description", self.description.get("1.0", "end-1c")),
                ("personality", self.traits.get("1.0", "end-1c")),
            )
            for field, value in edits:
                self.service().edit(self.current["id"], field, value, field in locked)
        self.app.work.run(action, lambda ok, result: self._after_save(ok, result))

    def _after_save(self, ok: bool, result: object) -> None:
        if not ok: messagebox.showerror("Manuscript Guide", str(result), parent=self); return
        self.app.set_status("Guide entry saved."); self.load()

    def export(self) -> None:
        self.app.work.run(self.service().export_hotwords, lambda ok, result: self.app.set_status(f"Hotwords exported to {result}" if ok else str(result)))

    def preview(self) -> None:
        if not self.current:
            self.app.set_status("Select a guide entry first.")
            return
        self.app.work.run(lambda: self.service().preview(self.current["id"]), lambda ok, result: self.app.set_status(f"Preview opened: {result}" if ok else str(result)))


class TranscriptPage(ttk.Frame):
    def __init__(self, parent, app: "NarrationHub"):
        super().__init__(parent, padding=20)
        self.app = app
        self.model = tk.StringVar(value="small"); self.chunk = tk.StringVar(value="Whole file"); self.workers = tk.StringVar(value="Auto"); self.hints = tk.StringVar()
        ttk.Label(self, text="Transcript Compare", style="Heading.TLabel").pack(anchor="w")
        self.context = ttk.Label(self, text="Select a track in REAPER, then start a comparison."); self.context.pack(anchor="w", pady=(3, 16))
        form = ttk.Frame(self); form.pack(fill="x")
        fields = (("Whisper model", self.model, ("tiny", "base", "small", "medium", "large-v3")), ("Chunking", self.chunk, ("Whole file", "30 seconds", "1 minute", "5 minutes", "15 minutes", "1 hour")), ("Parallel workers", self.workers, ("Auto", "1", "2", "4", "8")))
        for row, (label, variable, options) in enumerate(fields):
            ttk.Label(form, text=label).grid(row=row, column=0, sticky="w", pady=8); ttk.Combobox(form, textvariable=variable, values=options, state="readonly", width=30).grid(row=row, column=1, sticky="w", padx=14, pady=8)
        ttk.Label(form, text="Vocabulary hints").grid(row=3, column=0, sticky="w", pady=8); ttk.Entry(form, textvariable=self.hints, width=48).grid(row=3, column=1, sticky="ew", padx=14, pady=8)
        buttons = ttk.Frame(self); buttons.pack(fill="x", pady=(22, 0)); ttk.Button(buttons, text="Save as global default", command=self.save_default).pack(side="left"); ttk.Button(buttons, text="Start comparison", style="Primary.TButton", command=self.start).pack(side="right")
        self.progress = ttk.Progressbar(self, mode="determinate"); self.progress.pack(fill="x", pady=(22, 6)); self.log = tk.Text(self, height=14, state="disabled", wrap="word"); self.log.pack(fill="both", expand=True)

    def show(self) -> None:
        value, _ = config.get("TranscriptCompare", "model_size", self.app.project_folder or None, "small")
        self.model.set(str(value))
        self.context.configure(text="Select the chapter track in REAPER, then start a comparison. Results remain in this workspace.")

    def save_default(self) -> None:
        config.save_global_setting("TranscriptCompare", "model_size", self.model.get()); self.app.set_status("Saved the global Whisper model default.")

    def start(self) -> None:
        if self.app.project_folder:
            hints_path = Path(self.app.project_folder) / "TranscriptCompare" / "vocabulary_hints.txt"
            hints_path.parent.mkdir(parents=True, exist_ok=True)
            hints_path.write_text(self.hints.get().strip(), encoding="utf-8")
        self.app.bridge.send("start_compare", self.model.get(), self.chunk.get(), self.workers.get(), self.hints.get())
        self.append("Comparison requested from REAPER. The session bridge will report progress here.")
        self.app.set_status("Transcript Compare requested.")

    def append(self, text: str) -> None:
        self.log.configure(state="normal"); self.log.insert("end", text + "\n"); self.log.see("end"); self.log.configure(state="disabled")


class RoadmapPage(ttk.Frame):
    def __init__(self, parent, _app: "NarrationHub"):
        super().__init__(parent, padding=20)
        data = json.loads((repo_root() / "shared" / "config" / "roadmap.json").read_text(encoding="utf-8"))
        ttk.Label(self, text="Product roadmap", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(self, text="Current utilities and planned milestones. Planned work is not launchable from this window.").pack(anchor="w", pady=(3, 16))
        for item in data["available"]:
            self._section("Available now", item["title"], item["summary"])
        for item in data["milestones"]:
            self._section(f"Milestone {item['number']}", item["title"], item["summary"])
        ttk.Label(self, text="Deferred: " + " · ".join(data["deferred"]), wraplength=760).pack(anchor="w", pady=(14, 0))

    def _section(self, phase: str, title: str, summary: str) -> None:
        box = ttk.Frame(self, padding=(0, 8)); box.pack(fill="x")
        ttk.Label(box, text=phase, width=15).pack(side="left", anchor="n")
        detail = ttk.Frame(box); detail.pack(side="left", fill="x", expand=True); ttk.Label(detail, text=title, style="Subheading.TLabel").pack(anchor="w"); ttk.Label(detail, text=summary, wraplength=620).pack(anchor="w")


class NarrationHub(tk.Tk):
    def __init__(self, args: argparse.Namespace):
        super().__init__()
        self.project_folder = args.project_folder
        self.project_name = args.project_name or (Path(args.project_folder).name if args.project_folder else "Unsaved REAPER project")
        self.runtime = {
            "ManuscriptGuide": {"python_exe": args.manuscript_python, "backend": args.manuscript_backend},
            "TranscriptCompare": {"python_exe": args.compare_python, "compare_script": args.compare_backend},
        }
        self.bridge = BridgeClient(args.session_dir)
        self.work = BackgroundWork(self)
        self.title("Narration Utils")
        self.minsize(960, 680); self.geometry("1000x720")
        self.protocol("WM_DELETE_WINDOW", self.close)
        self._center()
        self._styles()
        outer = ttk.Frame(self, padding=16); outer.pack(fill="both", expand=True)
        header = ttk.Frame(outer); header.pack(fill="x")
        ttk.Label(header, text="Narration Utils", style="Title.TLabel").pack(side="left")
        self.status = tk.StringVar(value="Ready")
        ttk.Label(header, textvariable=self.status).pack(side="right", padx=12)
        ttk.Button(header, text="⚙  Settings", command=lambda: self.show_page("Settings")).pack(side="right")
        self.notebook = ttk.Notebook(outer); self.notebook.pack(fill="both", expand=True, pady=(14, 0)); self.notebook.bind("<<NotebookTabChanged>>", self._on_tab)
        self.home = self._home(); self.guide = GuidePage(self.notebook, self); self.compare = TranscriptPage(self.notebook, self); self.settings = SettingsPage(self.notebook, self); self.roadmap = RoadmapPage(self.notebook, self)
        for page, name in ((self.home, "Home"), (self.guide, "Manuscript Guide"), (self.compare, "Transcript Compare"), (self.roadmap, "Roadmap"), (self.settings, "Settings")):
            self.notebook.add(page, text=name)
        self.after(250, self.poll_bridge)

    def _styles(self) -> None:
        style = ttk.Style(self); style.configure("Title.TLabel", font=("Segoe UI", 18, "bold")); style.configure("Heading.TLabel", font=("Segoe UI", 16, "bold")); style.configure("Subheading.TLabel", font=("Segoe UI", 11, "bold")); style.configure("TButton", padding=(12, 8)); style.configure("Primary.TButton", padding=(16, 9))

    def _center(self) -> None:
        self.update_idletasks(); width, height = 1000, 720; x = max(0, (self.winfo_screenwidth() - width) // 2); y = max(0, (self.winfo_screenheight() - height) // 2); self.geometry(f"{width}x{height}+{x}+{y}")

    def _home(self) -> ttk.Frame:
        page = ttk.Frame(self.notebook, padding=20); ttk.Label(page, text="Project workspace", style="Heading.TLabel").pack(anchor="w"); ttk.Label(page, text="Choose a workflow for the active REAPER project.").pack(anchor="w", pady=(3, 14))
        project = ttk.LabelFrame(page, text="Active project", padding=14); project.pack(fill="x"); ttk.Label(project, text=self.project_name, style="Subheading.TLabel").pack(anchor="w"); manuscript = Path(self.project_folder) / "Manuscript.docx" if self.project_folder else None; self.manuscript_status = ttk.Label(project, text=f"Manuscript: {manuscript}" if manuscript and manuscript.is_file() else "No project manuscript selected"); self.manuscript_status.pack(side="left", pady=(5, 0)); ttk.Button(project, text="Select manuscript…", command=self.select_manuscript).pack(side="right")
        cards = ttk.Frame(page); cards.pack(fill="x", pady=20)
        for column in (0, 1): cards.columnconfigure(column, weight=1)
        self._card(cards, 0, "Manuscript Guide", "Review characters, pronunciation, evidence, and local voice previews.", "Open guide", lambda: self.show_page("Manuscript Guide"))
        self._card(cards, 1, "Transcript Compare", "Compare the selected chapter track, then review markers and discrepancies.", "Start comparison", lambda: self.show_page("Transcript Compare"))
        roadmap = ttk.LabelFrame(page, text="Roadmap", padding=14); roadmap.pack(fill="x"); ttk.Label(roadmap, text="Next: Dashboard foundation  ·  Later: Take review, character continuity, diagnostics, and delivery.").pack(side="left"); ttk.Button(roadmap, text="View roadmap", command=lambda: self.show_page("Roadmap")).pack(side="right")
        return page

    def _card(self, parent, column, title, description, button, command) -> None:
        card = ttk.LabelFrame(parent, text=title, padding=18); card.grid(row=0, column=column, sticky="nsew", padx=(0, 8) if column == 0 else (8, 0)); ttk.Label(card, text=description, wraplength=330).pack(anchor="w", pady=(0, 18)); ttk.Button(card, text=button, style="Primary.TButton", command=command).pack(anchor="w")

    def guide_service(self) -> GuideService:
        runtime = self.runtime["ManuscriptGuide"]
        return GuideService(self.project_folder, runtime["python_exe"], runtime["backend"])

    def runtime_fields(self, tool: str) -> list[tuple[str, str, str]]:
        if tool == "ManuscriptGuide": return [("python_exe", "Python executable", self.runtime[tool]["python_exe"]), ("backend", "Guide backend", self.runtime[tool]["backend"])]
        return [("python_exe", "Python executable", self.runtime[tool]["python_exe"]), ("compare_script", "Compare backend", self.runtime[tool]["compare_script"])]

    def select_manuscript(self) -> None:
        if not self.project_folder:
            messagebox.showwarning("Save project first", "Save the REAPER project before selecting its manuscript.", parent=self); return
        selected = filedialog.askopenfilename(parent=self, title="Select the manuscript (.docx)", filetypes=(("Word documents", "*.docx"), ("All files", "*.*")))
        if not selected: return
        destination = Path(self.project_folder) / "Manuscript.docx"; shutil.copyfile(selected, destination); self.manuscript_status.configure(text=f"Manuscript: {destination}"); self.bridge.send("manuscript_selected", str(destination)); self.set_status("Project manuscript selected.")
        config.save_global_setting("_shared", "last_docx_path", selected)

    def show_page(self, name: str) -> None:
        pages = {"Home": self.home, "Manuscript Guide": self.guide, "Transcript Compare": self.compare, "Roadmap": self.roadmap, "Settings": self.settings}; self.notebook.select(pages[name]); self._on_tab()

    def _on_tab(self, _event=None) -> None:
        selected = self.notebook.nametowidget(self.notebook.select())
        if selected is self.guide: self.guide.show()
        elif selected is self.compare: self.compare.show()
        elif selected is self.settings: self.settings.reload()

    def set_status(self, text: str) -> None: self.status.set(text)

    def poll_bridge(self) -> None:
        for event in self.bridge.read_events():
            self.compare.append(event)
            if event.startswith("PROGRESS|"):
                try: self.compare.progress["value"] = float(event.split("|", 2)[1])
                except ValueError: pass
        if self.winfo_exists(): self.after(250, self.poll_bridge)

    def close(self) -> None:
        self.bridge.send("close")
        self.destroy()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--project-folder", default="")
    parser.add_argument("--project-name", default="")
    parser.add_argument("--manuscript-python", default="")
    parser.add_argument("--manuscript-backend", default="")
    parser.add_argument("--compare-python", default="")
    parser.add_argument("--compare-backend", default="")
    parser.add_argument("--seed", action="append", default=[], help="Tool|key|legacy-value; repeatable")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    for seed in args.seed:
        tool, key, value = seed.split("|", 2)
        config.seed_global_if_missing(tool, {key: value})
    NarrationHub(args).mainloop()


if __name__ == "__main__":
    main()
