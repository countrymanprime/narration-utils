"""Ported from shared/hub.Tests/SettingsForScopeTests.cs and TranscriptHintsTests.cs."""

from pathlib import Path
import time

import pytest

from shared.server.hub_state import HubError, HubState
from narration_common import manuscript as canonical


@pytest.fixture
def isolated_appdata(tmp_path, monkeypatch):
    appdata = tmp_path / "appdata"
    appdata.mkdir()
    monkeypatch.setenv("APPDATA", str(appdata))
    return appdata


@pytest.fixture
def hub(tmp_path, isolated_appdata):
    project = tmp_path / "project"
    project.mkdir()
    session = tmp_path / "session"
    return HubState(session_dir=str(session), project_folder=str(project))


def test_global_and_project_scopes_report_distinct_raw_values_not_the_merged_one(hub):
    hub.save_settings("TranscriptCompare", "global", {"model_size": "medium"})
    hub.save_settings("TranscriptCompare", "project", {"model_size": "large-v3"})

    global_fields = hub.settings_for_scope("global")["TranscriptCompare"]
    project_fields = hub.settings_for_scope("project")["TranscriptCompare"]
    global_field = next(f for f in global_fields if f["key"] == "model_size")
    project_field = next(f for f in project_fields if f["key"] == "model_size")

    assert global_field["value"] == "medium"
    assert global_field["isSet"] is True
    assert project_field["value"] == "large-v3"
    assert project_field["isSet"] is True
    # The merged/effective value is the same from either tab - the project
    # override wins regardless of which scope you're currently viewing.
    assert project_field["effectiveValue"] == "large-v3"
    assert global_field["effectiveValue"] == "large-v3"


def test_project_field_with_no_override_reports_unset_with_global_as_effective_fallback(hub):
    hub.save_settings("TranscriptCompare", "global", {"color_extra": "112233"})

    project_fields = hub.settings_for_scope("project")["TranscriptCompare"]
    field = next(f for f in project_fields if f["key"] == "color_extra")

    assert field["isSet"] is False
    assert field["value"] == ""
    assert field["effectiveValue"] == "112233"
    assert field["effectiveSource"] == "global"


def test_piper_executable_field_no_longer_exists_in_the_schema(hub):
    fields = hub.settings_for_scope("global")["ManuscriptGuide"]
    assert not any(f["key"] == "piper_exe" for f in fields)
    assert any(f["key"] == "piper_model" for f in fields)


def test_general_category_exposes_log_verbosity_without_obsolete_reader_width(hub):
    fields = hub.settings_for_scope("global")["General"]
    verbosity = next(f for f in fields if f["key"] == "log_verbosity")
    assert verbosity["effectiveValue"] == "normal"
    assert not any(f["key"] == "default_reader_width" for f in fields)


def test_hints_are_empty_until_saved_then_round_trip_sorted_and_deduplicated(hub):
    assert hub.transcript_hints() == []

    hub.transcript_save_hints(["Voltage Corps", "aurelian", "Aurelian", "  Meridian  "])

    assert hub.transcript_hints() == ["aurelian", "Meridian", "Voltage Corps"]


def test_saving_hints_without_a_project_folder_throws(tmp_path, isolated_appdata):
    hub_no_project = HubState(session_dir=str(tmp_path / "session2"), project_folder="")
    with pytest.raises(HubError):
        hub_no_project.transcript_save_hints(["x"])


def test_import_commits_project_owned_json_and_replacement_resets_derivatives(hub, tmp_path):
    source = tmp_path / "source.md"
    source.write_text("# Chapter One\n\nText for narration.", encoding="utf-8")
    hub.show_open_manuscript_dialog = lambda: str(source)

    selected = hub.select_manuscript()
    job_id = selected["jobId"]
    deadline = time.monotonic() + 3
    while hub.manuscript_import_state(job_id)["phase"] == "preparing" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert hub.manuscript_import_state(job_id)["preview"]["format"] == "markdown"
    hub.manuscript_import_commit(job_id)
    while hub.manuscript_import_state(job_id)["phase"] == "committing" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert hub.manuscript_import_state(job_id)["result"]["format"] == "markdown"
    assert canonical.exists(hub.project_folder)

    project = Path(hub.project_folder)
    (project / "ManuscriptGuide").mkdir()
    (project / "ManuscriptGuide" / "manuscript_guide.json").write_text("{}", encoding="utf-8")
    selected = hub.select_manuscript()
    replacement_job = selected["jobId"]
    while hub.manuscript_import_state(replacement_job)["phase"] == "preparing" and time.monotonic() < deadline:
        time.sleep(0.01)
    with pytest.raises(HubError, match="Confirm replacement"):
        hub.manuscript_import_commit(replacement_job)
    hub.manuscript_import_commit(replacement_job, confirmed_reset=True)
    while hub.manuscript_import_state(replacement_job)["phase"] == "committing" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert not (project / "ManuscriptGuide").exists()
    assert len(list((project / "narration-utils" / "manuscript" / "sources").iterdir())) == 2


def test_clear_project_data_resets_imported_manuscript(hub, tmp_path):
    source = tmp_path / "source.md"
    source.write_text("# Chapter One\n\nText for narration.", encoding="utf-8")
    hub.show_open_manuscript_dialog = lambda: str(source)
    job_id = hub.select_manuscript()["jobId"]
    deadline = time.monotonic() + 3
    while hub.manuscript_import_state(job_id)["phase"] == "preparing" and time.monotonic() < deadline:
        time.sleep(0.01)
    hub.manuscript_import_commit(job_id)
    while hub.manuscript_import_state(job_id)["phase"] == "committing" and time.monotonic() < deadline:
        time.sleep(0.01)

    project = Path(hub.project_folder)
    (project / "ManuscriptGuide").mkdir()
    (project / "TranscriptCompare").mkdir()
    (project / "narration-utils" / "manuscript-notes.json").write_text("{}", encoding="utf-8")
    with pytest.raises(HubError, match="Confirm"):
        hub.clear_project_data()
    hub.clear_project_data(confirmed=True)
    assert not canonical.exists(project)
    assert not canonical.manuscript_dir(project).exists()
    assert not (project / "ManuscriptGuide").exists()
    assert not (project / "TranscriptCompare").exists()
    assert not (project / "narration-utils" / "manuscript-notes.json").exists()


def test_import_reuses_preview_draft_and_rejects_changed_source(hub, tmp_path, monkeypatch):
    source = tmp_path / "source.md"
    source.write_text("# Chapter One\n\nOriginal text.", encoding="utf-8")
    calls = 0
    original_prepare = canonical.prepare_import

    def counted_prepare(*args, **kwargs):
        nonlocal calls
        calls += 1
        return original_prepare(*args, **kwargs)

    monkeypatch.setattr(canonical, "prepare_import", counted_prepare)
    hub.show_open_manuscript_dialog = lambda: str(source)
    job_id = hub.select_manuscript()["jobId"]
    deadline = time.monotonic() + 3
    while hub.manuscript_import_state(job_id)["phase"] == "preparing" and time.monotonic() < deadline:
        time.sleep(0.01)
    hub.manuscript_import_commit(job_id)
    while hub.manuscript_import_state(job_id)["phase"] == "committing" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert calls == 1

    changed_job = hub.select_manuscript()["jobId"]
    while hub.manuscript_import_state(changed_job)["phase"] == "preparing" and time.monotonic() < deadline:
        time.sleep(0.01)
    source.write_text("# Chapter One\n\nChanged text after preview.", encoding="utf-8")
    hub.manuscript_import_commit(changed_job, confirmed_reset=True)
    while hub.manuscript_import_state(changed_job)["phase"] == "committing" and time.monotonic() < deadline:
        time.sleep(0.01)
    assert hub.manuscript_import_state(changed_job)["phase"] == "error"
    assert "changed after preview" in hub.manuscript_import_state(changed_job)["error"]
