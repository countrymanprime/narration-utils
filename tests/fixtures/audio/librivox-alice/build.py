"""Build the LibriVox Alice test corpora from the committed recordings: no network, no model, no GPU.

    uv run --project sidecars/transcript-compare python tests/fixtures/audio/librivox-alice/build.py all --out <dir>

writes `<dir>/coverage` (the NARRATION_COVERAGE_CORPUS layout), `<dir>/characters` (the character-continuity
trial's manifest layout) and `<dir>/signal` (defects put into real narration, for NARRATION_SIGNAL_CORPUS). The
output directory must be outside the repository: the built WAVs are large and are never committed. See README.md.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import characters_corpus
import coverage_corpus
import signal_corpus
from alice_text import REPOSITORY, load_chapters
from paragraph_spans import Alignment, align, load_sources

CHARACTER_SOURCES = ("kara_01", "kara_02", "kara_07", "kara_09", "kara_10", "kara_11")


def verify_sources() -> None:
    """Every committed MP3 is the file archive.org publishes, byte for byte."""
    for source in load_sources().values():
        digest = hashlib.sha256((HERE / source["file"]).read_bytes()).hexdigest()
        if digest != source["sha256"]:
            raise SystemExit(f"{source['file']}: sha256 {digest} is not the published file's {source['sha256']}")


def alignments(ids: set[str]) -> dict[str, Alignment]:
    chapters = load_chapters()
    sources = load_sources()
    return {sid: align(sources[sid], chapters[sources[sid]["chapter"]]) for sid in sorted(ids)}


def build_coverage(out: Path) -> None:
    recipes = coverage_corpus.load_recipes()
    ids = {r["source"] for r in recipes} | {p["foreign"]["source"] for r in recipes for i in r["items"] for p in i["pieces"] if "foreign" in p}
    written = coverage_corpus.build(out / "coverage", alignments(ids), recipes)
    print(f"coverage: {len(written)} cases in {out / 'coverage'}")


def build_characters(out: Path) -> None:
    path = characters_corpus.build(out / "characters", list(alignments(set(CHARACTER_SOURCES)).values()))
    print(f"characters: {path}")


def build_signal(out: Path) -> None:
    recipes = signal_corpus.load_recipes()
    path = signal_corpus.build(out / "signal", alignments({r["source"] for r in recipes}), recipes)
    print(f"signal: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("corpus", choices=("all", "coverage", "characters", "signal"))
    parser.add_argument("--out", type=Path, required=True, help="a directory outside the repository")
    args = parser.parse_args()
    out = args.out.resolve()
    if out.is_relative_to(REPOSITORY):
        raise SystemExit(f"{out} is inside the repository; build the corpora somewhere else")
    verify_sources()
    if args.corpus in ("all", "coverage"):
        build_coverage(out)
    if args.corpus in ("all", "characters"):
        build_characters(out)
    if args.corpus in ("all", "signal"):
        build_signal(out)


if __name__ == "__main__":
    main()
