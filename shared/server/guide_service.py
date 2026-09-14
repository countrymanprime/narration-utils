"""Story Bible (Guide) backend calls, ported 1:1 from shared/hub/GuideService.cs.

Shells out to the Manuscript Guide tool exactly as before.
"""

import json
import os
import urllib.parse
from pathlib import Path

from narration_common import config as cfg

from . import process_utils


class GuideError(Exception):
    pass


class GuideService:
    def __init__(self, project_folder: str | None, python_exe: str, backend: str):
        self._project_folder = project_folder
        self._python_exe = python_exe
        self._backend = backend

    @property
    def _manuscript(self) -> str | None:
        if not self._project_folder:
            return None
        path = Path(self._project_folder) / "Manuscript.docx"
        return str(path) if path.exists() else None

    @property
    def _data_dir(self) -> str | None:
        return str(Path(self._project_folder) / "ManuscriptGuide") if self._project_folder else None

    @property
    def _guide_path(self) -> str | None:
        data_dir = self._data_dir
        return str(Path(data_dir) / "manuscript_guide.json") if data_dir else None

    def _run_backend(self, *args: str) -> tuple[int, str, str]:
        if not os.path.isfile(self._python_exe):
            raise GuideError("Configure the Manuscript Guide Python executable before continuing.")
        if not os.path.isfile(self._backend):
            raise GuideError("Configure the Manuscript Guide backend before continuing.")
        return process_utils.run(self._python_exe, [self._backend, *args])

    @staticmethod
    def _throw_if_failed(result: tuple[int, str, str], fallback: str) -> None:
        code, _out, err = result
        if code != 0:
            raise GuideError(err.strip() if err.strip() else fallback)

    def build(self) -> str:
        manuscript, guide_path, data_dir = self._manuscript, self._guide_path, self._data_dir
        if manuscript is None or guide_path is None or data_dir is None:
            raise GuideError("Save the REAPER project and select a manuscript first.")
        os.makedirs(data_dir, exist_ok=True)
        model, _ = cfg.get("ManuscriptGuide", "spacy_model", self._project_folder, "en_core_web_sm")
        espeak, _ = cfg.get("ManuscriptGuide", "espeak_library", self._project_folder, "")
        args = ["build", "--docx", manuscript, "--out", guide_path, "--spacy-model", model]
        if espeak:
            args += ["--espeak-library", espeak]
        result = self._run_backend(*args)
        if result[0] != 0 or not os.path.isfile(guide_path):
            raise GuideError(result[2].strip() if result[2].strip() else "Manuscript Guide build failed.")
        return "Guide rebuilt."

    def entities(self) -> list:
        guide_path = self._guide_path
        if guide_path is None or not os.path.isfile(guide_path):
            return []
        guide = json.loads(Path(guide_path).read_text(encoding="utf-8"))
        return guide.get("entities", [])

    def vocabulary_candidates(self) -> list[str]:
        guide_path = self._guide_path
        if guide_path is None or not os.path.isfile(guide_path):
            raise GuideError("Build the Story Bible before requesting vocabulary suggestions.")
        guide = json.loads(Path(guide_path).read_text(encoding="utf-8"))
        # Case-insensitive de-dup keeping the first-seen casing, matching
        # C#'s Distinct(StringComparer.OrdinalIgnoreCase) - a plain set
        # comprehension is case-sensitive and would keep "alice" and "Alice"
        # as distinct entries.
        seen: dict[str, str] = {}
        for value in guide.get("vocabulary_candidates", []):
            if isinstance(value, str) and value.strip():
                trimmed = value.strip()
                seen.setdefault(trimmed.casefold(), trimmed)
        return sorted(seen.values(), key=str.casefold)

    def edit(self, entity_id: str, values: dict) -> None:
        guide_path = self._guide_path
        if guide_path is None:
            raise GuideError("No project guide is available.")
        for field, value in values.items():
            args = ["edit", "--guide", guide_path, "--entity-id", entity_id, "--field", field, "--value", value]
            if field == "aliases":
                manuscript = self._manuscript
                if manuscript:
                    args += ["--docx", manuscript]
                espeak, _ = cfg.get("ManuscriptGuide", "espeak_library", self._project_folder, "")
                if espeak:
                    args += ["--espeak-library", espeak]
            self._throw_if_failed(self._run_backend(*args), "Could not save the guide entry.")

    def set_locked(self, entity_id: str, locked: bool) -> None:
        guide_path = self._guide_path
        if guide_path is None:
            raise GuideError("No project guide is available.")
        self._throw_if_failed(
            self._run_backend("edit", "--guide", guide_path, "--entity-id", entity_id, "--field", "locked", "--value", "true" if locked else "false"),
            "Could not update the lock state.",
        )

    def rescan(self, entity_id: str) -> None:
        guide_path, manuscript = self._guide_path, self._manuscript
        if guide_path is None:
            raise GuideError("No project guide is available.")
        if manuscript is None:
            raise GuideError("Save the REAPER project and select a manuscript first.")
        self._throw_if_failed(
            self._run_backend("rescan", "--guide", guide_path, "--docx", manuscript, "--entity-id", entity_id),
            "Could not rescan the manuscript.",
        )

    def create(self, name: str, category: str, aliases: list[str]) -> str:
        guide_path, manuscript = self._guide_path, self._manuscript
        if guide_path is None:
            raise GuideError("No project guide is available. Build it first.")
        if manuscript is None:
            raise GuideError("Save the REAPER project and select a manuscript first.")
        espeak, _ = cfg.get("ManuscriptGuide", "espeak_library", self._project_folder, "")
        args = ["create", "--guide", guide_path, "--docx", manuscript, "--name", name, "--category", category, "--aliases", ";".join(aliases)]
        if espeak:
            args += ["--espeak-library", espeak]
        result = self._run_backend(*args)
        self._throw_if_failed(result, "Could not create the entity.")
        parts = result[1].strip().split("|")
        if len(parts) < 2 or parts[0] != "CREATED":
            raise GuideError("Could not create the entity.")
        return parts[1]

    def merge(self, source_id: str, target_id: str) -> None:
        guide_path = self._guide_path
        if guide_path is None:
            raise GuideError("No project guide is available.")
        self._throw_if_failed(self._run_backend("merge", "--guide", guide_path, "--source-id", source_id, "--target-id", target_id), "Could not merge the entities.")

    def delete(self, entity_id: str) -> None:
        guide_path = self._guide_path
        if guide_path is None:
            raise GuideError("No project guide is available.")
        self._throw_if_failed(self._run_backend("delete", "--guide", guide_path, "--entity-id", entity_id), "Could not delete the entity.")

    def relate(self, entity_id: str, other_id: str, label: str) -> None:
        guide_path = self._guide_path
        if guide_path is None:
            raise GuideError("No project guide is available.")
        self._throw_if_failed(self._run_backend("relate", "--guide", guide_path, "--entity-id", entity_id, "--other-id", other_id, "--label", label), "Could not add the relationship.")

    def unrelate(self, entity_id: str, other_id: str, label: str) -> None:
        guide_path = self._guide_path
        if guide_path is None:
            raise GuideError("No project guide is available.")
        self._throw_if_failed(self._run_backend("unrelate", "--guide", guide_path, "--entity-id", entity_id, "--other-id", other_id, "--label", label), "Could not remove the relationship.")

    def export_hotwords(self) -> str:
        guide_path, data_dir = self._guide_path, self._data_dir
        if guide_path is None or data_dir is None:
            raise GuideError("No project guide is available.")
        out_path = str(Path(data_dir) / "whisper_hotwords.txt")
        result = self._run_backend("export-hotwords", "--guide", guide_path, "--out", out_path)
        if result[0] != 0:
            raise GuideError(result[2].strip() if result[2].strip() else "Could not export hotwords.")
        return out_path

    def preview(self, entity_id: str, alias_index: int | None = None) -> str:
        guide_path, data_dir = self._guide_path, self._data_dir
        if guide_path is None or data_dir is None:
            raise GuideError("No project guide is available.")
        piper, _ = cfg.get("ManuscriptGuide", "piper_exe", self._project_folder, "")
        voice, _ = cfg.get("ManuscriptGuide", "piper_model", self._project_folder, "")
        if not piper or not voice:
            raise GuideError("Set Piper executable and voice model in Settings.")
        audio_dir = str(Path(data_dir) / "audio")
        args = ["render-audio", "--guide", guide_path, "--entity-id", entity_id, "--audio-dir", audio_dir, "--piper-exe", piper, "--piper-model", voice]
        if alias_index is not None:
            args += ["--alias-index", str(alias_index)]
        result = self._run_backend(*args)
        filename = f"{entity_id}__alias{alias_index}.wav" if alias_index is not None else f"{entity_id}.wav"
        output = str(Path(audio_dir) / filename)
        if result[0] != 0 or not os.path.isfile(output):
            raise GuideError(result[2].strip() if result[2].strip() else "Could not render the preview.")
        return output


def preview_url(guide: GuideService, audio_base_url: str, entity_id: str, alias_index: int | None = None) -> str:
    """Turns a rendered preview's file path into a URL, ported from Hub.GuidePreview."""
    path = guide.preview(entity_id, alias_index)
    if not audio_base_url:
        return "file:///" + path.replace("\\", "/")
    return audio_base_url + urllib.parse.quote(Path(path).name, safe="")
