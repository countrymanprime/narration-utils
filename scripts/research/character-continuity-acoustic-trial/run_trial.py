"""Orchestrate the character-continuity acoustic trial: the six-step protocol in
../local-dependency-evaluation.md's "Evaluation protocol", applied to Phase 1 of
docs/prds/character-continuity-review.prd.md.

Usage:
    uv run --with numpy python run_trial.py <corpus_out_dir> [--engines baseline,praat,resemblyzer]

`corpus_out_dir` must be OUTSIDE the repository; this script writes the synthetic corpus
there if it does not already exist, then writes `results.json` and `results.md` beside it
(also outside the repository - see docs/research/character-continuity-acoustic-trial.md).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

import synthetic_corpus
from features_baseline import FEATURE_NAMES, feature_vector
from features_baseline import extract as extract_baseline

MIN_REFERENCE_SWEEP = [1, 2, 3, 5, 999]  # clips; 999 stands for "all available"


def load_or_generate_corpus(out_dir: Path, chapters: int) -> dict:
    manifest_path = out_dir / "manifest.json"
    if not manifest_path.exists():
        manifest = synthetic_corpus.generate_corpus(out_dir, n_chapters=chapters)
        synthetic_corpus.write_manifest(out_dir, manifest)
    return json.loads(manifest_path.read_text(encoding="utf-8"))


def _try_import_praat():
    try:
        import features_praat

        return features_praat
    except ImportError:
        return None


def _try_import_resemblyzer():
    try:
        import features_resemblyzer

        return features_resemblyzer
    except ImportError:
        return None


def zscore_stats(vectors: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    stacked = np.stack(vectors)
    mean = stacked.mean(axis=0)
    std = stacked.std(axis=0)
    std[std < 1e-9] = 1e-9
    return mean, std


def leave_one_chapter_out(lines: list[dict], vectors: dict[str, np.ndarray]) -> dict:
    chapters = sorted({line["chapter"] for line in lines})
    same_char_distances: list[float] = []
    diff_char_distances: list[float] = []
    min_reference_results: dict[int, dict[str, list[float]]] = {n: {"same": [], "diff": []} for n in MIN_REFERENCE_SWEEP}

    for held_out in chapters:
        train_lines = [line for line in lines if line["chapter"] != held_out and line["path"] in vectors]
        test_lines = [line for line in lines if line["chapter"] == held_out and line["path"] in vectors]
        if not train_lines or not test_lines:
            continue

        all_train_vectors = [vectors[line["path"]] for line in train_lines]
        mean, std = zscore_stats(all_train_vectors)

        def normalize(v: np.ndarray, mean: np.ndarray = mean, std: np.ndarray = std) -> np.ndarray:
            return (v - mean) / std

        by_character: dict[str, list[np.ndarray]] = {}
        for line in train_lines:
            by_character.setdefault(line["character"], []).append(normalize(vectors[line["path"]]))

        baselines = {char: np.median(np.stack(vs), axis=0) for char, vs in by_character.items()}

        for test_line in test_lines:
            test_vec = normalize(vectors[test_line["path"]])
            own_char = test_line["character"]
            if own_char not in baselines:
                continue
            for target_char, baseline_vec in baselines.items():
                dist = float(np.linalg.norm(test_vec - baseline_vec))
                if target_char == own_char:
                    same_char_distances.append(dist)
                else:
                    diff_char_distances.append(dist)

            for n_ref in MIN_REFERENCE_SWEEP:
                pool = by_character.get(own_char, [])
                if len(pool) == 0:
                    continue
                capped = pool[: min(n_ref, len(pool))]
                capped_baseline = np.median(np.stack(capped), axis=0)
                min_reference_results[n_ref]["same"].append(float(np.linalg.norm(test_vec - capped_baseline)))
                other_char = next((c for c in baselines if c != own_char), None)
                if other_char is not None:
                    min_reference_results[n_ref]["diff"].append(float(np.linalg.norm(test_vec - baselines[other_char])))

    def summarize(xs: list[float]) -> dict:
        if not xs:
            return {"n": 0}
        arr = np.array(xs)
        return {
            "n": len(xs),
            "median": float(np.median(arr)),
            "p25": float(np.percentile(arr, 25)),
            "p75": float(np.percentile(arr, 75)),
        }

    threshold = None
    false_accept_rate = None
    false_reject_rate = None
    if same_char_distances and diff_char_distances:
        # A conservative threshold: the same-character 90th percentile (Q6's "stable
        # per-narrator threshold"). Flags fire when a candidate's distance to its own
        # baseline exceeds this.
        threshold = float(np.percentile(same_char_distances, 90))
        false_reject_rate = float(np.mean(np.array(same_char_distances) > threshold))
        false_accept_rate = float(np.mean(np.array(diff_char_distances) <= threshold))

    return {
        "same_character": summarize(same_char_distances),
        "different_character": summarize(diff_char_distances),
        "suggested_threshold_p90_same": threshold,
        "false_reject_rate_at_threshold": false_reject_rate,
        "false_accept_rate_at_threshold": false_accept_rate,
        "min_reference_sweep": {str(n): {"same": summarize(v["same"]), "diff": summarize(v["diff"])} for n, v in min_reference_results.items()},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("corpus_dir", type=Path)
    parser.add_argument("--chapters", type=int, default=4)
    args = parser.parse_args()

    corpus_dir = args.corpus_dir
    manifest = load_or_generate_corpus(corpus_dir, args.chapters)
    lines = manifest["lines"]

    baseline_features = {}
    for line in lines:
        wav_path = corpus_dir / line["path"]
        feats = extract_baseline(wav_path)
        vec = feature_vector(feats)
        if vec is not None:
            baseline_features[line["path"]] = vec

    baseline_result = leave_one_chapter_out(lines, baseline_features)

    result: dict = {
        "engines": {"baseline": {"status": "ran", "feature_names": FEATURE_NAMES, "trial": baseline_result}},
        "corpus": {
            "route": manifest.get("route", "unknown"),
            "n_chapters": args.chapters,
            "n_lines": len(lines),
            "characters": sorted({line["character"] for line in lines}),
        },
    }

    praat_mod = _try_import_praat()
    if praat_mod is not None:
        praat_features = {}
        for line in lines:
            wav_path = corpus_dir / line["path"]
            try:
                feats = praat_mod.extract(wav_path)
            except Exception as exc:  # noqa: BLE001 - pragma: no cover, trial diagnostics only
                print(f"praat extract failed for {wav_path}: {exc}", file=sys.stderr)
                continue
            if feats.f0_median is not None:
                vec = np.array(
                    [
                        feats.f0_median,
                        (feats.f0_p90 - feats.f0_p10) if feats.f0_p90 and feats.f0_p10 else 0.0,
                        feats.f1_mean or 0.0,
                        feats.f2_mean or 0.0,
                        feats.f3_mean or 0.0,
                        feats.intensity_mean or 0.0,
                    ]
                )
                praat_features[line["path"]] = vec
        result["engines"]["praat"] = {
            "status": "ran",
            "feature_names": ["f0_median", "f0_range", "f1", "f2", "f3", "intensity"],
            "trial": leave_one_chapter_out(lines, praat_features),
        }
    else:
        result["engines"]["praat"] = {"status": "did_not_install"}

    resemblyzer_mod = _try_import_resemblyzer()
    if resemblyzer_mod is not None:
        embeddings = {}
        for line in lines:
            wav_path = corpus_dir / line["path"]
            try:
                feats = resemblyzer_mod.extract(wav_path)
            except Exception as exc:  # noqa: BLE001 - pragma: no cover, trial diagnostics only
                print(f"resemblyzer extract failed for {wav_path}: {exc}", file=sys.stderr)
                continue
            embeddings[line["path"]] = feats.embedding
        result["engines"]["resemblyzer"] = {
            "status": "ran",
            "feature_names": ["embedding_256"],
            "trial": leave_one_chapter_out(lines, embeddings),
        }
    else:
        result["engines"]["resemblyzer"] = {"status": "did_not_install"}

    out_json = corpus_dir.parent / "results.json"
    out_json.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps(result, indent=2))
    print(f"\nWrote {out_json}")


if __name__ == "__main__":
    main()
