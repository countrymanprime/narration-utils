"""
How a word is said rather than how it is spelt: the equivalences that keep a
speech-recognition transcript from being judged against the manuscript on
spelling alone. Transcript Compare (`sidecars/transcript-compare/core/compare.py`)
and the teleprompter's live flags (`sidecars/manuscript-teleprompter/core/flags.py`)
both use them, so a live flag forgives exactly what the authoritative
comparison forgives (ADR 0105).

The data lives here as Python rather than as a file next to a script: a
PyInstaller freeze bundles an imported module automatically but not a data file
nobody declared, so a frozen sidecar can never silently run without it.
"""

import re

NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
    "hundred": 100,
    "thousand": 1000,
    "million": 1000000,
    "billion": 1000000000,
}

FILLER_WORDS = frozenset({"uh", "um", "umm", "uhh", "erm", "hmm", "mhm", "huh"})

# Whisper sometimes transcribes a correctly-spoken homophone with the wrong
# spelling (heard "your", wrote "you're"). These are not narration errors, so
# each group is canonicalized to its first member before matching.
# Deliberately EXCLUDES one/won, to/too/two, for/four, ate/eight: each has a
# member that is also a NUMBER_WORDS entry, and merge_number_words()
# accumulates *consecutive* number words into one combined value ("twenty two"
# -> 22), so aliasing "won" to "one" could turn an unrelated adjacent number
# into a bogus merge ("she won two races" -> "she one two races" -> one token).
HOMOPHONE_GROUPS: tuple[tuple[str, ...], ...] = (
    ("your", "you're"),
    ("their", "there", "they're"),
    ("its", "it's"),
    ("whose", "who's"),
    ("weather", "whether"),
    ("write", "right"),
    ("here", "hear"),
    ("new", "knew"),
    ("know", "no"),
    ("break", "brake"),
    ("threw", "through"),
    ("passed", "past"),
    ("peace", "piece"),
    ("plain", "plane"),
    ("sea", "see"),
    ("way", "weigh"),
    ("weak", "week"),
    ("which", "witch"),
    ("would", "wood"),
    ("allowed", "aloud"),
    ("bare", "bear"),
    ("board", "bored"),
    ("buy", "by", "bye"),
    ("cell", "sell"),
    ("flower", "flour"),
    ("hole", "whole"),
    ("hour", "our"),
    ("made", "maid"),
    ("mail", "male"),
    ("meat", "meet"),
    ("night", "knight"),
    ("pair", "pear"),
    ("principal", "principle"),
    ("sale", "sail"),
    ("sight", "site", "cite"),
    ("sole", "soul"),
    ("son", "sun"),
    ("stair", "stare"),
    ("steal", "steel"),
    ("tail", "tale"),
    ("waist", "waste"),
    ("wait", "weight"),
    ("miner", "minor"),
    ("miners", "minors"),
    ("vane", "vein"),
    ("vanes", "veins"),
)


def build_canon(groups) -> dict[str, str]:
    """Each word of each group mapped to the group's first member."""
    return {word: group[0] for group in groups for word in group}


HOMOPHONE_CANON = build_canon(HOMOPHONE_GROUPS)

# Typographic ("smart") quotes folded to ASCII: a curly apostrophe is not in
# TOKEN_RE's class, so left alone it splits "yesterday's" into two tokens.
QUOTE_NORMALIZE_TABLE = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‛": "'",
        "ʼ": "'",
        "`": "'",
        "´": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        "‟": '"',
    }
)

TOKEN_RE = re.compile(r"[A-Za-z0-9']+")


def canonical_tokens(text: str) -> list[str]:
    """Lowercase word tokens with quotes folded, hyphens and punctuation as
    separators, homophones canonicalized and a trailing possessive 's folded
    into a plain -s ("sentinel's" and "sentinels" sound the same)."""
    tokens = [token.lower() for token in TOKEN_RE.findall(text.translate(QUOTE_NORMALIZE_TABLE))]
    tokens = [HOMOPHONE_CANON.get(token, token) for token in tokens]
    return [token[:-2] + "s" if token.endswith("'s") and len(token) > 2 else token for token in tokens]


def merge_number_words(tokens, index_map):
    """Collapse runs of spelled-out cardinal numbers into a single digit
    token so e.g. "twenty three" lines up with a transcript's "23", and
    "one" lines up with "1". Digit tokens already present pass through
    unchanged. index_map (parallel to tokens) is carried through, pointing
    each output token at the index of its first constituent input token."""
    out_tokens = []
    out_index_map = []
    n = len(tokens)
    i = 0
    while i < n:
        if tokens[i] in NUMBER_WORDS:
            start = i
            total = 0
            chunk = 0
            j = i
            while j < n:
                tok = tokens[j]
                if tok in NUMBER_WORDS:
                    val = NUMBER_WORDS[tok]
                    if val == 100:
                        chunk = (chunk or 1) * 100
                    elif val >= 1000:
                        total += (chunk or 1) * val
                        chunk = 0
                    else:
                        chunk += val
                    j += 1
                elif tok == "and" and j + 1 < n and tokens[j + 1] in NUMBER_WORDS:
                    j += 1
                else:
                    break
            total += chunk
            out_tokens.append(str(total))
            out_index_map.append(index_map[start])
            i = j
        else:
            out_tokens.append(tokens[i])
            out_index_map.append(index_map[i])
            i += 1
    return out_tokens, out_index_map


def spoken_key(text: str) -> str:
    """One string for how `text` is said: its canonical tokens with numbers
    merged, joined without separators or apostrophes, so "daisy chain" and
    "daisy-chain", "twenty three" and "23", "o clock" and "o'clock", or
    "there" and "their" give the same key."""
    tokens = canonical_tokens(text)
    merged, _ = merge_number_words(tokens, list(range(len(tokens))))
    return "".join(merged).replace("'", "")


def said_the_same(heard: str, written: str) -> bool:
    """Whether `heard` is plausibly a correct reading of `written` that an
    engine or a manuscript merely spelt differently."""
    key = spoken_key(heard)
    return bool(key) and key == spoken_key(written)
