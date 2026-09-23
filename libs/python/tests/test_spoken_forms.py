import importlib.util
from pathlib import Path

import pytest
from narration_common import spoken_forms

COMPARE_PATH = Path(__file__).parents[3] / "sidecars" / "transcript-compare" / "core" / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare_for_spoken_forms", COMPARE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(compare)


def test_homophones_canonicalize_to_the_first_member_of_their_group():
    assert spoken_forms.canonical_tokens("They're there with their bags") == ["their", "their", "with", "their", "bags"]


def test_number_homophones_are_deliberately_absent_so_number_merging_stays_safe():
    for word in ("one", "won", "two", "too", "to", "four", "for", "eight", "ate"):
        assert word not in spoken_forms.HOMOPHONE_CANON


def test_canonical_tokens_fold_curly_apostrophes_possessives_and_split_hyphens():
    assert spoken_forms.canonical_tokens("The sentinel’s so-called post.") == ["the", "sentinels", "so", "called", "post"]


def test_merge_number_words_collapses_runs_and_keeps_the_index_of_the_first_word():
    tokens = ["page", "two", "hundred", "and", "five", "of", "one", "thousand"]

    assert spoken_forms.merge_number_words(tokens, list(range(len(tokens)))) == (["page", "205", "of", "1000"], [0, 1, 5, 6])


@pytest.mark.parametrize(
    ("heard", "written"),
    [
        ("daisy chain", "daisy-chain"),
        ("twenty three", "23"),
        ("there", "their"),
        ("sentinel's", "sentinels"),
        ("Evening", "evening."),
        ("7 o clock", "seven o'clock"),
    ],
)
def test_said_the_same_forgives_spelling_that_does_not_change_what_was_said(heard, written):
    assert spoken_forms.said_the_same(heard, written)


@pytest.mark.parametrize(("heard", "written"), [("cited", "tired"), ("won", "one"), ("", ""), ("lamp", "lump")])
def test_said_the_same_does_not_forgive_a_different_word_or_nothing_at_all(heard, written):
    assert not spoken_forms.said_the_same(heard, written)


def test_filler_words_are_the_hesitations_transcript_compare_drops():
    assert {"uh", "um", "hmm"} <= spoken_forms.FILLER_WORDS
    assert "the" not in spoken_forms.FILLER_WORDS


def test_transcript_compare_reads_the_shared_forms_rather_than_its_own_copy():
    assert compare.NUMBER_WORDS is spoken_forms.NUMBER_WORDS
    assert compare.merge_number_words is spoken_forms.merge_number_words
    assert compare.FILLER_WORDS is spoken_forms.FILLER_WORDS


def test_transcript_compare_tokenizes_exactly_as_it_did_with_its_bundled_homophone_file():
    text = "Your sentinel’s right there, whose weight they're at-the-waist of twenty-three knights."

    assert compare.tokenize(text) == [
        "your",
        "sentinels",
        "write",
        "their",
        "whose",
        "wait",
        "their",
        "at",
        "the",
        "waist",
        "of",
        "twenty",
        "three",
        "knights",
    ]
