"""Shared settings window for every narration-utils tool.

One implementation, reused by every DAW's Configure entry point: a DAW's
thin wrapper resolves the current project's folder (the one genuinely
DAW-specific piece) and its tool's currently-saved ExtState-equivalent
values, then launches this with `--tool`, `--project-folder`, and one
`--seed key=value` per existing value, and waits for it to close. Everything
about what fields exist, how they're validated, and where they're stored
lives here - not duplicated per DAW.

python_exe / backend script paths are NOT shown here - a DAW needs to
resolve those itself before it can invoke Python at all, so they stay a
tiny, separate, DAW-native prompt.
"""

from __future__ import annotations

import argparse
import sys
import tkinter as tk
from pathlib import Path
from tkinter import ttk

from narration_common import config

TOOL_TITLES = {
    "ManuscriptGuide": "Manuscript Guide",
    "TranscriptCompare": "Transcript Compare",
}


def _valid_hex_color(value: str) -> tuple[bool, str]:
    ok = len(value) == 6 and all(c in "0123456789abcdefABCDEF" for c in value)
    return ok, "Must be a 6-digit hex value like FF4040."


FIELD_SCHEMAS = {
    "ManuscriptGuide": [
        {"key": "spacy_model", "label": "spaCy model", "type": "text"},
        {"key": "espeak_library", "label": "eSpeak NG DLL (optional)", "type": "text"},
        {"key": "piper_exe", "label": "Piper executable (optional)", "type": "text"},
        {"key": "piper_model", "label": "Piper voice model (optional)", "type": "text"},
    ],
    "TranscriptCompare": [
        {"key": "model_size", "label": "Whisper model", "type": "choice",
         "options": ["tiny", "base", "small", "medium", "large-v3"]},
        {"key": "color_misread", "label": "MISREAD color (hex)", "type": "text", "validate": _valid_hex_color},
        {"key": "color_skipped", "label": "SKIPPED color (hex)", "type": "text", "validate": _valid_hex_color},
        {"key": "color_extra", "label": "EXTRA color (hex)", "type": "text", "validate": _valid_hex_color},
    ],
}


class ScopeTab(ttk.Frame):
    """One tab's worth of fields for a single scope ("global" or "project")."""

    def __init__(self, parent, tool: str, scope: str, project_folder: str):
        super().__init__(parent, padding=12)
        self.tool = tool
        self.scope = scope
        self.project_folder = project_folder
        self.vars: dict[str, tk.StringVar] = {}
        self.errors: dict[str, tk.StringVar] = {}
        self.inherit_labels: dict[str, tk.StringVar] = {}

        for row, field in enumerate(FIELD_SCHEMAS[tool]):
            key = field["key"]
            ttk.Label(self, text=field["label"]).grid(row=row * 3, column=0, sticky="w", pady=(6, 0))

            var = tk.StringVar(value=self._initial_value(key))
            self.vars[key] = var
            if field["type"] == "choice":
                widget = ttk.Combobox(self, textvariable=var, values=field["options"], state="readonly", width=30)
            else:
                widget = ttk.Entry(self, textvariable=var, width=40)
            widget.grid(row=row * 3, column=1, sticky="we", padx=(8, 0), pady=(6, 0))

            error_var = tk.StringVar(value="")
            self.errors[key] = error_var
            ttk.Label(self, textvariable=error_var, foreground="#c0392b").grid(
                row=row * 3 + 1, column=1, sticky="w", padx=(8, 0))

            inherit_var = tk.StringVar(value="")
            self.inherit_labels[key] = inherit_var
            if scope == "project":
                info_row = ttk.Frame(self)
                info_row.grid(row=row * 3 + 2, column=1, sticky="w", padx=(8, 0))
                ttk.Label(info_row, textvariable=inherit_var, foreground="#666666").pack(side="left")
                ttk.Button(info_row, text="Revert to default", command=lambda k=key: self._revert(k)).pack(
                    side="left", padx=(8, 0))
            self._refresh_inherit_label(key)

        self.columnconfigure(1, weight=1)

    def _initial_value(self, key: str) -> str:
        if self.scope == "global":
            return str(config.load_global_settings(self.tool).get(
                key, config.get_default(self.tool, key, "")))
        project_values = config.load_project_settings(self.project_folder, self.tool)
        return str(project_values.get(key, ""))

    def _refresh_inherit_label(self, key: str) -> None:
        if self.scope != "project":
            return
        is_override = config.is_project_override(self.project_folder, self.tool, key)
        if is_override:
            self.inherit_labels[key].set("(project override)")
        else:
            value, _scope = config.get(self.tool, key, None, config.get_default(self.tool, key, ""))
            self.inherit_labels[key].set(f"(inherits: {value})")

    def _revert(self, key: str) -> None:
        config.clear_project_override(self.project_folder, self.tool, key)
        self.vars[key].set("")
        self._refresh_inherit_label(key)

    def validate(self) -> bool:
        ok = True
        for field in FIELD_SCHEMAS[self.tool]:
            key = field["key"]
            self.errors[key].set("")
            validate_fn = field.get("validate")
            value = self.vars[key].get()
            if self.scope == "project" and value == "":
                continue  # blank on the project tab means "no override", not an empty value
            if validate_fn is not None:
                valid, message = validate_fn(value)
                if not valid:
                    self.errors[key].set(message)
                    ok = False
        return ok

    def save(self) -> None:
        for field in FIELD_SCHEMAS[self.tool]:
            key = field["key"]
            value = self.vars[key].get()
            if self.scope == "project":
                if value == "":
                    # A blank project field is the explicit UI representation
                    # of inheritance.  Leaving an old override here made
                    # "Revert to default" appear to work until Save, then
                    # silently restored the value on the next launch.
                    config.clear_project_override(self.project_folder, self.tool, key)
                    continue
                config.save_project_setting(self.project_folder, self.tool, key, value)
            else:
                config.save_global_setting(self.tool, key, value)


class SettingsWindow(tk.Tk):
    def __init__(self, tool: str, project_folder: str):
        super().__init__()
        self.title(f"{TOOL_TITLES.get(tool, tool)} - Settings")
        self.resizable(False, False)

        notebook = ttk.Notebook(self)
        notebook.pack(fill="both", expand=True, padx=8, pady=8)

        self.global_tab = ScopeTab(notebook, tool, "global", project_folder)
        notebook.add(self.global_tab, text="Global Defaults")

        self.project_tab = ScopeTab(notebook, tool, "project", project_folder)
        notebook.add(self.project_tab, text="This Project")
        if not project_folder:
            notebook.tab(self.project_tab, state="disabled")

        self.notebook = notebook

        buttons = ttk.Frame(self, padding=(12, 0, 12, 12))
        buttons.pack(fill="x")
        ttk.Button(buttons, text="Cancel", command=self.destroy).pack(side="right")
        ttk.Button(buttons, text="Save", command=self._on_save).pack(side="right", padx=(0, 8))

    def _active_tab(self) -> ScopeTab:
        return self.global_tab if self.notebook.index("current") == 0 else self.project_tab

    def _on_save(self) -> None:
        active = self._active_tab()
        if not active.validate():
            return
        active.save()
        self.destroy()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tool", required=True, choices=sorted(FIELD_SCHEMAS.keys()))
    parser.add_argument("--project-folder", default="")
    parser.add_argument("--seed", action="append", default=[], help="key=value, repeatable")
    args = parser.parse_args()

    seed = {}
    for pair in args.seed:
        if "=" in pair:
            key, _, value = pair.partition("=")
            seed[key] = value
    if seed:
        config.seed_global_if_missing(args.tool, seed)

    window = SettingsWindow(args.tool, args.project_folder)
    window.mainloop()


if __name__ == "__main__":
    main()
