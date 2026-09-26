"""Reading the Go level vocabulary back from its golden (``tests/fixtures/contracts/port-levels.json``, ADR 0301).

The Go ``internal/port`` test writes the golden; this side only reads it. Its exact layout is Go's to choose, so any plain layout is
accepted: a list of names, a ``{"levels": [...]}`` wrapper, a list of objects carrying a name and a value, or a map of name to value.
Names may be Go's identifiers (``NotYetAvailable``) or the wire strings (``not_yet_available``). What must match is the set of levels,
their order and, when given, their numeric values.
"""

from typing import Any

from .registry import Level

_NAME_KEYS = ("name", "Name", "wire", "Wire", "string", "String", "id")
_VALUE_KEYS = ("value", "Value", "level", "Level", "ordinal")


def _level(text: str) -> Level | None:
    for level in Level:
        if text in (level.name, level.wire):
            return level
    return None


def _entries(payload: Any) -> list[tuple[str, int | None]]:
    if isinstance(payload, dict) and "levels" in payload:
        payload = payload["levels"]
    if isinstance(payload, dict) and payload and all(isinstance(key, str) for key in payload):
        items = list(payload.items())
        if all(isinstance(value, int) for _, value in items):
            items.sort(key=lambda item: item[1])
            return [(key, value) for key, value in items]
        return [(key, None) for key, _ in items]
    if isinstance(payload, list):
        entries: list[tuple[str, int | None]] = []
        for item in payload:
            if isinstance(item, str):
                entries.append((item, None))
                continue
            if isinstance(item, dict):
                name = next((item[key] for key in _NAME_KEYS if isinstance(item.get(key), str)), None)
                value = next((item[key] for key in _VALUE_KEYS if isinstance(item.get(key), int)), None)
                if name is not None:
                    entries.append((name, value))
                    continue
            raise AssertionError(f"port-levels golden has an entry of an unknown shape: {item!r}")
        return entries
    raise AssertionError(f"port-levels golden has an unknown shape: {payload!r}")


def levels_in_golden(payload: Any) -> list[Level]:
    """The levels the golden lists, checked against ``Level``; an ``AssertionError`` says where Go and Python differ."""
    entries = _entries(payload)
    unknown = [name for name, _ in entries if _level(name) is None]
    if unknown:
        raise AssertionError(f"Go declares levels Python does not know: {', '.join(unknown)}. Add them to narration_common.ports.Level.")
    levels = [_level(name) for name, _ in entries]
    if len(levels) != len(Level):
        raise AssertionError(f"Go declares {len(levels)} levels and Python {len(Level)}: {', '.join(name for name, _ in entries)}")
    if levels != list(Level):
        raise AssertionError(f"Go's level order {[level.name for level in levels]} differs from Python's {[level.name for level in Level]}")
    for (name, value), level in zip(entries, levels, strict=True):
        if value is not None and value != int(level):
            raise AssertionError(f"Go gives {name} the value {value}, Python {int(level)}")
    return [level for level in levels if level is not None]
