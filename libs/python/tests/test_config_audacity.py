"""Settings-store smoke test for a second DAW (audacity-integration PRD, Phase 5).

config.py's docstring promises that a non-REAPER adapter gets layered settings
for free. This proves it for an Audacity-shaped project folder (an .aup3, no
.rpp, no REAPER ExtState): every tier resolves, and an override saves into the
project's own sidecar, with no code change to config.py.
"""

import json
import sys
from pathlib import Path

PYTHON_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(PYTHON_ROOT))

from narration_common import config


def _write_json(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")


def test_an_audacity_project_resolves_every_settings_tier(tmp_path, monkeypatch):
    app_data = tmp_path / "appdata"
    monkeypatch.setenv("APPDATA", str(app_data))
    project = tmp_path / "Book"
    project.mkdir()
    (project / "Book.aup3").write_bytes(b"not a real Audacity project")
    _write_json(app_data / "narration-utils" / "global-settings.json", {"TranscriptCompare": {"model_size": "medium"}})
    _write_json(project / "narration-utils" / "settings.json", {"TranscriptCompare": {"color_misread": "112233"}})

    assert config.get("TranscriptCompare", "color_misread", str(project), "") == ("112233", "project")
    assert config.get("TranscriptCompare", "model_size", str(project), "") == ("medium", "global")
    assert config.get("TranscriptCompare", "chunk_seconds", str(project), "") == ("60", "repo_default")
    assert config.get("TranscriptCompare", "no_such_key", str(project), "fallback") == ("fallback", "hardcoded")

    config.save_project_setting(str(project), "TranscriptCompare", "color_skipped", "445566")
    assert config.get("TranscriptCompare", "color_skipped", str(project), "") == ("445566", "project")
    assert sorted(path.name for path in project.iterdir()) == ["Book.aup3", "narration-utils"]
