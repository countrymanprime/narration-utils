"""Reads a built site and fails when any internal link is dead (ADR 0083).

MkDocs' strict build checks the Markdown it was given; this checks what it produced, and does not trust the generator. Every
`href` and `src` in every HTML file that points inside the site must resolve to a file of the output folder, and every
`#fragment` to an `id` on the page it names. Links to other sites are not followed.

    python tools/docs-site/check_site.py tools/docs-site/build/site --base /narration-utils/ \\
        --site-url https://countrymanprime.github.io/narration-utils/ --require storybook/index.html
"""

from __future__ import annotations

import argparse
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

LINK_ATTRIBUTES = {"href", "src", "poster", "data"}
IGNORED_SCHEMES = {"mailto", "tel", "javascript", "data", "blob"}


class _Page(HTMLParser):
    """The internal references and the ids of one HTML file."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.references: list[str] = []
        self.ids: set[str] = set()

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if value is None:
                continue
            if name == "id" or name == "name" and tag == "a":
                self.ids.add(value)
            elif name in LINK_ATTRIBUTES:
                self.references.append(value)
            elif name == "srcset":
                self.references.extend(candidate.split()[0] for candidate in value.split(",") if candidate.strip())


def _parse(path: Path) -> _Page:
    page = _Page()
    page.feed(path.read_text(encoding="utf-8"))
    return page


def _internal_path(reference: str, here: str, base: str, site_url: str) -> tuple[str, str] | str | None:
    """(path inside the site, fragment) for an internal reference, an error string for one that leaves the base, None to skip."""
    parts = urlsplit(reference)
    if parts.scheme in IGNORED_SCHEMES or reference.startswith("//"):
        return None
    if parts.scheme:
        prefix = site_url.rstrip("/")
        if not prefix or not (reference == prefix or reference.startswith(prefix + "/")):
            return None
        return unquote(reference[len(prefix) :].lstrip("/").split("#", 1)[0].split("?", 1)[0]), unquote(parts.fragment)
    path = unquote(parts.path)
    if path.startswith("/"):
        if not path.startswith(base):
            return f"points outside the site base {base}"
        return path[len(base) :], unquote(parts.fragment)
    if not path:
        return here, unquote(parts.fragment)
    return _join(here.rsplit("/", 1)[0] + "/" if "/" in here else "", path), unquote(parts.fragment)


def _join(directory: str, relative: str) -> str:
    stack = [part for part in directory.split("/") if part]
    for part in relative.split("/"):
        if part == "..":
            if not stack:
                return "../"
            stack.pop()
        elif part not in ("", "."):
            stack.append(part)
    joined = "/".join(stack)
    return joined + "/" if joined and relative.endswith("/") else joined


def _target_file(site: Path, inner: str) -> Path | None:
    candidate = site / inner
    if inner == "" or inner.endswith("/") or candidate.is_dir():
        candidate = candidate / "index.html"
    if not candidate.is_file():
        return None
    # A case-insensitive file system (Windows, macOS) finds `Index.html` for `index.html`; the server that publishes the site does not.
    expected = candidate.relative_to(site).as_posix()
    return candidate if candidate.resolve().relative_to(site).as_posix() == expected else None


def check_site(site: Path, *, base: str = "/", site_url: str = "", require: tuple[str, ...] = ()) -> list[str]:
    """Every problem found, one line each; an empty list is a clean site."""
    site = site.resolve()
    if not base.endswith("/"):
        base += "/"
    problems = [f"required file missing: {name}" for name in require if not (site / name).is_file()]
    pages = {path: _parse(path) for path in sorted(site.rglob("*.html"))}
    for path, page in pages.items():
        here = path.relative_to(site).as_posix()
        for reference in page.references:
            found = _internal_path(reference, here, base, site_url)
            if found is None:
                continue
            if isinstance(found, str):
                problems.append(f"{here}: {reference} {found}")
                continue
            inner, fragment = found
            target = None if inner.startswith("../") else _target_file(site, inner)
            if target is None:
                problems.append(f"{here}: {reference} does not resolve to a file of the site")
            elif fragment and target.suffix == ".html" and fragment not in pages.get(target, _Page()).ids:
                problems.append(f"{here}: {reference} names no #{fragment} on the page it links to")
    return problems


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("site", type=Path, help="the built site folder")
    parser.add_argument("--base", default="/", help="the path the site is served under, for example /narration-utils/")
    parser.add_argument("--site-url", default="", help="absolute URLs that start with this are internal links")
    parser.add_argument("--require", action="append", default=[], help="a file that must exist in the site (repeatable)")
    args = parser.parse_args(argv)
    if not args.site.is_dir():
        print(f"error: {args.site} is not a folder; build the site first", file=sys.stderr)
        return 2
    problems = check_site(args.site, base=args.base, site_url=args.site_url, require=tuple(args.require))
    pages = sum(1 for _ in args.site.rglob("*.html"))
    if problems:
        print(f"{len(problems)} dead internal link(s) in {pages} pages:", file=sys.stderr)
        for line in problems:
            print(f"  {line}", file=sys.stderr)
        return 1
    print(f"ok: {pages} pages, no dead internal link")
    return 0


if __name__ == "__main__":
    sys.exit(main())
