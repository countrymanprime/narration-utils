"""MkDocs hooks for the public docs site (ADR 0083).

The site is the repository's `docs/` folder, read where it is. These hooks decide what is published and keep every link on
the site alive:

* `on_files` drops every page of docs/ that `include.txt` does not list (and fails when a listed line matches nothing);
* `on_page_markdown` rewrites a relative link that leaves the published set, that is, a link to a file outside `docs/`, to a
  page `include.txt` leaves out, or to a folder with no published index, into the GitHub file view of that path at the ref
  being built. A link to something that does not exist is left alone, so the strict build reports it;
* `on_nav` names the sections and puts the top level in the order `mkdocs.yml` asks for;
* `on_post_build` copies the mermaid bundle (a pinned devDependency of the root package) beside the pages. Material loads
  mermaid from unpkg.com when no `mermaid` global exists, which would make every visitor's browser ask a third party; the site
  ships it instead, the way it ships system fonts rather than Google Fonts.

The functions that do the work take plain values and are tested without MkDocs (`tests/test_hooks.py`); the `on_*` functions
at the bottom only unpack MkDocs' arguments.
"""

from __future__ import annotations

import os
import posixpath
import re
import shutil
from collections.abc import Callable, Iterable
from pathlib import Path
from urllib.parse import quote, unquote

DEFAULT_REF = "main"
INDEX_NAMES = ("README.md", "index.md")

_SCHEME = re.compile(r"^([a-z][a-z0-9+.-]*:|//)", re.IGNORECASE)
_LINK = re.compile(r'(!?\[[^\]\n]*\])\(([^)\s]+)((?:\s+"[^"]*")?)\)')
# Elements whose content HTML parsers read as text up to a closing tag that prose never writes: a `<title>` in a sentence
# ("named <title> progress") makes newer Python html.parser swallow the rest of the page, headings included. GitHub hides such a tag;
# the site shows it as text.
_RAW_TEXT_TAG = re.compile(r"<(/?)(title|textarea|script|style|iframe|noembed|noframes|noscript|plaintext|xmp)\b([^>\n]*)>", re.IGNORECASE)
_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$")
_CODE = re.compile(r"^[ \t]*(`{3,}|~{3,})[^\n]*\n.*?(?:^[ \t]*\1[ \t]*$|\Z)|`[^`\n]+`", re.MULTILINE | re.DOTALL)
_REFERENCE_DEFINITION = re.compile(r"^ {0,3}\[[^\]\n]+\]:[ \t]*(\S+)", re.MULTILINE)


# ---------------------------------------------------------------------------------------------------------------------
# The include list
# ---------------------------------------------------------------------------------------------------------------------


def read_manifest(text: str) -> list[str]:
    """The entries of include.txt: one per line, `#` comments and blank lines dropped."""
    stripped = (line.strip() for line in text.splitlines())
    return [line for line in stripped if line and not line.startswith("#")]


def _glob_regex(pattern: str) -> re.Pattern[str]:
    parts = []
    i = 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            parts.append(".*")
            i += 2
        elif pattern[i] == "*":
            parts.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            parts.append("[^/]")
            i += 1
        else:
            parts.append(re.escape(pattern[i]))
            i += 1
    return re.compile("".join(parts) + r"\Z")


def matches_entry(uri: str, entry: str) -> bool:
    """Whether the docs-relative path `uri` is named by one include.txt entry (a file, a folder ending in `/`, or a glob)."""
    if entry.endswith("/"):
        return uri.startswith(entry)
    if any(ch in entry for ch in "*?"):
        return _glob_regex(entry).match(uri) is not None
    return uri == entry


def is_published(uri: str, entries: Iterable[str]) -> bool:
    return any(matches_entry(uri, entry) for entry in entries)


def unmatched_entries(uris: Iterable[str], entries: Iterable[str]) -> list[str]:
    """The entries that name no file of docs/ at all: stale lines, reported by the build."""
    files = list(uris)
    return [entry for entry in entries if not any(matches_entry(uri, entry) for uri in files)]


# ---------------------------------------------------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------------------------------------------------


def github_url(repo_url: str, ref: str, repo_path: str, *, is_dir: bool, fragment: str = "", raw: bool = False) -> str:
    """The GitHub file view (`raw`: the file itself, for an image) of a path in the repository at a ref."""
    kind = "tree" if is_dir else "blob"
    query = "?raw=true" if raw and not is_dir else ""
    suffix = f"#{fragment}" if fragment else ""
    return f"{repo_url.rstrip('/')}/{kind}/{ref}/{quote(repo_path, safe='/')}{query}{suffix}"


def resolve_target(
    target: str,
    page_uri: str,
    *,
    docs_dir: Path,
    repo_root: Path,
    published: Callable[[str], bool],
    repo_url: str,
    ref: str,
    image: bool = False,
) -> str | None:
    """The replacement for one link target, or None to leave it as written."""
    if not target or target.startswith("#") or _SCHEME.match(target):
        return None
    path, _, fragment = target.partition("#")
    path = path.split("?", 1)[0]
    if not path or path.startswith("/") or "\\" in path:
        return None
    base = posixpath.dirname(page_uri)
    rel = posixpath.normpath(posixpath.join(base, unquote(path)))
    docs_rel = docs_dir.resolve().relative_to(repo_root.resolve()).as_posix()
    repo_rel = posixpath.normpath(posixpath.join(docs_rel, rel))
    if repo_rel == ".." or repo_rel.startswith("../"):
        return None
    on_disk = repo_root / repo_rel
    if not on_disk.exists():
        return None
    inside_docs = not (rel == ".." or rel.startswith("../"))
    if inside_docs and on_disk.is_file() and published(rel):
        return None
    if inside_docs and on_disk.is_dir():
        for name in INDEX_NAMES:
            index = posixpath.join(rel, name)
            if published(index):
                local = posixpath.relpath(index, base or ".")
                return local + (f"#{fragment}" if fragment else "")
    return github_url(repo_url, ref, repo_rel, is_dir=on_disk.is_dir(), fragment=fragment, raw=image)


def _mask_code(text: str) -> str:
    """The same text with code spans and fenced blocks blanked out (newlines kept), so a link is found only in prose."""
    return _CODE.sub(lambda m: re.sub(r"[^\n]", "\x00", m.group(0)), text)


def escape_raw_text_tags(markdown: str) -> str:
    """Turn a raw-text HTML tag written in prose into visible text; code spans and fenced blocks are examples and stay as written."""
    masked = _mask_code(markdown)
    out = []
    last = 0
    for match in _RAW_TEXT_TAG.finditer(masked):
        out.append(markdown[last : match.start()])
        out.append("&lt;" + match.group(1) + match.group(2) + match.group(3) + "&gt;")
        last = match.end()
    out.append(markdown[last:])
    return "".join(out)


def safe_ref(value: str | None) -> str:
    """The branch, tag or commit to link to: DOCS_SITE_REF when it looks like one, otherwise `main`."""
    return value if value and _REF.match(value) else DEFAULT_REF


def rewrite_links(
    markdown: str,
    page_uri: str,
    *,
    docs_dir: Path,
    repo_root: Path,
    published: Callable[[str], bool],
    repo_url: str,
    ref: str = DEFAULT_REF,
) -> str:
    masked = _mask_code(markdown)
    targets = [(m.span(2), m.group(1).startswith("!")) for m in _LINK.finditer(masked)]
    targets += [(m.span(1), False) for m in _REFERENCE_DEFINITION.finditer(masked)]
    out = []
    last = 0
    for (start, end), image in sorted(targets):
        replacement = resolve_target(
            markdown[start:end], page_uri, docs_dir=docs_dir, repo_root=repo_root, published=published, repo_url=repo_url, ref=ref, image=image
        )
        if replacement is not None:
            out.append(markdown[last:start])
            out.append(replacement)
            last = end
    out.append(markdown[last:])
    return "".join(out)


def storybook_section(site_url: str, storybook_path: str) -> str:
    """The paragraph appended to the generated atlas index: docs/ui/atlas/index.md is written by `ui-atlas docs`, so it is not edited."""
    url = site_url.rstrip("/") + "/" + storybook_path.lstrip("/")
    return (
        "\n\n## Live Storybook\n\n"
        f"The same stories, interactive, with the controls and the accessibility checks: [open Storybook]({url}). "
        "It is built from the same commit as this page.\n"
    )


# ---------------------------------------------------------------------------------------------------------------------
# Navigation
# ---------------------------------------------------------------------------------------------------------------------


def order_keys(keys: list[str], order: list[str]) -> list[int]:
    """Indexes that put the keys named in `order` first, in that order, and keep the rest where they were."""
    rank = {name: position for position, name in enumerate(order)}
    return sorted(range(len(keys)), key=lambda i: (rank.get(keys[i], len(order)), i))


# ---------------------------------------------------------------------------------------------------------------------
# MkDocs hooks
# ---------------------------------------------------------------------------------------------------------------------


def _settings(config) -> dict:
    return config["extra"]


def _manifest_entries(config) -> list[str]:
    path = Path(config.config_file_path).parent / _settings(config)["include_manifest"]
    return read_manifest(path.read_text(encoding="utf-8"))


def _is_docs_file(file, config) -> bool:
    return Path(file.src_dir).resolve() == Path(config.docs_dir).resolve()


def on_files(files, config):
    from mkdocs.exceptions import PluginError

    entries = _manifest_entries(config)
    docs_files = [file for file in files if _is_docs_file(file, config)]
    stale = unmatched_entries((file.src_uri for file in docs_files), entries)
    if stale:
        raise PluginError(f"include.txt names nothing in docs/ for: {', '.join(stale)}")
    docs_dir = Path(config.docs_dir).resolve()
    for file in docs_files:
        if not is_published(file.src_uri, entries):
            files.remove(file)
        elif not Path(file.abs_src_path).resolve().is_relative_to(docs_dir):
            raise PluginError(f"{file.src_uri} resolves outside docs/ (a symbolic link?); the site publishes only what docs/ holds")
    return files


def on_page_markdown(markdown, page, config, files):
    docs_dir = Path(config.docs_dir).resolve()
    repo_root = docs_dir.parent
    text = rewrite_links(
        escape_raw_text_tags(markdown),
        page.file.src_uri,
        docs_dir=docs_dir,
        repo_root=repo_root,
        published=lambda uri: files.get_file_from_path(uri) is not None,
        repo_url=_settings(config)["repo_url"],
        ref=safe_ref(os.environ.get("DOCS_SITE_REF")),
    )
    settings = _settings(config)
    if page.file.src_uri == settings["storybook_page"]:
        text += storybook_section(config.site_url, settings["storybook_path"])
    return text


def _first_page_uri(item) -> str | None:
    if getattr(item, "file", None) is not None:
        return item.file.src_uri
    for child in getattr(item, "children", None) or []:
        found = _first_page_uri(child)
        if found:
            return found
    return None


def _retitle(items, titles: dict[str, str], depth: int) -> None:
    for item in items:
        children = getattr(item, "children", None)
        if not children:
            continue
        first = _first_page_uri(item)
        folder = "/".join((first or "").split("/")[: depth + 1])
        if folder in titles:
            item.title = titles[folder]
        _retitle(children, titles, depth + 1)


def on_nav(nav, config, files):
    settings = _settings(config)
    _retitle(nav.items, settings.get("nav_titles", {}), 0)
    keys = []
    for item in nav.items:
        first = _first_page_uri(item) or ""
        keys.append(first.split("/")[0] if getattr(item, "children", None) else posixpath.splitext(first)[0])
    home = [i for i, item in enumerate(nav.items) if _first_page_uri(item) in INDEX_NAMES]
    ordered = order_keys(keys, settings.get("nav_order", []))
    nav.items[:] = [nav.items[i] for i in [*home, *[j for j in ordered if j not in home]]]
    return nav


def vendor_mermaid(bundle: Path, site_dir: Path) -> Path:
    """Copy the mermaid bundle and its licence into `<site>/assets/vendor/`; the page loads it through `extra_javascript`."""
    if not bundle.is_file():
        raise FileNotFoundError(f"the mermaid bundle {bundle} is missing: run `pnpm install` (mermaid is a devDependency of the root package)")
    target = site_dir / "assets" / "vendor"
    target.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(bundle, target / bundle.name)
    # The licence sits beside the bundle or, for the npm package, one folder up (`dist/mermaid.min.js`, `LICENSE`).
    licence = next((path for path in (bundle.parent / "LICENSE", bundle.parent.parent / "LICENSE") if path.is_file()), None)
    if licence is not None:
        shutil.copyfile(licence, target / "LICENSE-mermaid.txt")
    return target / bundle.name


def on_post_build(config):
    from mkdocs.exceptions import PluginError

    bundle = _settings(config).get("mermaid_bundle")
    if not bundle:
        return
    try:
        vendor_mermaid((Path(config.config_file_path).parent / bundle).resolve(), Path(config.site_dir))
    except FileNotFoundError as error:
        raise PluginError(str(error)) from error
