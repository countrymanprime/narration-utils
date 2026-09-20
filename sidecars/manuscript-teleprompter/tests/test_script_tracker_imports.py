"""Architecture rule for ADR 0021 point 3: the script tracker is engine-independent.

`script_tracker.py` consumes the events any live engine emits and knows nothing about an engine, a
model, audio or the rest of the sidecar, so it imports the standard library and nothing else. A
`live_asr` (or numpy, or faster_whisper) import would make the tracker depend on an engine and
break the swap-an-engine-with-one-adapter promise. This is checked by reading the source, not by
importing it, so the rule also holds where the optional engine packages are not installed.

It sees `import` statements (also inside functions and under `if TYPE_CHECKING:`, which counts, on
purpose) and direct calls to `__import__` and `importlib.import_module`. It cannot see a module
name built at run time and passed some other way: that is a limit of reading source, not a promise.
"""

import ast
import sys
from pathlib import Path

TRACKER_PATH = Path(__file__).resolve().parents[1] / "core" / "script_tracker.py"


def _is_dynamic_import(function: ast.expr) -> bool:
    return (isinstance(function, ast.Name) and function.id == "__import__") or (isinstance(function, ast.Attribute) and function.attr == "import_module")


def non_stdlib_imports(source: str) -> list[str]:
    """Every module a piece of Python source imports that is not part of the standard library.

    Relative imports count as non-stdlib (`.live_asr`), and imports inside functions are found too.
    """
    found = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = ["." * node.level + (node.module or "")]
        elif isinstance(node, ast.Call) and _is_dynamic_import(node.func):
            found.append("<dynamic import>")
            continue
        else:
            continue
        for name in names:
            if name.startswith(".") or name.split(".")[0] not in sys.stdlib_module_names:
                found.append(name)
    return found


def test_the_rule_flags_engine_and_third_party_imports_and_accepts_the_standard_library():
    assert non_stdlib_imports("import re\nfrom dataclasses import dataclass\nimport os.path\n") == []
    assert non_stdlib_imports("import live_asr") == ["live_asr"]
    assert non_stdlib_imports("from live_asr import Hypothesis") == ["live_asr"]
    assert non_stdlib_imports("import numpy as np") == ["numpy"]
    assert non_stdlib_imports("from faster_whisper import WhisperModel") == ["faster_whisper"]
    assert non_stdlib_imports("from . import live_asr") == ["."]
    assert non_stdlib_imports("from .live_asr import x") == [".live_asr"]
    assert non_stdlib_imports("def late():\n    import moonshine_onnx\n") == ["moonshine_onnx"]
    assert non_stdlib_imports("if TYPE_CHECKING:\n    from live_asr import Hypothesis\n") == ["live_asr"]
    assert non_stdlib_imports("import importlib\nengine = importlib.import_module('live_asr')\n") == ["<dynamic import>"]
    assert non_stdlib_imports("engine = __import__('live_asr')\n") == ["<dynamic import>"]


def test_the_script_tracker_imports_only_the_standard_library():
    assert non_stdlib_imports(TRACKER_PATH.read_text(encoding="utf-8")) == [], (
        "ADR 0021 point 3: the script tracker must not depend on an engine or any third-party package"
    )
