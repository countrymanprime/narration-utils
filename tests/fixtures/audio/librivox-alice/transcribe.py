"""Write the committed word timings in `alignment/` for every source recording (maintainer step).

Needs faster-whisper and a local model directory; nothing else in this folder does. The timings are
committed so the corpora can be rebuilt on any machine without a model, a GPU or network access.

    uv run --project sidecars/transcript-compare python tests/fixtures/audio/librivox-alice/transcribe.py \
        --model %LOCALAPPDATA%/narration-utils/assets/whisper/faster-whisper/large-v3-turbo
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sources import fetch, sources_dir

HERE = Path(__file__).resolve().parent


def transcribe(model_dir: Path, device: str, only: list[str]) -> None:
    from faster_whisper import WhisperModel

    directory = sources_dir()
    fetch(directory, set(only) or None)
    sources = json.loads((HERE / "sources.json").read_text(encoding="utf-8"))["sources"]
    model = WhisperModel(str(model_dir), device=device, compute_type="float16" if device == "cuda" else "int8", cpu_threads=16)
    # The app's asset folders keep each model in a folder named by its revision hash.
    model_name = model_dir.parent.name if len(model_dir.name) == 40 else model_dir.name
    (HERE / "alignment").mkdir(exist_ok=True)
    for source in sources:
        if only and source["id"] not in only:
            continue
        segments, _ = model.transcribe(
            str(directory / source["file"]),
            language="en",
            word_timestamps=True,
            condition_on_previous_text=False,
            beam_size=5,
        )
        words = [[word.word.strip(), round(word.start, 2), round(word.end, 2)] for segment in segments for word in segment.words]
        payload = {"source": source["id"], "model": model_name, "words": words}
        target = HERE / "alignment" / f"{source['id']}.words.json"
        target.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8", newline="\n")
        print(f"{source['id']}: {len(words)} words")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model", type=Path, required=True, help="a faster-whisper model directory")
    parser.add_argument("--device", default="cpu", choices=("cuda", "cpu"))
    parser.add_argument("--only", nargs="*", default=[], help="source ids to (re)transcribe")
    args = parser.parse_args()
    transcribe(args.model, args.device, args.only)


if __name__ == "__main__":
    main()
