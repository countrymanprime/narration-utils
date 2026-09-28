"""Build the LibriVox Alice test corpora: fetch the recordings from archive.org, then cut and mix them.

    uv run --project sidecars/transcript-compare python tests/fixtures/audio/librivox-alice/build.py all --out <dir>

fetches any missing recording into the sources directory (NARRATION_LIBRIVOX_DIR, or ~/.cache/narration-utils/librivox-alice),
checks each against its pinned SHA-256, and writes `<dir>/coverage` (the NARRATION_COVERAGE_CORPUS layout),
`<dir>/characters` (the character-continuity trial's manifest layout) and `<dir>/signal` (defects put into real
narration, for NARRATION_SIGNAL_CORPUS). `fetch` only downloads; `markers` rewrites the committed
`alignment/*.markers.json` from the recordings. The output directory must be outside the repository. See README.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import characters_corpus
import coverage_corpus
import signal_corpus
from alice_text import REPOSITORY, load_chapters
from paragraph_spans import Alignment, align, markers_json
from sources import fetch, load_sources, sources_dir

CHARACTER_SOURCES = ("kara_01", "kara_02", "kara_07", "kara_09", "kara_10", "kara_11")


def alignments(ids: set[str], directory: Path) -> dict[str, Alignment]:
    fetch(directory, ids)
    chapters = load_chapters()
    sources = load_sources()
    return {sid: align(sources[sid], chapters[sources[sid]["chapter"]], directory) for sid in sorted(ids)}


def build_coverage(out: Path, directory: Path) -> None:
    recipes = coverage_corpus.load_recipes()
    foreign = {p["foreign"]["source"] for r in recipes for i in r["items"] for p in i["pieces"] if "foreign" in p}
    written = coverage_corpus.build(out / "coverage", alignments({r["source"] for r in recipes} | foreign, directory), recipes)
    print(f"coverage: {len(written)} cases in {out / 'coverage'}")


def build_characters(out: Path, directory: Path) -> None:
    path = characters_corpus.build(out / "characters", list(alignments(set(CHARACTER_SOURCES), directory).values()))
    print(f"characters: {path}")


def build_signal(out: Path, directory: Path) -> None:
    recipes = signal_corpus.load_recipes()
    path = signal_corpus.build(out / "signal", alignments({r["source"] for r in recipes}, directory), recipes)
    print(f"signal: {path}")


def write_markers(directory: Path) -> None:
    for sid, alignment in alignments(set(load_sources()), directory).items():
        target = HERE / "alignment" / f"{sid}.markers.json"
        target.write_text(json.dumps(markers_json(alignment), indent=1) + "\n", encoding="utf-8", newline="\n")
        print(f"markers: {target.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("all", "coverage", "characters", "signal", "fetch", "markers"))
    parser.add_argument("--out", type=Path, help="where the corpora go: a directory outside the repository")
    parser.add_argument("--sources", type=Path, default=None, help="where the recordings are kept (default: $NARRATION_LIBRIVOX_DIR or the user cache)")
    args = parser.parse_args()
    directory = (args.sources or sources_dir()).resolve()
    if args.command == "fetch":
        fetch(directory)
        print(f"recordings in {directory}")
        return
    if args.command == "markers":
        write_markers(directory)
        return
    if args.out is None:
        parser.error("--out is required to build a corpus")
    out = args.out.resolve()
    if out.is_relative_to(REPOSITORY):
        raise SystemExit(f"{out} is inside the repository; build the corpora somewhere else")
    if args.command in ("all", "coverage"):
        build_coverage(out, directory)
    if args.command in ("all", "characters"):
        build_characters(out, directory)
    if args.command in ("all", "signal"):
        build_signal(out, directory)


if __name__ == "__main__":
    main()
