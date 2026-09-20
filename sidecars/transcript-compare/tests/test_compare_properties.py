"""Property tests for Transcript Compare's text handling (tokenizing, number merging, sentences).

These functions turn a manuscript and a Whisper transcript into the token lists that get aligned,
so a lost character or a shifted index map shows up later as a bogus MISREAD in the diff.
"""

import importlib.util
import re
from pathlib import Path

from hypothesis import given
from hypothesis import strategies as st

COMPARE_PATH = Path(__file__).resolve().parents[1] / "core" / "compare.py"
SPEC = importlib.util.spec_from_file_location("transcript_compare_properties", COMPARE_PATH)
compare = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(compare)

NUMBER_TOKEN = st.sampled_from(sorted(compare.NUMBER_WORDS) + ["and"])
PLAIN_TOKEN = st.text(alphabet="abcdefg", min_size=1, max_size=5)
TOKENS = st.lists(NUMBER_TOKEN | PLAIN_TOKEN, max_size=14)


@given(st.text(max_size=80))
def test_tokenize_yields_only_lowercase_word_tokens_and_never_raises(text):
    for token in compare.tokenize(text):
        assert re.fullmatch(r"[a-z0-9']+", token), token


@given(st.text(max_size=80))
def test_each_token_keeps_the_raw_word_it_came_from(text):
    tokens, raw_words = compare.tokenize_with_raw(text)
    assert len(tokens) == len(raw_words)
    assert tokens == [token for raw in text.split() for token in compare.tokenize(raw)]
    assert all(raw in text.split() for raw in raw_words)


@given(TOKENS)
def test_merging_number_words_keeps_the_index_map_aligned_and_ordinary_tokens_intact(tokens):
    index_map = list(range(len(tokens)))
    merged, merged_map = compare.merge_number_words(tokens, index_map)
    assert len(merged) == len(merged_map) <= len(tokens)
    assert merged_map == sorted(merged_map), "the map never moves backwards"
    assert all(0 <= index < len(tokens) for index in merged_map)
    for token, index in zip(merged, merged_map):
        if token.isdigit():
            assert tokens[index] in compare.NUMBER_WORDS, "a digit token points at the first number word it replaced"
        else:
            assert token == tokens[index], "any other token is passed through untouched"


@given(st.lists(PLAIN_TOKEN, max_size=14))
def test_text_with_no_number_words_is_not_changed_by_merging(tokens):
    index_map = list(range(len(tokens)))
    assert compare.merge_number_words(tokens, index_map) == (tokens, index_map)


SENTENCE_PIECES = st.sampled_from(["Mr.", "Dr.", "Mt.", "end.", "yes!", "who?", "word", "more", "etc.", "\u201cquote.\u201d"])
SEPARATORS = st.sampled_from([" ", "  ", "\n", " \t "])
SENTENCE_TEXT = st.lists(st.tuples(SENTENCE_PIECES, SEPARATORS), max_size=20).map(lambda pieces: "".join(piece + separator for piece, separator in pieces))


@given(st.text(max_size=120) | SENTENCE_TEXT)
def test_splitting_sentences_loses_and_reorders_no_characters(text):
    sentences = compare.split_sentences(text)
    assert "".join("".join(sentence.split()) for sentence in sentences) == "".join(text.split())
    assert all(sentence.strip() == sentence and sentence for sentence in sentences), "sentences are trimmed and non-empty"


@given(SENTENCE_TEXT)
def test_an_abbreviation_never_ends_a_sentence_by_itself(text):
    for sentence in compare.split_sentences(text)[:-1]:
        last = compare.tokenize(sentence)[-1:]
        assert not (last and last[0] in compare.ABBREVIATIONS and sentence.endswith(".")), sentence


def test_spelled_out_numbers_merge_into_their_digit_value():
    for words, digits in [("one", "1"), ("twenty three", "23"), ("one hundred and five", "105"), ("two thousand", "2000")]:
        tokens = words.split()
        assert compare.merge_number_words(tokens, list(range(len(tokens)))) == ([digits], [0]), words
