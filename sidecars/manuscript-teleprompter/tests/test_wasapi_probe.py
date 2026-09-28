"""The WASAPI spike probe (native-recording-suite P1) runs end to end on a host with no audio device: its report says so,
and its synthetic and throughput takes are measured and checked. The Windows numbers come from CI (docs/research)."""

import importlib.util
import sys
from pathlib import Path

PROBE_PATH = Path(__file__).resolve().parents[1] / "spikes" / "wasapi_probe.py"
SPEC = importlib.util.spec_from_file_location("wasapi_probe", PROBE_PATH)
probe = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(probe)

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_capture_wasapi import FakeSounddevice, _device


def test_the_probe_reports_a_short_run_with_bit_exact_synthetic_takes(tmp_path, capsys):
    report = probe.main(["--seconds", "0.2", "--throughput-seconds", "2", "--device-seconds", "0.1", "--out", str(tmp_path)])

    assert report["type"] == "wasapi_probe" and "platform" in report["environment"]
    for take in (report["synthetic"]["mono48k"], report["synthetic"]["stereo48k"], report["throughput"]):
        assert take["error"] is None and take["droppedBlocks"] == 0 and take["overflows"] == 0
        assert take["file"]["bitExact"] and take["file"]["framesMatch"] and take["file"]["sizesConsistent"]
    assert report["synthetic"]["stereo48k"]["channels"] == 2
    assert report["throughput"]["realtimeFactor"] > 1
    assert (tmp_path / "report.json").exists() and not (tmp_path / "synthetic-throughput.wav").exists()
    assert '"wasapi_probe"' in capsys.readouterr().out


def test_the_probe_records_every_listed_endpoint_and_reports_a_failed_one(tmp_path):
    sd = FakeSounddevice([_device("Mic A"), _device("Mic B")], blocks=20)
    backend = probe.capture_wasapi.WasapiBackend(load=lambda: sd)

    runs = probe.device(tmp_path, 5.0, 2, backend)
    assert [run["device"] for run in runs] == ["Mic A", "Mic B"]
    assert all(run["frames"] == 9600 and run["file"]["framesMatch"] for run in runs)
    assert all(run["error"].endswith("stopped delivering audio") for run in runs)  # the fake ends after 20 blocks

    sd.refuse_open = True
    (tmp_path / "again").mkdir()
    [refused] = probe.device(tmp_path / "again", 1.0, 1, backend)
    assert refused == {"device": "Mic A", "error": "OSError: Error opening InputStream: Device unavailable [PaErrorCode -9985]"}


def test_the_environment_lists_host_apis_and_wasapi_inputs():
    sd = FakeSounddevice([_device("Mic A", rate=44100.0)])
    report = probe.environment(load=lambda: sd)
    assert report["hostApis"] == ["MME", "Windows WASAPI"]
    assert report["wasapiInputs"] == [{"name": "Mic A", "sampleRate": 44100, "channels": 2, "lowLatencyMs": 3.0}]
    assert report["listingError"] is None


def test_the_environment_says_when_sounddevice_is_missing():
    def missing():
        raise ImportError("No module named 'sounddevice'")

    assert probe.environment(load=missing)["sounddevice"] == "unavailable: No module named 'sounddevice'"
