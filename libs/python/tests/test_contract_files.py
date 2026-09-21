from pathlib import Path

import pytest
from narration_common import contract_files


def test_check_passes_when_the_committed_file_matches(tmp_path):
    (tmp_path / "sample.json").write_text('{\n  "a": 1,\n  "b": [\n    "é"\n  ]\n}\n', encoding="utf-8")

    contract_files.check("sample", {"b": ["é"], "a": 1}, tmp_path)


def test_check_fails_when_the_payload_drifts(tmp_path):
    (tmp_path / "sample.json").write_text('{\n  "a": 1\n}\n', encoding="utf-8")

    with pytest.raises(AssertionError, match="no longer matches"):
        contract_files.check("sample", {"a": 2}, tmp_path)


def test_check_fails_for_a_file_that_was_never_committed(tmp_path):
    with pytest.raises(AssertionError, match="no committed contract file"):
        contract_files.check("missing", {}, tmp_path)


def test_update_mode_writes_the_file_with_sorted_keys_and_unix_newlines(tmp_path, monkeypatch):
    monkeypatch.setenv(contract_files.UPDATE_ENV, "1")

    contract_files.check("fresh", {"z": True, "a": None}, tmp_path / "sub")

    assert (tmp_path / "sub" / "fresh.json").read_bytes() == b'{\n  "a": null,\n  "z": true\n}\n'


def test_the_shared_folder_is_found_from_the_library():
    assert contract_files.contracts_dir().as_posix().endswith("tests/fixtures/contracts")


def test_the_shared_folder_search_fails_when_no_workspace_file_is_above(tmp_path, monkeypatch):
    # The isolated pytest temp folder of the gate sits inside the repository, so "outside" is simulated.
    monkeypatch.setattr(Path, "is_file", lambda self: False)

    with pytest.raises(FileNotFoundError):
        contract_files.contracts_dir(tmp_path / "nowhere")
