"""A chapter's name as plain text, by the app's one rule (chapter-title-display-consistency PRD, ADR 0191).

The title and the subtitle join with " — " in the book's own casing. This mirrors apps/ui/src/chapterName.ts and
apps/desktop/internal/chaptername; tests/fixtures/chapter-names.json, written by the Go test, pins all three to the
same output. Plain-text outputs a consumer may not take an em dash in use form="plain", " - " (owner decision D34).

It is for text a person reads: logs, headings, lists. A matching key (a title compared with what another program
wrote) keeps its own form, so matching never changes with the display rule.
"""

import re

_TRAILING_SEPARATOR = re.compile(r"[:—–-]\s*$")


def _squash(text: str) -> str:
    return " ".join(text.split())


def _split_legacy_newline(title: str) -> tuple[str, str]:
    """A title that still holds its subtitle after a line break: the first line is the title and every later line
    joins into the subtitle, as the importers split a heading."""
    first, newline, rest = title.partition("\n")
    if not newline:
        return _squash(title), ""
    return _squash(first), _squash(rest.replace("\n", " "))


def _joined(title: str, subtitle: str, separator: str) -> str:
    if not subtitle:
        return title
    stripped = _TRAILING_SEPARATOR.sub("", title).strip()
    return f"{stripped}{separator}{subtitle}" if stripped else subtitle


def chapter_display_name(title: str, subtitle: str | None = None, form: str = "full", context: str | None = None) -> str:
    """The chapter's name. form is "full" ("Title — Subtitle", the title alone without a subtitle), "short" (the title
    alone) or "plain" (full with " - "); context gives "Context: Title — Subtitle". subtitle is None when the chapter
    has no subtitle field, and then a title holding a line break gives its later lines as the subtitle."""
    name, legacy = _split_legacy_newline(title or "")
    sub = legacy if subtitle is None else _squash(subtitle)
    if context is not None:
        return f"{context}: {_joined(name, sub, ' — ')}"
    if form == "short":
        return name
    if form == "plain":
        return _joined(name, sub, " - ")
    if form != "full":
        raise ValueError(f"unknown chapter name form {form!r}")
    return _joined(name, sub, " — ")
