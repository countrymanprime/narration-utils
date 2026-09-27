"""Provider-ports guard (ADR 0301): no sidecar code outside an adapter compares a provider name.

A call site asks a registry by name (`ENGINES.lookup(args.engine)`, `SOURCES.fallback_order()`) and gets an adapter;
it never writes `engine == "moonshine"`, `source in {"cmu", "espeak"}` or a list of the names, because a new engine is
meant to be one adapter file and one registry row with no call site edited. The provider names are read from the
adapters' own descriptors, so a new adapter's name is guarded the moment it is registered.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
SIDECARS = REPO / "sidecars"

# Modules that compare a provider name without being an adapter. An adapter module declares a `descriptor = ...Descriptor(...)`
# class attribute and is exempt by that; anything else needs a written reason here, and an entry that stops being needed
# fails the guard, so the list can only shrink.
EXCEPTIONS = {
    "manuscript-teleprompter/core/devices.py": "the dshow adapter's device lister, wrapped by capture_dshow.py; 'dshow' there is FFmpeg's log context",
    "manuscript-teleprompter/core/locate.py": "--locate is a Whisper-only tool that refuses any other engine; it selects nothing",
}


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    what: str

    def __str__(self) -> str:
        return f"sidecars/{self.path}:{self.line}: {self.what}"


def sidecar_sources() -> list[Path]:
    """The shipped sidecar code: every core/ module, not tests or spikes."""
    return sorted(path for path in SIDECARS.glob("*/core/**/*.py") if "tests" not in path.parts)


def _descriptor_name(call: ast.Call) -> str | None:
    callee = call.func.id if isinstance(call.func, ast.Name) else call.func.attr if isinstance(call.func, ast.Attribute) else ""
    if not callee.endswith("Descriptor"):
        return None
    for keyword in call.keywords:
        if keyword.arg == "name" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, str):
            return keyword.value.value
    if call.args and isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
        return call.args[0].value
    return None


def declared_descriptors(tree: ast.AST) -> set[str]:
    """The names of the `descriptor = <X>Descriptor(...)` class attributes in a module: the adapters it defines."""
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        for statement in node.body:
            is_descriptor = isinstance(statement, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "descriptor" for target in statement.targets
            )
            name = _descriptor_name(statement.value) if is_descriptor and isinstance(statement.value, ast.Call) else None
            if name:
                names.add(name)
    return names


def _is_name(node: ast.AST, names: set[str]) -> bool:
    return isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in names


def _named_elements(node: ast.AST, names: set[str]) -> list[str]:
    if isinstance(node, (ast.Set, ast.List, ast.Tuple)):
        return [element.value for element in node.elts if _is_name(element, names)]
    if isinstance(node, ast.Dict):
        return [key.value for key in node.keys if key is not None and _is_name(key, names)]
    return []


def comparisons(tree: ast.AST, names: set[str], path: str) -> list[Finding]:
    """Every place in tree that compares a provider name or lists several: `==`/`!=`/`in`/`is` with a name on either
    side, a `case "name":` pattern, and a set, list, tuple or dict-keys literal holding two or more names."""
    findings: list[Finding] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Compare):
            operands = [node.left, *node.comparators]
            named = [operand.value for operand in operands if _is_name(operand, names)]
            if not named and any(isinstance(op, (ast.In, ast.NotIn)) for op in node.ops):
                named = [name for operand in node.comparators for name in _named_elements(operand, names)]
            if named:
                findings.append(Finding(path, node.lineno, f"compares the provider name {named[0]!r}; look it up in its registry instead"))
        elif isinstance(node, ast.MatchValue) and _is_name(node.value, names):
            findings.append(Finding(path, node.lineno, f"matches on the provider name {node.value.value!r}; look it up in its registry instead"))
        elif isinstance(node, (ast.Set, ast.List, ast.Tuple, ast.Dict)):
            listed = _named_elements(node, names)
            if len(set(listed)) >= 2:
                findings.append(
                    Finding(path, node.lineno, f"lists the provider names {sorted(set(listed))}; take them from the registry (names(), fallback_order())")
                )
    return findings


def _parse(path: Path) -> ast.AST:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _relative(path: Path) -> str:
    return path.relative_to(SIDECARS).as_posix()


def provider_names() -> set[str]:
    names: set[str] = set()
    for path in sidecar_sources():
        names |= declared_descriptors(_parse(path))
    return names


def test_the_guard_finds_every_provider_the_sidecars_register():
    # If the descriptors could not be read the guard would pass vacuously; these are the rows the Go registries mirror.
    assert provider_names() >= {"whisper", "moonshine", "piper", "cmu", "espeak", "dshow"}


def test_no_sidecar_call_site_compares_a_provider_name():
    names = provider_names()
    problems: list[str] = []
    for path in sidecar_sources():
        relative = _relative(path)
        tree = _parse(path)
        if declared_descriptors(tree) or relative in EXCEPTIONS:
            continue
        problems += [str(finding) for finding in comparisons(tree, names, relative)]
    assert not problems, "\n".join(problems)


@pytest.mark.parametrize("relative", sorted(EXCEPTIONS))
def test_each_exception_is_still_needed(relative):
    path = SIDECARS / relative
    assert path.is_file(), f"EXCEPTIONS names {relative}, which no longer exists; remove the entry"
    tree = _parse(path)
    assert not declared_descriptors(tree), f"{relative} declares a descriptor, so it is exempt as an adapter; remove its entry"
    assert comparisons(tree, provider_names(), relative), f"{relative} no longer compares a provider name; remove its entry"


def test_the_guard_flags_comparisons_and_name_lists_and_ignores_lookups():
    # The guard is only worth having if it fires.
    source = """
if args.engine == "moonshine": pass
if "espeak" != source: pass
if source in {"cmu", "espeak"}: pass
if engine not in ("whisper",): pass
match backend:
    case "dshow": pass
CHOICES = ["whisper", "moonshine"]
LOG = {"cmu": "a", "espeak": "b"}
ENGINES.lookup(args.engine)
ENGINES.lookup("whisper")
if kind == "tts": pass
report = {"engine": "moonshine"}
argv = ["--engine", "whisper"]
"""
    found = comparisons(ast.parse(source), {"whisper", "moonshine", "cmu", "espeak", "dshow", "piper"}, "fixture.py")
    assert sorted({finding.line for finding in found}) == [2, 3, 4, 5, 7, 8, 9]


def test_descriptor_names_are_read_from_keyword_and_positional_forms():
    source = """
class A:
    descriptor = AsrDescriptor(name="whisper", label="Whisper")
class B:
    descriptor = PronunciationDescriptor("cmu", "CMU dictionary")
class C:
    descriptor = something_else("piper")
LOOSE = TtsDescriptor("espeak", "not a class attribute")
"""
    assert declared_descriptors(ast.parse(source)) == {"whisper", "cmu"}
