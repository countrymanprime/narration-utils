"""Writes THIRD-PARTY-NOTICES.txt: every third-party component the Windows release ships, its licence and its licence text.

Docs security and hygiene PRD, phase 7 (docs/architecture/model-provenance.md, docs/operations/ci-and-releases.md#third-party-notices).

    python scripts/licenses/notices.py --version 0.1.0 --out THIRD-PARTY-NOTICES.txt

What is read, and why it is what ships (each is read from the thing the release is built from, not from a list somebody keeps):

* **Python**: the three frozen sidecars. PyInstaller writes a table of contents for each freeze (`.release-build/<sidecar>/work/
  <sidecar>/Analysis-00.toc` and `PYZ-00.toc`) that names the source file of every module, binary and data file it took; the
  ones under `site-packages` are the packages that ship, and `importlib.metadata` of the same environment names their licences. A
  `pyproject.toml` list would also name the test and lint tools, which are not in the release (they are: see the tool's finding
  about the freeze taking `hypothesis` and `pytest`; the report says so instead of hiding them).
* **npm**: `pnpm licenses list --prod` in `apps/ui`, the production dependencies the UI bundle is built from.
* **Go**: `go list -deps` of the desktop program for `windows/amd64` with the Wails build tags, minus the main module and the
  standard library.
* **By hand**: `manual.json`, for what no package manager knows (the Python runtime, the vendored FFmpeg libraries inside the PyAV
  wheel, the PyInstaller bootloader, the eSpeak NG data inside Piper, the Microsoft runtime DLLs).
* **Downloaded models and voices**: `config/*-assets.json`. They are not in the package; the report says where each comes from and
  under which licence.

A licence that cannot be named is an error, not a guess: `UNKNOWN` fails the run unless `reviewed.json` names what a person decided.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path

REPOSITORY = "https://github.com/countrymanprime/narration-utils"
PROGRAM_LICENSE = "AGPL-3.0-or-later"
SIDECARS = ("manuscript-guide", "transcript-compare", "manuscript-teleprompter")
# The Python packages the sidecars import at run time, which the frozen bundle must therefore contain (pyproject.toml lists test and
# lint tools beside them, and python-docx and pypdf are not imported by any sidecar). A report that lacks one of these is wrong.
# The report is of the Windows release, so moonshine-voice (a Windows-only dependency, the Teleprompter's Moonshine engine) is here.
SHIPPED_PYTHON_DIRECT = frozenset({"av", "ctranslate2", "faster-whisper", "moonshine-voice", "numpy", "phonemizer", "piper-tts", "pronouncing", "spacy"})
GO_BUILD_TAGS = "desktop,production"
LICENSE_FILE = re.compile(r"^(licen[cs]e|copying|notice|unlicense)([-._].*)?$", re.IGNORECASE)
# `license.py` or `license.go` next to a licence file is code, not a licence.
SOURCE_SUFFIXES = frozenset({".py", ".pyc", ".pyd", ".go", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".json", ".dll", ".so", ".yml", ".yaml", ".toml"})
# The SPDX names of the copyleft families, read case-sensitively so "Simplified BSD" is not "MPL".
COPYLEFT = re.compile(r"\b(AGPL|LGPL|GPL|MPL|EPL|CDDL)")


def is_source_name(name: str) -> bool:
    return Path(name).suffix.lower() in SOURCE_SUFFIXES


def is_copyleft(license_name: str) -> bool:
    return COPYLEFT.search(license_name) is not None


class NoticeError(Exception):
    """The report cannot be trusted, so it is not written."""


@dataclass(frozen=True)
class Component:
    ecosystem: str
    name: str
    version: str
    license: str
    homepage: str
    texts: tuple[str, ...]
    source: str = ""


@dataclass(frozen=True)
class Frozen:
    modules: set[str]
    vendored: set[str]
    dist_infos: dict[str, str]


# ---------------------------------------------------------------------------------------------------------------------
# Python: the frozen bundle
# ---------------------------------------------------------------------------------------------------------------------

_SITE = re.compile(r"site-packages[\\/]+(.+)$", re.IGNORECASE)
_DIST_INFO = re.compile(r"^(?P<name>.+?)-(?P<version>\d[^-]*)\.dist-info$")


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, (list, tuple, set)):
        for child in node:
            yield from _strings(child)
    elif isinstance(node, dict):
        for key, value in node.items():
            yield from _strings(key)
            yield from _strings(value)


def read_frozen_toc(text: str) -> Frozen:
    """The site-packages entries of one PyInstaller table of contents (a Python literal), as top-level names."""
    try:
        table = ast.literal_eval(text)
    except (ValueError, SyntaxError) as error:
        raise NoticeError("this is not a PyInstaller table of contents (it is not a Python literal)") from error
    modules: set[str] = set()
    vendored: set[str] = set()
    dist_infos: dict[str, str] = {}
    for value in _strings(table):
        match = _SITE.search(value)
        if not match:
            continue
        top = re.split(r"[\\/]", match.group(1))[0]
        info = _DIST_INFO.match(top)
        if info:
            dist_infos[info["name"]] = info["version"]
        elif top.endswith(".libs"):
            vendored.add(top)
        elif top.endswith((".data", ".pth", ".egg-info")) or top == "__pycache__":
            continue
        else:
            # A file is `name.py` or `name.cp312-win_amd64.pyd`: the module is what comes before the first dot.
            modules.add(top.split(".")[0] if top.lower().endswith((".py", ".pyd", ".so", ".dll")) else top)
    return Frozen(modules, vendored, dist_infos)


def distributions_of(modules: set[str], dist_infos: dict[str, str], mapping: dict[str, list[str]]) -> tuple[set[str], set[str]]:
    """The distributions that own `modules` (through `packages_distributions()`), plus those whose metadata was copied; and what is unmapped."""
    found: set[str] = set(dist_infos)
    unmapped: set[str] = set()
    for module in modules:
        owners = mapping.get(module) or mapping.get(module.replace("-", "_"))
        if owners:
            found.update(owners)
        else:
            unmapped.add(module)
    return found, unmapped


# A free-text field that is already an SPDX expression ("GPL-3.0-or-later", "MPL-2.0 AND MIT"); prose such as "See LICENSE.txt" is not.
_SPDX_EXPRESSION = re.compile(r"^[A-Za-z0-9.+-]+\d[A-Za-z0-9.+-]*( (AND|OR|WITH) [A-Za-z0-9.+-]+)*$")
_SPDX_BY_TEXT = {
    "mit": "MIT",
    "mit license": "MIT",
    "bsd": "BSD-3-Clause",
    "bsd license": "BSD-3-Clause",
    "apache 2.0": "Apache-2.0",
    "apache-2.0": "Apache-2.0",
    "apache software license": "Apache-2.0",
    "isc license": "ISC",
    "isc": "ISC",
    "mpl-2.0": "MPL-2.0",
}
_SPDX_BY_CLASSIFIER = {
    "MIT License": "MIT",
    "BSD License": "BSD-3-Clause",
    "Apache Software License": "Apache-2.0",
    "ISC License (ISCL)": "ISC",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "GNU General Public License v3 or later (GPLv3+)": "GPL-3.0-or-later",
    "GNU General Public License v3 (GPLv3)": "GPL-3.0-only",
    "GNU General Public License v2 or later (GPLv2+)": "GPL-2.0-or-later",
    "GNU Lesser General Public License v3 or later (LGPLv3+)": "LGPL-3.0-or-later",
}


def python_license(fields: dict[str, str], classifiers: list[str]) -> str:
    """An SPDX name for a distribution, or UNKNOWN. A free-text `License` field is trusted only when it is short and known."""
    expression = (fields.get("License-Expression") or "").strip()
    if expression:
        return expression
    free = (fields.get("License") or "").strip()
    if free and len(free) < 60 and "\n" not in free:
        if free.lower() in _SPDX_BY_TEXT:
            return _SPDX_BY_TEXT[free.lower()]
        if _SPDX_EXPRESSION.match(free):
            return free
    for classifier in classifiers:
        label = classifier.split(" :: ", 2)[-1]
        if classifier.startswith("License :: OSI Approved :: ") and label in _SPDX_BY_CLASSIFIER:
            return _SPDX_BY_CLASSIFIER[label]
    return "UNKNOWN"


def classify_text(text: str) -> str:
    """An SPDX name for a licence text a Go module ships, from phrases that only that licence contains. UNKNOWN when none matches."""
    flat = " ".join(text.split())
    lowered = flat.lower()
    # The GNU licences quote each other (GPL-3.0 section 13 names the Affero licence, GPL-2.0 names the Lesser one), so only the title at the
    # top of the text decides. A licence text cannot say "or later": that is in the file headers, so the bare SPDX names are used.
    head = lowered[:120]
    version = "3" if "version 3" in head else "2.1" if "version 2.1" in head else "2"
    if head.startswith("gnu affero general public license"):
        return "AGPL-3.0"
    if head.startswith("gnu lesser general public license"):
        return "LGPL-3.0" if version == "3" else "LGPL-2.1"
    if head.startswith("gnu general public license"):
        return "GPL-3.0" if version == "3" else "GPL-2.0"
    if "mozilla public license" in lowered:
        return "MPL-2.0"
    if "apache license" in lowered and "version 2.0" in lowered:
        return "Apache-2.0"
    if "permission to use, copy, modify, and/or distribute this software for any purpose with or without fee" in lowered:
        return "ISC"
    if "permission is hereby granted, free of charge" in lowered:
        return "MIT"
    if "redistribution and use in source and binary forms" in lowered:
        return "BSD-3-Clause" if "neither the name" in lowered else "BSD-2-Clause"
    return "UNKNOWN"


def _license_texts(folder: Path, depth: int = 1) -> tuple[str, ...]:
    """The licence files at the top of a folder (and of a `licenses` or `LICENSES` folder inside it), as text."""
    found: list[str] = []
    if not folder.is_dir():
        return ()
    for entry in sorted(folder.iterdir(), key=lambda path: path.name.lower()):
        if entry.is_file() and LICENSE_FILE.match(entry.name) and not is_source_name(entry.name):
            found.append(entry.read_text(encoding="utf-8", errors="replace").strip())
        elif entry.is_dir() and depth > 0 and entry.name.lower() in {"licenses", "license"}:
            found.extend(_license_texts(entry, depth - 1))
    return tuple(text for text in found if text)


def check_frozen_version(name: str, installed: str, frozen: dict[str, str]) -> None:
    """The environment this report reads must be the one that was frozen: a different version is a different licence text."""
    for frozen_name, frozen_version in frozen.items():
        if _normal(frozen_name) == _normal(name) and frozen_version != installed:
            raise NoticeError(
                f"{name} {installed} is installed but the freeze took {frozen_version}: run this in the environment that ran prepare-resources.py"
            )


def python_component(name: str, sidecars: str, frozen_versions: dict[str, str] | None = None) -> Component:
    try:
        dist = metadata.distribution(name)
    except metadata.PackageNotFoundError as error:
        raise NoticeError(f"{name} was frozen but is not installed here: run this in the environment that ran prepare-resources.py") from error
    check_frozen_version(name, dist.version, frozen_versions or {})
    fields = {key: dist.metadata.get(key) or "" for key in ("License-Expression", "License", "Home-page")}
    classifiers = dist.metadata.get_all("Classifier") or []
    homepage = fields["Home-page"] or next(
        (v.split(", ", 1)[-1] for v in dist.metadata.get_all("Project-URL") or [] if v.lower().startswith(("homepage", "source"))), ""
    )
    texts: list[str] = []
    for file in dist.files or []:
        # The licence files a wheel carries: inside its .dist-info folder (PEP 639) or at the top of the package folder.
        if LICENSE_FILE.match(file.name) and not is_source_name(file.name) and (file.parts[0].endswith(".dist-info") or len(file.parts) <= 2):
            path = dist.locate_file(file)
            if path.is_file():
                texts.append(path.read_text(encoding="utf-8", errors="replace").strip())
    return Component(
        "python", dist.metadata["Name"], dist.version, python_license(fields, classifiers), homepage, tuple(dict.fromkeys(t for t in texts if t)), sidecars
    )


def collapse_spellings(components: list[Component]) -> list[Component]:
    """One component per distribution: `piper_tts` (a folder name) and `piper-tts` (the metadata name) are the same package."""
    seen: dict[tuple[str, str, str], Component] = {}
    for component in components:
        seen.setdefault((component.ecosystem, _normal(component.name), component.version), component)
    return list(seen.values())


def check_vendored(vendored: set[str], components: list[Component]) -> None:
    """A native folder that a wheel vendored (`av.libs`) carries libraries this tool cannot name: each needs a hand-written entry."""
    manual = " ".join(c.name for c in components if c.ecosystem == "manual")
    missing = sorted(folder for folder in vendored if re.search(rf"(?<![\w.]){re.escape(folder)}(?![\w.])", manual) is None)
    if missing:
        raise NoticeError("vendored native folders with no entry in scripts/licenses/manual.json (name the folder in the entry): " + ", ".join(missing))


def python_components(release_build: Path, ignored_modules: frozenset[str] = frozenset()) -> tuple[list[Component], set[str]]:
    """Every distribution the three frozen sidecars contain and the vendored native folders they carry. A module no distribution owns is an error."""
    modules: set[str] = set()
    vendored: set[str] = set()
    dist_infos: dict[str, str] = {}
    where: dict[str, set[str]] = {}
    per_sidecar: dict[str, Frozen] = {}
    for sidecar in SIDECARS:
        work = release_build / sidecar / "work" / sidecar
        tocs = [work / "Analysis-00.toc", work / "PYZ-00.toc"]
        missing = [str(toc) for toc in tocs if not toc.is_file()]
        if missing:
            raise NoticeError(f"the freeze of {sidecar} has no table of contents ({', '.join(missing)}): run scripts/release/prepare-resources.py first")
        frozen = Frozen(set(), set(), {})
        for toc in tocs:
            part = read_frozen_toc(toc.read_text(encoding="utf-8", errors="replace"))
            frozen.modules.update(part.modules)
            frozen.vendored.update(part.vendored)
            frozen.dist_infos.update(part.dist_infos)
        per_sidecar[sidecar] = frozen
        modules |= frozen.modules
        vendored |= frozen.vendored
        dist_infos.update(frozen.dist_infos)
    mapping = metadata.packages_distributions()
    names, unmapped = distributions_of(modules, dist_infos, mapping)
    unmapped -= ignored_modules
    if unmapped:
        raise NoticeError(
            "frozen modules that no installed distribution owns (name them under ignoredModules in reviewed.json if they are ours): "
            + ", ".join(sorted(unmapped))
        )
    for sidecar, frozen in per_sidecar.items():
        own, _ = distributions_of(frozen.modules, frozen.dist_infos, mapping)
        for name in own:
            where.setdefault(_normal(name), set()).add(sidecar)
    components = collapse_spellings(
        [python_component(name, ", ".join(sorted(where.get(_normal(name), SIDECARS))), dist_infos) for name in sorted(names, key=str.lower)]
    )
    return components, vendored


# ---------------------------------------------------------------------------------------------------------------------
# npm and Go
# ---------------------------------------------------------------------------------------------------------------------


def parse_pnpm_licenses(text: str) -> list[Component]:
    listing = json.loads(text)
    components: list[Component] = []
    for license_name, entries in listing.items():
        for entry in entries:
            for index, version in enumerate(entry.get("versions") or [""]):
                paths = entry.get("paths") or []
                texts = _license_texts(Path(paths[index])) if index < len(paths) else ()
                components.append(Component("npm", entry["name"], version, license_name, entry.get("homepage") or "", texts, "apps/ui"))
    return sorted(components, key=lambda c: (c.name.lower(), c.version))


def _which(program: str) -> str:
    found = shutil.which(program)
    if not found:
        raise NoticeError(f"{program} is not on the PATH")
    return found


def npm_components(ui_dir: Path) -> list[Component]:
    result = subprocess.run([_which("pnpm"), "licenses", "list", "--prod", "--json"], cwd=ui_dir, capture_output=True, text=True, encoding="utf-8", check=False)
    if result.returncode != 0:
        raise NoticeError(f"pnpm licenses failed in {ui_dir}: {result.stderr.strip()[:300]}")
    return parse_pnpm_licenses(result.stdout)


def _json_objects(text: str):
    decoder = json.JSONDecoder()
    position = 0
    while True:
        while position < len(text) and text[position].isspace():
            position += 1
        if position >= len(text):
            return
        value, position = decoder.raw_decode(text, position)
        yield value


def parse_go_list(text: str) -> list[Component]:
    seen: dict[tuple[str, str], Component] = {}
    for package in _json_objects(text):
        module = package.get("Module")
        if package.get("Standard") or not module or module.get("Main"):
            continue
        key = (module["Path"], module.get("Version", ""))
        if key in seen:
            continue
        texts = _license_texts(Path(module["Dir"])) if module.get("Dir") else ()
        classes = [classify_text(t) for t in texts]
        known = next((c for c in classes if c != "UNKNOWN"), "UNKNOWN")
        seen[key] = Component("go", module["Path"], module.get("Version", ""), known, f"https://{module['Path']}", texts, "apps/desktop")
    return sorted(seen.values(), key=lambda c: c.name.lower())


def go_components(desktop_dir: Path) -> list[Component]:
    env = {**os.environ, "GOOS": "windows", "GOARCH": "amd64", "GOFLAGS": "-mod=readonly"}
    result = subprocess.run(
        [_which("go"), "list", "-deps", "-json", "-tags", GO_BUILD_TAGS, "."],
        cwd=desktop_dir,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if result.returncode != 0:
        raise NoticeError(f"go list failed in {desktop_dir}: {result.stderr.strip()[:300]}")
    return parse_go_list(result.stdout)


def go_direct_requirements(go_mod: str) -> set[str]:
    direct: set[str] = set()
    inside = False
    for line in go_mod.splitlines():
        stripped = line.strip()
        if stripped.startswith("require ("):
            inside = True
        elif inside and stripped == ")":
            inside = False
        elif inside and stripped and "// indirect" not in stripped:
            direct.add(stripped.split()[0])
        elif stripped.startswith("require ") and "(" not in stripped and "// indirect" not in stripped:
            direct.add(stripped.split()[1])
    return direct


def _normal(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def missing_direct(ecosystem: str, components: list[Component], names: set[str]) -> set[str]:
    have = {_normal(c.name) if ecosystem == "python" else c.name for c in components if c.ecosystem == ecosystem}
    return {name for name in names if (_normal(name) if ecosystem == "python" else name) not in have}


# ---------------------------------------------------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------------------------------------------------


def _section(title: str) -> str:
    return f"\n{'=' * 78}\n{title}\n\n"


def _entry(component: Component, license_name: str) -> str:
    head = f"{component.name} {component.version}".strip()
    lines = [f"{'-' * 78}", head, f"  licence: {license_name}"]
    if component.homepage:
        lines.append(f"  home: {component.homepage}")
    if component.source:
        lines.append(f"  shipped in: {component.source}")
    body = "\n\n".join(component.texts) if component.texts else "  (no licence file ships with this component; the licence above is the one it declares)"
    return "\n".join(lines) + "\n\n" + body + "\n"


def render_report(
    *,
    version: str,
    components: list[Component],
    program_license: str,
    catalogs: list[dict],
    reviewed: dict[str, str] | None = None,
    tag: str | None = None,
    commit: str | None = None,
    no_text_ok: set[str] | None = None,
) -> str:
    reviewed = reviewed or {}
    no_text_ok = no_text_ok or set()
    tag = tag or f"v{version}"
    # A release candidate's tag is pruned when newer ones come (prerelease.yml keeps ten), and the promoted release re-attaches these very
    # bytes, so the offer also names the commit, which stays.
    where = f"the tag {tag}" + (f" (commit {commit})" if commit else "")
    names: dict[Component, str] = {}
    unknown = []
    used: set[str] = set()
    for component in components:
        resolved = component.license
        if resolved.upper() == "UNKNOWN":
            resolved = reviewed.get(component.name, "UNKNOWN")
            used.add(component.name)
        if resolved.upper() == "UNKNOWN":
            unknown.append(f"{component.ecosystem}:{component.name} {component.version}")
        names[component] = resolved
    if unknown:
        raise NoticeError(
            "these components have no known licence; read them and list them under licenses in scripts/licenses/reviewed.json: " + ", ".join(unknown)
        )
    stale = sorted(set(reviewed) - used)
    if stale:
        raise NoticeError(
            "reviewed.json names components whose licence is not unknown (or that are not shipped); delete the entry so it cannot hide a change: "
            + ", ".join(stale)
        )
    bare = sorted(f"{c.ecosystem}:{c.name}" for c in components if not c.texts and c.name not in no_text_ok)
    if bare:
        raise NoticeError(
            "these components ship no licence text (MIT, BSD and Apache require it to travel); add the text or list the name under noText in reviewed.json: "
            + ", ".join(bare)
        )

    out = [f"THIRD-PARTY NOTICES\nnarration-utils {version}\n"]
    out.append(_section("The program and where its source is"))
    out.append(
        f"narration-utils is free software under the {PROGRAM_LICENSE} licence (the full text is at the end of this file).\n"
        f"Source offer: the complete corresponding source of this release is published at {REPOSITORY}, at {where}\n"
        f"(a release candidate is tagged v{version}-rc, the promoted release v{version}). Anyone who receives this program may fetch it there, or ask for it by opening an\n"
        f"issue at {REPOSITORY}/issues. The version and the tag are the same as the ones the program prints with --version.\n"
    )
    copyleft = [c for c in components if is_copyleft(names[c])]
    out.append(_section("Copyleft components"))
    if copyleft:
        out.append(
            "These components are under a copyleft licence. Narration Utils is itself AGPL-3.0-or-later, so they are used under terms it\n"
            "is compatible with, and their source is available: from the address on each entry, at the version named there, and with this\n"
            "program's own source above.\n\n" + "\n".join(f"  - {c.name} {c.version}: {names[c]}" for c in copyleft) + "\n"
        )
    else:
        out.append("None in this release.\n")
    for ecosystem, title in (
        ("python", "Python packages in the frozen sidecars"),
        ("npm", "JavaScript packages in the interface"),
        ("go", "Go modules in the program"),
        ("manual", "Other components"),
    ):
        group = [c for c in components if c.ecosystem == ecosystem]
        if not group:
            continue
        out.append(_section(f"{title} ({len(group)})"))
        out.append("\n".join(_entry(c, names[c]) for c in group))
    out.append(_section("Models and voices: downloaded only when you ask, not in this package"))
    if catalogs:
        out.append(
            "Each is fetched from the address below after you confirm, checked against a fixed size and SHA-256, and kept in your own\n"
            "cache. The licence shown is the one its publisher gives it.\n\n"
        )
        for item in catalogs:
            out.append(
                f"  - {item.get('provider', '')}/{item.get('id', '')} {item.get('version', '')}: {item.get('license', '')} ({item.get('publisher', '')}); {item.get('licenseUrl', '')}\n"
            )
    else:
        out.append("None.\n")
    out.append(_section(f"{PROGRAM_LICENSE}: the licence of narration-utils"))
    out.append(program_license.strip() + "\n")
    return "".join(out)


def read_catalogs(config_dir: Path) -> list[dict]:
    items: list[dict] = []
    for name, key in (("whisper-assets.json", "models"), ("tts-assets.json", "voices"), ("spacy-assets.json", "models"), ("moonshine-assets.json", "models")):
        path = config_dir / name
        if path.is_file():
            items.extend(json.loads(path.read_text(encoding="utf-8")).get(key, []))
    return items


def manual_components(path: Path) -> list[Component]:
    if not path.is_file():
        return []
    entries = json.loads(path.read_text(encoding="utf-8"))
    missing = [e.get("name", "?") for e in entries if not all(e.get(key) for key in ("name", "license", "note"))]
    if missing:
        raise NoticeError(f"scripts/licenses/manual.json entries need a name, a license and a note: {', '.join(missing)}")
    return [Component("manual", e["name"], e.get("version", ""), e["license"], e.get("homepage", ""), (e["note"],), e.get("source", "")) for e in entries]


def read_reviewed(path: Path) -> tuple[dict[str, str], set[str], frozenset[str]]:
    """The decisions a person recorded: licences of components whose own metadata names none, components that ship no text (each with its
    reason), modules that are ours."""
    if not path.is_file():
        return {}, set(), frozenset()
    data = json.loads(path.read_text(encoding="utf-8"))
    no_text = dict(data.get("noText", {}))
    unexplained = sorted(name for name, reason in no_text.items() if not str(reason).strip())
    if unexplained:
        raise NoticeError("reviewed.json lists these under noText without a reason: " + ", ".join(unexplained))
    return dict(data.get("licenses", {})), set(no_text), frozenset(data.get("ignoredModules", []))


def build(root: Path, version: str, release_build: Path, tag: str | None = None, commit: str | None = None) -> str:
    """The whole report. Anything that would make it wrong or incomplete raises NoticeError instead."""
    reviewed, no_text_ok, ignored_modules = read_reviewed(Path(__file__).parent / "reviewed.json")
    python, vendored = python_components(release_build, ignored_modules)
    components = [*python, *npm_components(root / "apps/ui"), *go_components(root / "apps/desktop"), *manual_components(Path(__file__).parent / "manual.json")]
    check_vendored(vendored, components)
    problems = {
        "python": missing_direct("python", components, set(SHIPPED_PYTHON_DIRECT)),
        "npm": missing_direct("npm", components, set(json.loads((root / "apps/ui/package.json").read_text(encoding="utf-8")).get("dependencies", {}))),
        "go": missing_direct(
            "go", components, go_direct_requirements((root / "apps/desktop/go.mod").read_text(encoding="utf-8")) - {"github.com/giraffesyo/pdf"}
        ),
    }
    for ecosystem, names in problems.items():
        if names:
            raise NoticeError(f"the {ecosystem} report is missing direct dependencies: {', '.join(sorted(names))}")
    return render_report(
        version=version,
        components=components,
        program_license=(root / "LICENSE").read_text(encoding="utf-8"),
        catalogs=read_catalogs(root / "config"),
        reviewed=reviewed,
        tag=tag,
        commit=commit,
        no_text_ok=no_text_ok,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--version", required=True, help="the release version, for example 0.1.0")
    parser.add_argument("--tag", help="the git tag this release is built from (default v<version>; a release candidate is v<version>-rc)")
    parser.add_argument("--commit", help="the git commit the release is built from; a release candidate's tag is pruned later, the commit stays")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--release-build", type=Path, default=Path(".release-build"), help="where scripts/release/prepare-resources.py froze the sidecars")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args(argv)
    try:
        text = build(args.root, args.version, args.release_build, args.tag, args.commit)
    except NoticeError as error:
        print(f"notices: {error}", file=sys.stderr)
        return 1
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    print(f"notices: wrote {args.out} ({len(text.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
