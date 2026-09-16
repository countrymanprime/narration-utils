import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[3] / "tools" / "transcript-compare" / "core" / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare", MODULE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(compare)


class TranscriptCompareContextTests(unittest.TestCase):
    def test_marker_contexts_are_compact_and_centered_on_their_own_difference(self):
        script = "amber birch cedar dogwood elm fir gingko hazel ivy juniper kapok linden looked sexier when you lit it like a strip club bathroom"
        heard = "amber birch cedar dogwood elm fir gingko hazel ivy juniper kapok linden looks sexier when you lit it up like a strip club bathroom"
        chapter_tokens, raw_words = compare.tokenize_with_raw(script)
        transcript_words = [(word, float(index), float(index) + 0.5) for index, word in enumerate(heard.split())]

        markers, _covered, alignment = compare.diff_and_build_markers(
            chapter_tokens,
            [0] * len(chapter_tokens),
            raw_words,
            transcript_words,
            min_words=1,
        )

        contexts = {}
        for _time, kind, _name, _doc_text, audio_text, _unit, i1, i2, j1, j2 in markers:
            contexts[(kind, audio_text)] = compare.build_marker_context(
                i1,
                i2,
                j1,
                j2,
                alignment["unit_idx"],
                alignment["opcodes"],
                alignment["index_map"],
                alignment["chapter_index_map"],
                alignment["chapter_raw_words"],
                transcript_words,
            )

        misread_script, misread_heard = contexts[("MISREAD", "looks")]
        extra_script, extra_heard = contexts[("EXTRA", "up")]

        self.assertEqual("... gingko hazel ivy juniper kapok linden looked sexier when you lit it like ...", misread_script)
        self.assertEqual("... gingko hazel ivy juniper kapok linden looks sexier when you lit it up like ...", misread_heard)
        self.assertEqual("... looked sexier when you lit it like a strip club bathroom", extra_script)
        self.assertEqual("... looks sexier when you lit it up like a strip club bathroom", extra_heard)
        self.assertNotIn("amber birch cedar", misread_script)

    def test_marker_context_clips_at_sentence_edges_without_ellipsis(self):
        script = "looked bright amber birch cedar dogwood elm"
        heard = "looks bright amber birch cedar dogwood elm"
        chapter_tokens, raw_words = compare.tokenize_with_raw(script)
        transcript_words = [(word, float(index), float(index) + 0.5) for index, word in enumerate(heard.split())]
        markers, _covered, alignment = compare.diff_and_build_markers(chapter_tokens, [0] * len(chapter_tokens), raw_words, transcript_words, min_words=1)
        _time, _kind, _name, _doc_text, _audio_text, _unit, i1, i2, j1, j2 = markers[0]

        script_context, heard_context = compare.build_marker_context(
            i1,
            i2,
            j1,
            j2,
            alignment["unit_idx"],
            alignment["opcodes"],
            alignment["index_map"],
            alignment["chapter_index_map"],
            alignment["chapter_raw_words"],
            transcript_words,
        )

        self.assertEqual(script, script_context)
        self.assertEqual(heard, heard_context)


if __name__ == "__main__":
    unittest.main()
