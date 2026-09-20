"""Layered settings: repo defaults -> per-user global -> per-project override.

Config storage and resolution live here, in Python, rather than in each DAW's
own scripting language, so a future non-REAPER adapter (Audacity has no
ExtState equivalent) gets this for free instead of needing its own port.

Three tiers, each a JSON file shaped {"<ToolName>": {"<key>": value, ...}}:
  1. config/defaults.json   - hand-authored, read-only, checked in.
  2. %APPDATA%/narration-utils/global-settings.json - per-user, machine-wide.
  3. <project folder>/narration-utils/settings.json - per-project override.
Lookup order for get() is project -> global -> repo default -> the caller's
own hardcoded literal. A project override is "present" (even if set to an
empty string) rather than merely non-empty, so a project can deliberately
override a value back to "".

python_exe/backend script paths are NOT part of this module - a DAW's Lua
(or equivalent) needs to know where Python lives *before* it can invoke
Python at all, so that pair stays resolved by the DAW side itself.
"""

import json
import os
from pathlib import Path

_REPO_DEFAULTS_CACHE = None


def _repo_defaults_path() -> Path:
    # libs/python/narration_common/config.py -> config/defaults.json
    return Path(__file__).resolve().parents[3] / "config" / "defaults.json"


def _read_json_file(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_json_file(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    os.replace(tmp_path, path)


def _update_tool_section(path: Path, tool: str, mutate) -> None:
    """Whole-file read-modify-write, touching only `tool`'s section, so a
    write from one tool can never clobber another tool's section already
    saved in the same shared file."""
    data = _read_json_file(path)
    section = dict(data.get(tool, {}))
    mutate(section)
    data[tool] = section
    _write_json_file(path, data)


def load_repo_defaults(tool: str) -> dict:
    """config/defaults.json[tool], memoized (it's checked-in and
    read-only for the life of the process). {} if missing/malformed."""
    global _REPO_DEFAULTS_CACHE
    if _REPO_DEFAULTS_CACHE is None:
        _REPO_DEFAULTS_CACHE = _read_json_file(_repo_defaults_path())
    return _REPO_DEFAULTS_CACHE.get(tool, {})


def get_default(tool: str, key: str, hardcoded_default):
    """What an argparse `default=` should use - the repo-default tier only,
    with the caller's own literal as the last resort if the file is missing
    or has no such key."""
    return load_repo_defaults(tool).get(key, hardcoded_default)


def global_settings_path() -> Path:
    appdata = os.environ.get("APPDATA")
    base = Path(appdata) if appdata else Path.home() / "AppData" / "Roaming"
    return base / "narration-utils" / "global-settings.json"


def load_global_settings(tool: str) -> dict:
    return _read_json_file(global_settings_path()).get(tool, {})


def save_global_setting(tool: str, key: str, value) -> None:
    _update_tool_section(global_settings_path(), tool, lambda section: section.__setitem__(key, value))


def seed_global_if_missing(tool: str, seed: dict) -> None:
    """One-time migration backstop: for each key in `seed`, writes it into
    global settings only if that tool+key isn't already saved there. Safe to
    call on every launch - a no-op once real values exist."""

    def mutate(section):
        for key, value in seed.items():
            section.setdefault(key, value)

    _update_tool_section(global_settings_path(), tool, mutate)


def project_settings_path(project_folder: str) -> Path | None:
    if not project_folder:
        return None
    return Path(project_folder) / "narration-utils" / "settings.json"


def load_project_settings(project_folder: str, tool: str) -> dict:
    path = project_settings_path(project_folder)
    if path is None:
        return {}
    return _read_json_file(path).get(tool, {})


def save_project_setting(project_folder: str, tool: str, key: str, value) -> None:
    path = project_settings_path(project_folder)
    if path is None:
        raise ValueError("save_project_setting requires a project_folder")
    _update_tool_section(path, tool, lambda section: section.__setitem__(key, value))


def save_scope_settings(tool: str, values: dict, project_folder: str | None = None) -> None:
    """Atomically apply a group of settings for one tool and scope.

    ``None`` removes a project override; this is intentionally distinct from
    an empty string, which is a valid explicit global value.  The hub uses
    this for its single Save action so a crash cannot leave half a form
    applied.
    """
    path = project_settings_path(project_folder or "") if project_folder else global_settings_path()
    if path is None:
        raise ValueError("project_folder is required for project settings")

    def mutate(section):
        for key, value in values.items():
            if project_folder and value is None:
                section.pop(key, None)
            else:
                section[key] = value

    _update_tool_section(path, tool, mutate)


def clear_project_override(project_folder: str, tool: str, key: str) -> None:
    path = project_settings_path(project_folder)
    if path is None:
        return
    _update_tool_section(path, tool, lambda section: section.pop(key, None))


def is_project_override(project_folder: str, tool: str, key: str) -> bool:
    return key in load_project_settings(project_folder, tool)


def get(tool: str, key: str, project_folder: str | None, hardcoded_default):
    """Full layered lookup. Returns (value, scope) where scope is one of
    "project", "global", "repo_default", "hardcoded" - callers that show
    provenance (e.g. the settings GUI) use it to mark a value as inherited
    vs. overridden."""
    if project_folder:
        project = load_project_settings(project_folder, tool)
        if key in project:
            return project[key], "project"
    glob = load_global_settings(tool)
    if key in glob:
        return glob[key], "global"
    defaults = load_repo_defaults(tool)
    if key in defaults:
        return defaults[key], "repo_default"
    return hardcoded_default, "hardcoded"
