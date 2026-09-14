"""Ported from shared/hub.Tests/GuideEntitiesTests.cs."""

import json

import pytest

from shared.server.hub_state import HubError, HubState


@pytest.fixture
def isolated_appdata(tmp_path, monkeypatch):
    appdata = tmp_path / "appdata"
    appdata.mkdir()
    monkeypatch.setenv("APPDATA", str(appdata))
    return appdata


def new_hub(tmp_path, project, audio_base_url=""):
    return HubState(session_dir=str(tmp_path / "session"), project_folder=str(project), audio_base_url=audio_base_url)


def test_entities_are_empty_with_no_project_or_guide_file(tmp_path, isolated_appdata):
    project = tmp_path / "project"
    project.mkdir()
    hub = new_hub(tmp_path, project)
    assert hub.guide_entities() == []


def test_entities_return_guide_json_verbatim_including_array_fields(tmp_path, isolated_appdata):
    project = tmp_path / "project"
    data_dir = project / "ManuscriptGuide"
    data_dir.mkdir(parents=True)
    (data_dir / "manuscript_guide.json").write_text(json.dumps({
        "schema_version": 1,
        "entities": [{
            "id": "entity-1", "canonical_name": "Aurelian", "aliases": ["Cap"], "category": "Character",
            "occurrences": [{"chapter": "1", "paragraph": 3, "excerpt": "..."}], "occurrence_count": 1,
            "pronunciation": {"ipa": "", "source": "not generated", "confidence": "unknown"},
            "description": {"text": "", "evidence": {}}, "personality_notes": [],
            "relationships": [{"id": "entity-2", "name": "Nico", "label": "mentor of"}],
            "locked": True, "review_state": "reviewed",
        }],
    }), encoding="utf-8")

    hub = new_hub(tmp_path, project)
    entities = hub.guide_entities()
    assert len(entities) == 1
    entity = entities[0]
    assert entity["canonical_name"] == "Aurelian"
    assert entity["aliases"][0] == "Cap"
    assert entity["locked"] is True
    assert entity["relationships"][0]["label"] == "mentor of"


def test_proofing_suggestions_come_from_the_guide_manifest_and_exclude_accepted_hints(tmp_path, isolated_appdata):
    project = tmp_path / "project"
    data_dir = project / "ManuscriptGuide"
    data_dir.mkdir(parents=True)
    (data_dir / "manuscript_guide.json").write_text(json.dumps({
        "schema_version": 2,
        "vocabulary_candidates": ["Alice", "White Rabbit", "Alice"],
    }), encoding="utf-8")

    hub = new_hub(tmp_path, project)
    assert hub.transcript_suggest_hints() == "Alice, White Rabbit"

    hub.transcript_save_hints(["alice"])
    assert hub.transcript_suggest_hints() == "White Rabbit"


def test_guide_preview_fails_without_piper_configured(tmp_path, isolated_appdata):
    # No Piper configured (isolated APPDATA), so GuideService.preview() raises
    # before touching Python - enough to prove guide_preview doesn't
    # swallow/rewrite that failure.
    project = tmp_path / "project"
    project.mkdir()
    hub = new_hub(tmp_path, project)
    with pytest.raises(HubError, match="Piper"):
        hub.guide_preview("entity-1")
