"""prepare-resources.py freezes the three sidecars at once, without letting them share PyInstaller state."""

from __future__ import annotations

import importlib.util
import io
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "prepare-resources.py"
SIDECARS = {"manuscript-guide", "transcript-compare", "manuscript-teleprompter"}


def load_script():
    spec = importlib.util.spec_from_file_location("prepare_resources", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakePyInstaller:
    """Stands in for `python -m PyInstaller` (a `subprocess.Popen`): records each call and writes the output the script looks for."""

    def __init__(self, *, rendezvous: bool = False, fail: tuple[str, ...] = (), output: str | None = None) -> None:
        self.calls: list[dict[str, object]] = []
        self._lock = threading.Lock()
        self._fail = fail
        self._output = output
        # All sidecars must be inside PyInstaller at the same moment, or the barrier times out.
        self._barrier = threading.Barrier(len(SIDECARS), timeout=10) if rendezvous else None

    def __call__(self, args, **kwargs):
        name = args[args.index("--name") + 1]
        env = kwargs.get("env") or {}
        with self._lock:
            self.calls.append({"name": name, "env": env, "args": list(args)})
        if self._barrier:
            self._barrier.wait()
        failed = name in self._fail
        if not failed:
            exe = Path(args[args.index("--distpath") + 1]) / name / (f"{name}.exe" if sys.platform == "win32" else name)
            exe.parent.mkdir(parents=True, exist_ok=True)
            exe.write_text("frozen")
        text = self._output if self._output is not None else (f"boom in {name}\n" if failed else f"built {name}\n")
        return FakeProcess(text, 1 if failed else 0)


class FakeProcess:
    def __init__(self, output: str, returncode: int) -> None:
        self.stdout = io.StringIO(output)
        self.returncode = returncode

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


@pytest.fixture
def script(tmp_path, monkeypatch):
    module = load_script()
    (tmp_path / module.CONFIG_DIR).mkdir(parents=True)
    (tmp_path / module.REAPER_DIR).mkdir(parents=True)
    resources = tmp_path / module.RESOURCES_DIR
    monkeypatch.setattr(module, "ROOT", tmp_path)
    monkeypatch.setattr(module, "RESOURCES", resources)
    monkeypatch.setattr(module, "RUNTIME", resources / "runtime")
    monkeypatch.setattr(module, "REAPER", resources / "reaper")
    monkeypatch.setattr(sys, "argv", ["prepare-resources.py", "--clean"])
    return module


def install(monkeypatch, module, fake: FakePyInstaller) -> None:
    monkeypatch.setattr(module.subprocess, "Popen", fake)


def test_freezes_all_three_sidecars_into_the_runtime_directory(script, monkeypatch):
    fake = FakePyInstaller()
    install(monkeypatch, script, fake)

    script.main()

    assert {call["name"] for call in fake.calls} == SIDECARS
    assert {path.name for path in script.RUNTIME.iterdir()} == SIDECARS


def test_freezes_run_at_the_same_time(script, monkeypatch):
    fake = FakePyInstaller(rendezvous=True)
    install(monkeypatch, script, fake)

    script.main()  # a sequential run would sit at the barrier until it times out and fails

    assert len(fake.calls) == len(SIDECARS)


def test_each_freeze_gets_its_own_pyinstaller_config_dir(script, monkeypatch):
    fake = FakePyInstaller()
    install(monkeypatch, script, fake)

    script.main()

    config_dirs = [call["env"].get("PYINSTALLER_CONFIG_DIR") for call in fake.calls]
    assert None not in config_dirs, "PYINSTALLER_CONFIG_DIR must be set so concurrent `--clean` runs cannot wipe each other's cache"
    assert len(set(config_dirs)) == len(SIDECARS)


def test_each_freeze_keeps_the_parent_environment_and_writes_utf8(script, monkeypatch):
    fake = FakePyInstaller()
    install(monkeypatch, script, fake)

    script.main()

    for call in fake.calls:
        assert call["env"].get("PATH") == os.environ.get("PATH"), "PyInstaller needs the inherited environment (PATH, SYSTEMROOT on Windows)"
        assert call["env"].get("PYTHONIOENCODING") == "utf-8", "the parent decodes the pipe as UTF-8, so the child must write UTF-8"


def test_output_is_streamed_line_by_line_with_the_sidecar_name(script, monkeypatch, capsys):
    fake = FakePyInstaller(output="first line\nsecond line\n")
    install(monkeypatch, script, fake)

    script.main()

    lines = capsys.readouterr().out.splitlines()
    for name in SIDECARS:
        assert f"[{name}] first line" in lines
        assert f"[{name}] second line" in lines


def test_every_failed_freeze_is_reported_and_the_build_fails(script, monkeypatch, capsys):
    fake = FakePyInstaller(fail=("transcript-compare", "manuscript-guide"))
    install(monkeypatch, script, fake)

    with pytest.raises(subprocess.CalledProcessError):
        script.main()

    out = capsys.readouterr().out
    assert "[transcript-compare] boom in transcript-compare" in out
    assert "[manuscript-guide] boom in manuscript-guide" in out
    summary = next(line for line in out.splitlines() if line.startswith("Freeze failed"))
    assert "transcript-compare" in summary
    assert "manuscript-guide" in summary
    assert "manuscript-teleprompter" not in summary


def test_output_the_console_cannot_encode_does_not_crash_the_build(script, monkeypatch):
    fake = FakePyInstaller(output="café � ✓\n")
    install(monkeypatch, script, fake)
    console = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")  # the Windows console encoding
    monkeypatch.setattr(sys, "stdout", console)

    script.main()

    assert len(fake.calls) == len(SIDECARS)


def flag_values(call, flag: str) -> list[str]:
    args = call["args"]
    return [args[index + 1] for index, value in enumerate(args) if value == flag]


def test_the_guide_freeze_carries_piper_data_and_the_cmu_dictionary(script, monkeypatch):
    # Piper needs piper/espeak-ng-data to speak (about 19 MB), and cmudict needs its data and its package metadata: PyInstaller has
    # no hook for either, and the frozen guide logged "CMU pronunciation unavailable (No package metadata was found for cmudict)"
    # (release-readiness phase 4 spike). The packaged smoke test proves it end to end.
    fake = FakePyInstaller()
    install(monkeypatch, script, fake)

    script.main()

    guide = next(call for call in fake.calls if call["name"] == "manuscript-guide")
    assert {"piper", "cmudict"} <= set(flag_values(guide, "--collect-data"))
    assert "cmudict" in flag_values(guide, "--copy-metadata")
    for other in (call for call in fake.calls if call["name"] != "manuscript-guide"):
        assert "piper" not in flag_values(other, "--collect-data"), "only the guide speaks; the others must not grow by 19 MB"


def test_sidecar_flag_freezes_only_that_sidecar(script, monkeypatch):
    fake = FakePyInstaller()
    install(monkeypatch, script, fake)
    monkeypatch.setattr(sys, "argv", ["prepare-resources.py", "--sidecar", "manuscript-guide"])

    script.main()

    assert [call["name"] for call in fake.calls] == ["manuscript-guide"]


def test_the_reaper_package_ships_the_scripts_and_not_the_harness_or_the_spikes(script, monkeypatch):
    install(monkeypatch, script, FakePyInstaller())
    source = script.ROOT / script.REAPER_DIR
    (source / "NarrationUtils_Launcher.lua").write_text("-- launcher", encoding="utf-8")
    (source / "project.json").write_text("{}", encoding="utf-8")
    (source / "tests").mkdir()
    (source / "tests" / "protocol_test.lua").write_text("-- test", encoding="utf-8")
    (source / "tests" / "__pycache__").mkdir()
    (source / "spikes").mkdir()
    (source / "spikes" / "run-reaper.ps1").write_text("# spike driver", encoding="utf-8")

    script.main()

    assert {path.name for path in script.REAPER.iterdir()} == {"NarrationUtils_Launcher.lua"}
