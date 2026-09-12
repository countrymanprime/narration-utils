"""DAW-agnostic manuscript selection: pick a .docx, cache it as the
project's canonical ``Manuscript.docx``, remember where it was picked from.

This used to be reimplemented independently by each DAW's own scripting
language (once per tool, per DAW). Both tools already share the exact same
``<project folder>/Manuscript.docx`` convention, so there's only one flow
here, not one per tool - a DAW's wrapper just needs to know its own
project's folder (the one piece that really is DAW-specific) and call
`pick_and_cache_manuscript`.
"""

import shutil
from pathlib import Path

from narration_common.config import load_global_settings, save_global_setting

_LAST_PATH_TOOL = "_shared"
_LAST_PATH_KEY = "last_docx_path"


def get_last_docx_path() -> str:
    return load_global_settings(_LAST_PATH_TOOL).get(_LAST_PATH_KEY, "")


def set_last_docx_path(path: str) -> None:
    save_global_setting(_LAST_PATH_TOOL, _LAST_PATH_KEY, path)


def has_cached_manuscript(project_folder: str) -> bool:
    return bool(project_folder) and (Path(project_folder) / "Manuscript.docx").is_file()


def pick_and_cache_manuscript(project_folder: str, dialog_title: str = "Select the manuscript (.docx)") -> str | None:
    """Prompts for a .docx via a native file dialog, copies it into
    ``<project_folder>/Manuscript.docx`` when a project is open, and
    remembers the picked path as the starting point for next time. Returns
    the picked path, or None if the user cancelled."""
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        picked = filedialog.askopenfilename(
            title=dialog_title,
            initialdir=str(Path(get_last_docx_path()).parent) if get_last_docx_path() else None,
            filetypes=[("Word documents", "*.docx"), ("All files", "*.*")],
        )
    finally:
        root.destroy()

    if not picked:
        return None

    set_last_docx_path(picked)

    if project_folder:
        destination = Path(project_folder) / "Manuscript.docx"
        shutil.copyfile(picked, destination)

    return picked
