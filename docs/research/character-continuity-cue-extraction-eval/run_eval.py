"""Labeled-quote evaluation for character-continuity-review.prd.md Phase 2, Q4 ("How are dialogue lines
attributed to characters?"). Reports precision/recall of the rules-based cue extractor
(sidecars/manuscript-guide/core/manuscript_guide.py: extract_dialogue_cues) against a hand-labeled corpus.

Corpus: an original, synthetic manuscript written for this evaluation (no real or copyrighted text), covering
the PRD's three required scenarios (ambiguous cues, overlapping/alternating speakers, missing cues) plus a
three-or-more-speaker scene and an unnamed incidental speaker. Provenance: authored by this worker
(narration-utils agent train, stream N-B25) specifically for this evaluation; not derived from any source text.
Synthetic-data fallback follows the precedent already recorded on #509 (D70/D71) for this PRD's phase 1 trial.

Each paragraph's quotes are labeled in the order `extract_cues_from_text` encounters them (regex reading
order). A label is either the true speaker's canonical name, or "unknown" for a quote that a careful human
reader could not confidently attribute either (no tag, three or more active speakers, or an incidental speaker
who was never named as a Character entity) - the tool returning "unknown" there is correct, not a miss.

Run: `uv run --project ../../../sidecars/manuscript-guide python run_eval.py` from this directory.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[3] / "sidecars" / "manuscript-guide" / "core" / "manuscript_guide.py"
SPEC = importlib.util.spec_from_file_location("manuscript_guide", MODULE_PATH)
guide = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(guide)

UNKNOWN = "unknown"

# (chapterId, paragraphId, text, [true speaker per quote, in reading order])
#
# Ground truth reflects Q4's approved scope exactly (name-tag or alias adjacent to a speech verb, plus
# per-scene continuation between exactly two active speakers) - not a human reader's full understanding of the
# scene. A quote tagged only by a pronoun ("she said") is deliberately labeled "unknown" here: pronoun
# resolution is explicitly out of scope for this rules-based extractor (Q4's recommendation lists quote spans,
# name/alias tags and per-scene continuation only), so leaving it unknown is the extractor working as designed,
# not a miss - narrator correction (Phase 6) is the intended path for exactly this case. One deliberate example
# (p9) is kept to document that boundary explicitly rather than avoid it.
CORPUS: list[tuple[str, str, str, list[str]]] = [
    # Chapter 1, scene 1: a clean two-person exchange - every quote either name-tagged or a two-person continuation.
    ("c1", "p1", 'Mira crossed the room. "You are late again," Mira said.', ["Mira"]),
    ("c1", "p2", '"The tide held me up," Toby replied, dripping onto the floorboards.', ["Toby"]),
    ("c1", "p3", '"That is what you said last week."', ["Mira"]),  # continuation: alternates from Toby back to Mira
    ("c1", "p4", '"Was it," Toby said, not quite a question.', ["Toby"]),
    ("c1", "p5", '"It was." Mira folded her arms.', ["Mira"]),  # continuation again
    ("c1", "p6", '"Fine. I will be early tomorrow," Toby answered.', ["Toby"]),
    ("c1", "p7", '"See that you are."', ["Mira"]),  # continuation
    ("c1", "p8", 'Toby laughed. "You always get the last word," Toby said.', ["Toby"]),
    # p9's tag is a pronoun ("she said") - the extractor cannot resolve it directly (out of scope by design,
    # see the note above) but two-person continuation recovers the right answer anyway, since Mira and Toby
    # are already the only two active speakers in this scene.
    ("c1", "p9", '"Someone has to," she said.', ["Mira"]),
    ("c1", "p10", '"Fair enough."', ["Toby"]),  # continuation
    # scene break
    ("c1", "p11", "* * *", []),
    # Chapter 1, scene 2: a third character (Elena) joins - untagged lines from here are genuinely ambiguous.
    ("c1", "p12", 'Elena arrived breathless. "Did I miss something?" Elena asked.', ["Elena"]),
    ("c1", "p13", '"Only the usual," Mira said.', ["Mira"]),
    # A known limitation, kept deliberately rather than avoided: continuation only knows about speakers
    # established SO FAR in the scene. Toby has not spoken yet at this point, so the mechanism sees only two
    # active speakers (Elena, Mira) and resolves this line by alternation - even though a human reader, seeing
    # the whole scene, knows a third person (Toby) is also present and this line is genuinely ambiguous.
    ("c1", "p14", '"The usual being?"', [UNKNOWN]),
    ("c1", "p15", '"Nothing," Toby said quickly.', ["Toby"]),
    ("c1", "p16", '"That did not sound like nothing."', [UNKNOWN]),  # three active speakers (Elena, Mira, Toby), no tag
    ("c1", "p17", '"It never does," Elena said, grinning.', ["Elena"]),
    # Chapter 2, scene 1: a title-prefixed alias, and a case with no dialogue at all.
    ("c2", "p18", "Captain Arelian gave the order before dawn. Dawn Mercer double-checked the charts.", []),
    ("c2", "p19", '"Hold the line," Arelian shouted over the wind.', ["Captain Arelian"]),
    ("c2", "p20", '"Holding," Dawn Mercer answered, voice steady.', ["Dawn Mercer"]),
    ("c2", "p21", '"Good," Arelian said.', ["Captain Arelian"]),
    ("c2", "p22", '"For how long?"', ["Dawn Mercer"]),  # continuation, exactly two active speakers
    ("c2", "p23", '"As long as it takes," Arelian replied.', ["Captain Arelian"]),
    ("c2", "p24", '"That is not an answer."', ["Dawn Mercer"]),  # continuation
    ("c2", "p25", '"It rarely is," Arelian said, and said nothing more.', ["Captain Arelian"]),
    # scene break: a new scene (the market) must not inherit the ship dialogue's active speakers.
    ("c2", "p25b", "- - -", []),
    # Chapter 2, scene 2: an incidental, unnamed speaker - never became a Character entity, so unknown is correct.
    ("c2", "p26", '"Fresh bread, hot bread," the merchant called from his stall.', [UNKNOWN]),
    ("c2", "p27", 'Dawn Mercer bought two loaves without breaking stride. "Keep the change," Dawn Mercer said.', ["Dawn Mercer"]),
    # Chapter 3: a truly ambiguous quote (no tag, no prior speaker to alternate from) and a missing-cue paragraph.
    ("c3", "p28", '"Perhaps," came a voice from the dark, "you should not have come at all."', [UNKNOWN, UNKNOWN]),
    ("c3", "p29", "Mira walked the length of the corridor twice before she found the door.", []),  # no quotes: a missing cue
    ("c3", "p30", '"Elena?" Mira called out.', ["Mira"]),
    ("c3", "p31", '"Here," Elena answered from behind a stack of crates.', ["Elena"]),
    ("c3", "p32", '"You scared me half to death."', ["Mira"]),  # continuation, two active (Mira, Elena)
    ("c3", "p33", '"That was not my intention," Elena said, though she was smiling.', ["Elena"]),
]

CHARACTERS = ["Mira", "Toby", "Elena", "Captain Arelian", "Dawn Mercer"]


def main() -> None:
    paragraphs = [{"chapterId": chapter_id, "paragraphId": paragraph_id, "chapter": chapter_id, "text": text} for chapter_id, paragraph_id, text, _ in CORPUS]
    character_index = {guide.normalize_name(name): guide.entity_id(name) for name in CHARACTERS}
    character_index[guide.normalize_name("Arelian")] = guide.entity_id("Captain Arelian")  # the alias, as a real build would register it
    id_to_name = {guide.entity_id(name): name for name in CHARACTERS}

    cues = guide.extract_dialogue_cues(paragraphs, character_index)
    by_paragraph: dict[str, list[dict]] = {}
    for cue in cues:
        by_paragraph.setdefault(cue["paragraphId"], []).append(cue)

    total_quotes = 0
    determinable = 0
    attempted = 0
    correct_attempts = 0
    wrong_attempts = 0
    correctly_left_unknown = 0
    missed_determinable = 0
    rows = []

    for chapter_id, paragraph_id, _text, expected_speakers in CORPUS:
        actual_cues = by_paragraph.get(paragraph_id, [])
        if len(actual_cues) != len(expected_speakers):
            raise AssertionError(f"{paragraph_id}: expected {len(expected_speakers)} quotes, extractor found {len(actual_cues)}")
        for expected, cue in zip(expected_speakers, actual_cues, strict=True):
            total_quotes += 1
            got_id = cue["speaker_entity_id"]
            got_name = id_to_name.get(got_id, UNKNOWN) if got_id else UNKNOWN
            if expected == UNKNOWN:
                if got_name == UNKNOWN:
                    correctly_left_unknown += 1
                else:
                    wrong_attempts += 1
                    attempted += 1
            else:
                determinable += 1
                if got_name == UNKNOWN:
                    missed_determinable += 1
                else:
                    attempted += 1
                    if got_name == expected:
                        correct_attempts += 1
                    else:
                        wrong_attempts += 1
            rows.append({"paragraphId": paragraph_id, "quote": cue["quote_text"], "expected": expected, "got": got_name, "source": cue["speaker_source"]})

    precision = correct_attempts / attempted if attempted else float("nan")
    recall = correct_attempts / determinable if determinable else float("nan")
    unknown_precision = correctly_left_unknown / (total_quotes - determinable) if (total_quotes - determinable) else float("nan")

    report = {
        "total_quotes": total_quotes,
        "determinable_quotes": determinable,
        "genuinely_ambiguous_quotes": total_quotes - determinable,
        "attempted_attributions": attempted,
        "correct_attributions": correct_attempts,
        "wrong_attributions": wrong_attempts,
        "missed_determinable_left_unknown": missed_determinable,
        "correctly_left_unknown": correctly_left_unknown,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "unknown_correctness_rate": round(unknown_precision, 4),
    }
    print(json.dumps(report, indent=2))
    if "--rows" in sys.argv:
        for row in rows:
            print(json.dumps(row))


if __name__ == "__main__":
    main()
