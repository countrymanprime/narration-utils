import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ENGINE_PATH = Path(__file__).resolve().parents[1] / "core" / "moonshine_engine.py"
SPEC = importlib.util.spec_from_file_location("moonshine_engine", ENGINE_PATH)
moonshine_engine = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(moonshine_engine)

CATALOG_PATH = Path(__file__).resolve().parents[3] / "config" / "moonshine-assets.json"
CATALOG = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


# Every FakeTranscriber constructed by the current test (the fake_moonshine fixture empties it).
CREATED = []


class FakeTranscriber:
    """Records how moonshine_voice.Transcriber was constructed and configured."""

    def __init__(self, model_path, arch, update_interval, options):
        self.model_path, self.arch, self.update_interval, self.options = model_path, arch, update_interval, options
        self.keyterms = None
        self.context = None
        CREATED.append(self)

    def set_keyterms(self, terms):
        self.keyterms = terms

    def set_context(self, context):
        self.context = context


@pytest.fixture
def fake_moonshine(monkeypatch):
    """Stand in for the moonshine_voice package (Windows only, and a real load needs model files): the tests below are about
    which directory is loaded and whether the library's own downloader is ever reached, not about Moonshine itself."""
    CREATED.clear()
    downloads = []

    def get_model_for_language(language, arch, include_word_timestamps=False):
        downloads.append((language, arch, include_word_timestamps))
        return "downloaded-dir", arch

    monkeypatch.setitem(
        sys.modules, "moonshine_voice", SimpleNamespace(ModelArch=SimpleNamespace(TINY_STREAMING=1, SMALL_STREAMING=2), Transcriber=FakeTranscriber)
    )
    monkeypatch.setitem(sys.modules, "moonshine_voice.download", SimpleNamespace(get_model_for_language=get_model_for_language))
    return downloads


def _model_dir(tmp_path, names=None):
    directory = tmp_path / "moonshine" / "small"
    directory.mkdir(parents=True)
    for name in moonshine_engine.MODEL_FILES if names is None else names:
        (directory / name).write_bytes(b"x")
    return directory


def test_model_files_are_exactly_the_files_every_catalog_model_installs():
    """The sidecar's presence check and config/moonshine-assets.json must name the same files, or a verified install could be
    refused (a name only here) or load without a file the catalog pins (a name only there)."""
    for model in CATALOG["models"]:
        assert sorted(file["name"] for file in model["files"]) == sorted(moonshine_engine.MODEL_FILES), model["id"]


def test_the_word_timestamp_decoder_is_one_of_the_required_files():
    assert moonshine_engine.WORD_TIMESTAMP_FILE in moonshine_engine.MODEL_FILES


def test_a_complete_model_directory_has_nothing_missing(tmp_path):
    assert moonshine_engine.missing_model_files(_model_dir(tmp_path)) == []


def test_a_directory_without_the_word_timestamp_decoder_reports_it_missing(tmp_path):
    names = [name for name in moonshine_engine.MODEL_FILES if name != moonshine_engine.WORD_TIMESTAMP_FILE]

    assert moonshine_engine.missing_model_files(_model_dir(tmp_path, names)) == [moonshine_engine.WORD_TIMESTAMP_FILE]


def test_a_directory_that_does_not_exist_is_missing_every_file(tmp_path):
    assert moonshine_engine.missing_model_files(tmp_path / "absent") == list(moonshine_engine.MODEL_FILES)


def test_a_subdirectory_named_like_a_model_file_does_not_count_as_the_file(tmp_path):
    directory = _model_dir(tmp_path, [name for name in moonshine_engine.MODEL_FILES if name != "encoder.ort"])
    (directory / "encoder.ort").mkdir()

    assert moonshine_engine.missing_model_files(directory) == ["encoder.ort"]


def test_a_model_directory_is_loaded_as_is_with_word_timestamps_and_never_downloads(tmp_path, fake_moonshine):
    directory = _model_dir(tmp_path)

    transcriber = moonshine_engine.load_transcriber("SMALL_STREAMING", str(directory), 0.5, "Ishmael, Queequeg", "Call me Ishmael.", frozen=True)

    assert fake_moonshine == []
    assert (transcriber.model_path, transcriber.arch, transcriber.update_interval, transcriber.options) == (
        str(directory),
        2,
        0.5,
        {"word_timestamps": "true"},
    )
    assert transcriber.keyterms == ["Ishmael", "Queequeg"]
    assert transcriber.context == "Call me Ishmael."


def test_blank_key_terms_are_dropped_and_no_context_is_set_without_one(tmp_path, fake_moonshine):
    transcriber = moonshine_engine.load_transcriber("TINY_STREAMING", str(_model_dir(tmp_path)), 0.5, " , ,", None)

    assert transcriber.keyterms is None
    assert transcriber.context is None


def test_a_model_directory_missing_the_word_timestamp_decoder_is_refused_before_loading(tmp_path, fake_moonshine):
    names = [name for name in moonshine_engine.MODEL_FILES if name != moonshine_engine.WORD_TIMESTAMP_FILE]

    with pytest.raises(SystemExit) as refused:
        moonshine_engine.load_transcriber("SMALL_STREAMING", str(_model_dir(tmp_path, names)), 0.5, None, None, frozen=True)

    assert moonshine_engine.WORD_TIMESTAMP_FILE in str(refused.value)
    assert CREATED == []
    assert fake_moonshine == []


def test_the_frozen_sidecar_refuses_to_run_moonshine_without_a_model_directory(fake_moonshine):
    """The shipped program only ever loads a catalog install the host verified: it must never fall back to the library's own
    downloader (Moonshine's servers, a CRC32C check, a cache outside the app's asset directory)."""
    with pytest.raises(SystemExit) as refused:
        moonshine_engine.load_transcriber("SMALL_STREAMING", None, 0.5, None, None, frozen=True)

    assert "--model-dir" in str(refused.value)
    assert fake_moonshine == []
    assert CREATED == []


def test_the_developer_cli_without_a_model_directory_still_uses_the_library_downloader(fake_moonshine):
    transcriber = moonshine_engine.load_transcriber("TINY_STREAMING", None, 0.5, None, None, frozen=False)

    assert fake_moonshine == [("en", 1, True)]
    assert transcriber.model_path == "downloaded-dir"


def test_frozen_defaults_to_whether_this_is_a_pyinstaller_build(monkeypatch, fake_moonshine):
    monkeypatch.setattr(sys, "frozen", True, raising=False)

    with pytest.raises(SystemExit):
        moonshine_engine.load_transcriber("TINY_STREAMING", None, 0.5, None, None)

    assert fake_moonshine == []


def test_a_missing_moonshine_package_explains_itself(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "moonshine_voice", None)

    with pytest.raises(SystemExit) as refused:
        moonshine_engine.load_transcriber("TINY_STREAMING", str(_model_dir(tmp_path)), 0.5, None, None)

    assert "moonshine-voice" in str(refused.value)


def _real_moonshine():
    try:
        from moonshine_voice import ModelArch
        from moonshine_voice.download import _stt_dependency_manifest
    except (ImportError, OSError):
        return None
    return ModelArch, _stt_dependency_manifest


@pytest.mark.skipif(_real_moonshine() is None, reason="moonshine-voice is a Windows-only dependency (pyproject.toml)")
def test_the_pinned_library_expects_exactly_the_catalogs_files_urls_and_sizes():
    """The pinned moonshine-voice wheel carries its own (offline, native) download manifest. It must describe byte for byte the
    files config/moonshine-assets.json pins, so a pre-placed catalog install is what the library would have fetched itself. A
    library upgrade that changes the model layout or version fails here instead of at a narrator's first session. The manifest
    function is private to the library; if an upgrade renames it, re-check the layout by hand and update this test."""
    model_arch, manifest = _real_moonshine()
    for model in CATALOG["models"]:
        arch = getattr(model_arch, f"{model['id'].upper()}_STREAMING")
        groups = manifest("en", arch, include_word_timestamps=True)["groups"]
        expected = {(file["name"], file["url"], file["size"]) for file in model["files"]}

        assert len(groups) == 1, model["id"]
        base_url = groups[0]["base_url"]
        pinned = {(file["name"], file.get("url") or f"{base_url}/{file['name']}", file["size"]) for file in groups[0]["files"]}

        assert pinned == expected, model["id"]
        assert base_url == model["provenanceUrl"], model["id"]


def test_live_asr_hands_the_model_directory_and_architecture_to_this_module(monkeypatch):
    """live_asr.py's --engine moonshine path loads through load_transcriber (a local import, faked here the way test_live_asr.py
    fakes `devices`), passing --model-dir through untouched and --model as its ModelArch name."""
    live_asr = _live_asr()
    calls = []

    def load_transcriber(*args):
        calls.append(args)
        return SimpleNamespace(close=lambda: None)

    monkeypatch.setitem(sys.modules, "moonshine_engine", SimpleNamespace(load_transcriber=load_transcriber))
    args = live_asr.build_parser().parse_args(["--engine", "moonshine", "--model", "tiny", "--model-dir", "D:/assets/moonshine/tiny", "--wav", "r.wav"])
    args.context_text = "Call me Ishmael."

    live_asr._load_moonshine_engine(args)

    assert calls == [("TINY_STREAMING", "D:/assets/moonshine/tiny", live_asr.DECODE_INTERVAL_SECONDS, None, "Call me Ishmael.")]


# --check-moonshine is how the packaged app's smoke test (apps/desktop/smoke.go) proves the frozen sidecar carries a working
# Moonshine: PyInstaller cannot see the ctypes load of moonshine.dll, so a freeze that lost it would still start with --help.
def _fake_package(languages=("en",), transcriber=True):
    def supported_languages():
        if isinstance(languages, Exception):
            raise languages
        return list(languages)

    package = SimpleNamespace(__version__="0.1.5", supported_languages=supported_languages)
    if transcriber:
        package.Transcriber = FakeTranscriber
    return package


def test_the_self_check_passes_when_the_native_library_loads_and_knows_english(monkeypatch):
    monkeypatch.setitem(sys.modules, "moonshine_voice", _fake_package())

    report = moonshine_engine.self_check()

    assert report["type"] == "engine_check"
    assert report["engine"] == "moonshine"
    assert report["ok"] is True
    assert "0.1.5" in report["detail"]


def test_the_self_check_fails_when_the_package_is_missing(monkeypatch):
    monkeypatch.setitem(sys.modules, "moonshine_voice", None)

    report = moonshine_engine.self_check()

    assert report["ok"] is False
    assert "moonshine-voice" in report["detail"]


def test_the_self_check_fails_with_the_reason_when_the_native_library_cannot_load(monkeypatch):
    monkeypatch.setitem(sys.modules, "moonshine_voice", _fake_package(languages=OSError("Failed to load Moonshine library from moonshine.dll")))

    report = moonshine_engine.self_check()

    assert report["ok"] is False
    assert "moonshine.dll" in report["detail"]


def test_the_self_check_fails_when_the_transcriber_module_was_not_frozen(monkeypatch):
    monkeypatch.setitem(sys.modules, "moonshine_voice", _fake_package(transcriber=False))

    assert moonshine_engine.self_check()["ok"] is False


def test_the_self_check_fails_when_the_library_does_not_offer_english(monkeypatch):
    monkeypatch.setitem(sys.modules, "moonshine_voice", _fake_package(languages=("es",)))

    report = moonshine_engine.self_check()

    assert report["ok"] is False
    assert "English" in report["detail"]


@pytest.mark.skipif(_real_moonshine() is None, reason="moonshine-voice is a Windows-only dependency (pyproject.toml)")
def test_the_self_check_passes_against_the_real_pinned_library():
    report = moonshine_engine.self_check()

    assert report["ok"] is True, report


def _live_asr():
    """A fresh copy of live_asr.py (its moonshine path imports this module by name, which the tests fake in sys.modules)."""
    spec = importlib.util.spec_from_file_location("live_asr_for_moonshine", ENGINE_PATH.parent / "live_asr.py")
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(("ok", "code"), [(True, None), (False, 1)])
def test_check_moonshine_prints_one_json_line_and_exits_by_the_verdict_without_wav_or_mic(monkeypatch, capsys, ok, code):
    live_asr = _live_asr()
    report = {"type": "engine_check", "engine": "moonshine", "ok": ok, "detail": "d"}
    monkeypatch.setitem(sys.modules, "moonshine_engine", SimpleNamespace(self_check=lambda: report))
    monkeypatch.setattr(sys, "argv", ["live_asr.py", "--check-moonshine"])

    if code is None:
        live_asr.main()
    else:
        with pytest.raises(SystemExit) as exited:
            live_asr.main()
        assert exited.value.code == code

    lines = capsys.readouterr().out.strip().splitlines()
    assert [json.loads(line) for line in lines] == [report]
