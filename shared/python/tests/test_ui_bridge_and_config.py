import os
import sys
import tempfile
import unittest
from pathlib import Path


PYTHON_ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(PYTHON_ROOT))

from narration_common import config  # noqa: E402
from narration_common.ui_bridge import BridgeClient, BridgeCommand, decode_fields  # noqa: E402


class UiBridgeTests(unittest.TestCase):
    def test_command_round_trip_preserves_delimiters_and_unicode(self):
        original = BridgeCommand("runtime_setting", ("TranscriptCompare", "compare_script", r"C:\tools\a|b.py ✓"))
        self.assertEqual(original, BridgeCommand.parse(original.serialize()))

    def test_bridge_writes_ordered_immutable_command_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            bridge = BridgeClient(temporary)
            first = bridge.send("first", "a")
            second = bridge.send("second", "b")
            self.assertEqual("00000000.cmd", first.name)
            self.assertEqual("00000001.cmd", second.name)
            self.assertEqual("first", BridgeCommand.parse(first.read_text(encoding="utf-8")).action)

    def test_bridge_tails_new_adapter_events_once(self):
        with tempfile.TemporaryDirectory() as temporary:
            bridge = BridgeClient(temporary)
            events = Path(temporary) / "events.log"
            events.write_text("COMPARE_PREPARED|run%7C1|C%3A%5Cmanifest.txt\n", encoding="utf-8")
            self.assertEqual(["COMPARE_PREPARED|run%7C1|C%3A%5Cmanifest.txt"], bridge.read_events())
            self.assertEqual(["COMPARE_PREPARED", "run|1", r"C:\manifest.txt"], decode_fields("COMPARE_PREPARED|run%7C1|C%3A%5Cmanifest.txt"))
            self.assertEqual([], bridge.read_events())


class ScopedConfigTests(unittest.TestCase):
    def test_scope_save_is_grouped_and_none_clears_project_override(self):
        previous = os.environ.get("APPDATA")
        try:
            with tempfile.TemporaryDirectory() as temporary:
                os.environ["APPDATA"] = temporary
                project = Path(temporary) / "project"
                config.save_scope_settings("TranscriptCompare", {"model_size": "medium", "color_extra": "112233"})
                config.save_scope_settings("TranscriptCompare", {"model_size": "large-v3", "color_extra": "AABBCC"}, str(project))
                config.save_scope_settings("TranscriptCompare", {"model_size": None}, str(project))
                model, source = config.get("TranscriptCompare", "model_size", str(project), "small")
                color, color_source = config.get("TranscriptCompare", "color_extra", str(project), "")
                self.assertEqual(("medium", "global"), (model, source))
                self.assertEqual(("AABBCC", "project"), (color, color_source))
        finally:
            if previous is None:
                os.environ.pop("APPDATA", None)
            else:
                os.environ["APPDATA"] = previous


if __name__ == "__main__":
    unittest.main()
