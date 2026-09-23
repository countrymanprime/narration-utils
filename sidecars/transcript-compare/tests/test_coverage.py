"""Tests for the recording-coverage model (`core/coverage.py`), the PRD's Definitions made
executable: `docs/prds/recording-coverage-analysis.prd.md` Phase 2, Q1, Q3 and Q11."""

import difflib

import pytest
from coverage_spike import compare, cov


def _aligned(paragraphs, said, heading="", opcodes=None):
    """An AlignedChapter from plain words: paragraphs is a list of strings, said is the transcript."""
    doc, owner = [], []
    for word in heading.split():
        doc.append(word)
        owner.append(cov.HEADING)
    for index, text in enumerate(paragraphs):
        for word in text.split():
            doc.append(word)
            owner.append(index)
    audio = said.split()
    if opcodes is None:
        opcodes = difflib.SequenceMatcher(None, doc, audio, autojunk=False).get_opcodes()
    ids = tuple(f"p-{index + 1:06d}" for index in range(len(paragraphs)))
    return cov.AlignedChapter(tuple(doc), tuple(doc), tuple(owner), ids, tuple(audio), tuple(tuple(op) for op in opcodes))


P1 = "alpha bravo charlie delta echo foxtrot"
P2 = "golf hotel india juliet kilo lima"
P3 = "mike november oscar papa quebec romeo"


def test_a_complete_read_is_all_present_with_no_regions():
    result = cov.compute_coverage(_aligned([P1, P2, P3], f"{P1} {P2} {P3}"))
    assert (result.body_tokens, result.present_tokens, result.missing_tokens, result.extra_tokens) == (18, 18, 0, 0)
    assert result.present_fraction == 1.0
    assert result.regions == ()
    assert result.longest_missing_run == 0
    assert result.text_complete(cov.Thresholds())


def test_an_unread_tail_is_a_tail_region_naming_its_paragraph_and_words():
    aligned = _aligned([P1, P2, P3], f"{P1} {P2}")
    result = cov.compute_coverage(aligned)
    (region,) = result.regions
    assert (region.kind, region.paragraph_ids, region.token_count) == ("tail", ("p-000003",), 6)
    assert (region.first_word, region.last_word) == ("mike", "romeo")
    assert (region.doc_start, region.doc_end, region.audio_index) == (12, 18, 12)
    assert result.by_id["p-000003"].present_fraction == 0.0
    assert not result.text_complete(cov.Thresholds())


def test_an_unread_head_is_a_head_region_even_when_the_title_was_read():
    result = cov.compute_coverage(_aligned([P1, P2], f"chapter two {P2}", heading="chapter two"))
    (region,) = result.regions
    assert (region.kind, region.paragraph_ids, region.audio_index) == ("head", ("p-000001",), 0)
    assert result.body_tokens == 12  # the title is not in the denominator


def test_a_paragraph_skipped_inside_the_read_is_a_skip_region():
    result = cov.compute_coverage(_aligned([P1, P2, P3], f"{P1} {P3}"))
    (region,) = result.regions
    assert (region.kind, region.paragraph_ids, region.audio_index) == ("skip", ("p-000002",), 6)
    assert [p.present for p in result.paragraphs] == [6, 0, 6]


def test_a_misread_counts_as_present_and_is_not_extra():
    result = cov.compute_coverage(_aligned([P1, P2], "alpha bravo charlie delta echo foxtrot golf hotel indigo julia kilo lima"))
    assert result.present_tokens == 12
    assert result.extra_tokens == 0
    assert result.text_complete(cov.Thresholds())


def test_a_replacement_longer_than_the_misread_bound_is_different_text():
    unrelated = "one two three four five six seven eight nine ten"
    long_paragraph = "golf hotel india juliet kilo lima xray yankee zulu whiskey"
    result = cov.compute_coverage(_aligned([P1, long_paragraph, P3], f"{P1} {unrelated} {P3}"))
    (region,) = result.regions
    assert (region.kind, region.paragraph_ids, region.token_count) == ("different_text", ("p-000002",), 10)
    assert result.extra_tokens == 10


def test_the_misread_bound_is_a_parameter():
    unrelated = "one two three four five six"
    result = cov.compute_coverage(_aligned([P1, P2, P3], f"{P1} {unrelated} {P3}"), cov.AlignmentParams(max_misread_run=5))
    assert result.regions[0].kind == "different_text"
    assert cov.compute_coverage(_aligned([P1, P2, P3], f"{P1} {unrelated} {P3}")).present_tokens == 18


def test_a_short_read_counts_the_surplus_as_missing():
    result = cov.compute_coverage(_aligned([P1, P2, P3], f"{P1} golf hotel said three {P3}"))
    (region,) = result.regions
    assert (region.kind, region.token_count, region.first_word, region.last_word) == ("short_read", 2, "kilo", "lima")
    assert result.by_id["p-000002"].present == 4


def test_a_short_chance_match_inside_unrelated_speech_does_not_count():
    paragraph = "golf hotel the india juliet kilo lima mike november oscar papa"
    speech = "we will wait until the dog stops barking and carry on now"
    result = cov.compute_coverage(_aligned([P1, paragraph, P3], f"{P1} {speech} {P3}"))
    assert result.by_id["p-000002"].present == 0
    assert [region.kind for region in result.regions] == ["different_text"]


def test_a_short_match_at_the_start_of_the_alignment_is_an_anchor():
    opcodes = [("equal", 0, 2, 0, 2), ("delete", 2, 6, 2, 2)]
    aligned = _aligned(["alpha bravo charlie delta echo foxtrot"], "alpha bravo", opcodes=opcodes)
    result = cov.compute_coverage(aligned)
    assert result.present_tokens == 2
    assert result.regions[0].kind == "tail"


def test_extra_speech_is_counted_and_never_held_against_the_narrator():
    result = cov.compute_coverage(_aligned([P1, P2], f"{P1} sorry let me go again {P2}"))
    assert result.extra_tokens == 5
    assert result.present_tokens == 12
    assert result.text_complete(cov.Thresholds())


def test_an_omitted_title_is_not_missing_and_a_read_title_is_not_extra():
    omitted = cov.compute_coverage(_aligned([P1], P1, heading="chapter one the pool"))
    read = cov.compute_coverage(_aligned([P1], f"chapter one the pool {P1}", heading="chapter one the pool"))
    assert (omitted.regions, omitted.body_tokens, omitted.present_fraction) == ((), 6, 1.0)
    assert (read.regions, read.extra_tokens) == ((), 0)


def test_a_misread_title_is_not_counted_against_the_body():
    result = cov.compute_coverage(_aligned([P1], f"chapter 1 {P1}", heading="chapter i"))
    assert (result.present_tokens, result.extra_tokens, result.regions) == (6, 0, ())


def test_a_large_gap_where_chapter_text_was_read_again_is_a_skip_not_different_text():
    # The narrator re-reads the end of paragraph one, then goes on to paragraph three.
    long_p2 = "golf hotel india juliet kilo lima xray yankee zulu whiskey"
    result = cov.compute_coverage(_aligned([P1, long_p2, P3], f"{P1} charlie delta echo foxtrot {P3}"))
    (region,) = result.regions
    assert region.kind == "skip"


def test_the_missing_run_threshold_separates_a_skipped_block_from_a_dropped_word():
    three = cov.compute_coverage(_aligned([P1 + " " + P2], "alpha bravo charlie golf hotel india juliet kilo lima"))
    assert three.longest_missing_run == 3
    assert three.text_complete(cov.Thresholds(min_paragraph_present=0.5, max_missing_run=3))
    assert not three.text_complete(cov.Thresholds(min_paragraph_present=0.5, max_missing_run=2))


def test_the_paragraph_threshold_applies_on_read():
    result = cov.compute_coverage(_aligned([P1 + " " + P2 + " " + P3], f"{P1} golf hotel india juliet kilo {P3}"))
    assert result.by_id["p-000001"].present_fraction == pytest.approx(17 / 18)
    assert result.by_id["p-000001"].passes(cov.Thresholds(min_paragraph_present=0.9))
    assert not result.by_id["p-000001"].passes(cov.Thresholds(min_paragraph_present=0.95))


def test_a_missing_run_is_counted_across_paragraph_boundaries():
    result = cov.compute_coverage(_aligned([P1, P2, P3], f"alpha bravo charlie delta hotel india juliet kilo lima {P3}"))
    (region,) = result.regions
    assert (region.paragraph_ids, region.first_word, region.last_word) == (("p-000001", "p-000002"), "echo", "golf")
    assert result.by_id["p-000001"].longest_missing_run == result.by_id["p-000002"].longest_missing_run == 3
    assert result.by_id["p-000003"].longest_missing_run == 0


def test_a_short_equal_block_beside_another_equal_block_is_an_anchor():
    # compare.py fuses "sailcloth" against "sail cloth" into an equal block with uneven sides,
    # which then sits between two equal blocks: read text, not a chance match.
    opcodes = [("equal", 0, 2, 0, 2), ("equal", 2, 3, 2, 4), ("equal", 3, 5, 4, 6)]
    aligned = _aligned(["of the sailcloth to sea"], "of the sail cloth to sea", opcodes=opcodes)
    result = cov.compute_coverage(aligned)
    assert (result.present_tokens, result.extra_tokens, result.regions) == (5, 0, ())


def test_nothing_read_is_one_head_region_over_the_whole_chapter():
    result = cov.compute_coverage(_aligned([P1, P2], "something else entirely"))
    assert [(region.kind, region.paragraph_ids) for region in result.regions] == [("head", ("p-000001", "p-000002"))]
    assert result.present_fraction == 0.0


def test_an_empty_chapter_and_an_empty_paragraph_count_as_complete():
    empty = cov.compute_coverage(_aligned([], "anything at all"))
    assert (empty.body_tokens, empty.present_fraction, empty.extra_tokens) == (0, 1.0, 3)
    assert empty.text_complete(cov.Thresholds())
    with_blank = cov.compute_coverage(_aligned([P1, ""], P1))
    assert with_blank.by_id["p-000002"].present_fraction == 1.0


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"doc_words": ("a",)}, "same length"),
        ({"token_paragraph": (5, 0, 0)}, "index paragraph_ids"),
        ({"opcodes": (("equal", 0, 2, 0, 2),)}, "not at the ends"),
        ({"opcodes": (("equal", 0, 3, 0, 3), ("insert", 3, 3, 4, 4))}, "does not continue"),
        ({"opcodes": (("swap", 0, 3, 0, 3),)}, "does not continue"),
        ({"opcodes": (("equal", 0, 3, 0, 0), ("insert", 3, 3, 0, 3))}, "empty side"),
    ],
)
def test_an_inconsistent_alignment_is_rejected(change, message):
    base = {
        "doc_tokens": ("a", "b", "c"),
        "doc_words": ("a", "b", "c"),
        "token_paragraph": (0, 0, 0),
        "paragraph_ids": ("p-000001",),
        "audio_tokens": ("a", "b", "c"),
        "opcodes": (("equal", 0, 3, 0, 3),),
    }
    with pytest.raises(cov.CoverageError, match=message):
        cov.AlignedChapter(**{**base, **change})


@pytest.mark.parametrize(
    ("build", "message"),
    [
        (lambda: cov.AlignmentParams(max_misread_run=-1), "max_misread_run"),
        (lambda: cov.AlignmentParams(min_anchor_run=0), "min_anchor_run"),
        (lambda: cov.Thresholds(min_paragraph_present=1.5), "min_paragraph_present"),
        (lambda: cov.Thresholds(max_missing_run=-2), "max_missing_run"),
    ],
)
def test_out_of_range_parameters_are_rejected(build, message):
    with pytest.raises(cov.CoverageError, match=message):
        build()


def test_the_defaults_are_the_prds_proposed_starting_values():
    assert (cov.Thresholds().min_paragraph_present, cov.Thresholds().max_missing_run) == (0.95, 3)
    assert (cov.AlignmentParams().max_misread_run, cov.AlignmentParams().min_anchor_run) == (8, 3)


# ---------------------------------------------------------------------------
# through compare.py's own alignment: tokenizing, numbers, homophones, hyphens


def _via_compare(title, paragraphs, said):
    chapter = {"title": title, "paragraphs": paragraphs}
    units, tokens, unit_idx, raw_words = compare.build_chapter_units(chapter)
    words = [(word, index * 0.4, index * 0.4 + 0.4) for index, word in enumerate(said.split())]
    _markers, _covered, alignment = compare.diff_and_build_markers(tokens, unit_idx, raw_words, words, 1)
    ids = [f"p-{index + 1:06d}" for index in range(len(paragraphs))]
    return cov.compute_coverage(cov.aligned_chapter_from_markers(alignment, units, ids))


def test_spoken_numbers_homophones_and_split_compounds_are_present():
    paragraphs = ["They're carrying 214 barrels and a notebook to the ship.", "It sailed in 1847, a well-known year."]
    result = _via_compare(
        "Chapter 4", paragraphs, "chapter four their carrying two hundred fourteen barrels and a note book to the ship it sailed in 1847 a well known year"
    )
    assert result.present_tokens == result.body_tokens
    assert (result.regions, result.extra_tokens) == ((), 0)


def test_region_words_are_the_manuscripts_own_words():
    paragraphs = ["The first paragraph is read aloud.", "The second paragraph, sadly, is not."]
    result = _via_compare("Chapter One", paragraphs, "the first paragraph is read aloud")
    (region,) = result.regions
    assert (region.kind, region.first_word, region.last_word) == ("tail", "The", "not.")


def test_a_spoken_subtitle_in_the_heading_is_neither_missing_nor_extra():
    paragraphs = ["Alice was beginning to get very tired of sitting by her sister."]
    result = _via_compare(
        "Chapter I Down the Rabbit-Hole", paragraphs, "chapter one down the rabbit hole alice was beginning to get very tired of sitting by her sister"
    )
    assert (result.present_tokens, result.body_tokens, result.extra_tokens, result.regions) == (12, 12, 0, ())
