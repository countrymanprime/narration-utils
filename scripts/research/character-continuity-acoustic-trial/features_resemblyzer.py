"""Resemblyzer embeddings (candidate 5, local-dependency-evaluation.md), for the trial's
blind comparison. Optional: importing this module raises ImportError when `resemblyzer`
(and its required `torch`) is not installed - see
docs/research/character-continuity-acoustic-trial.md "PyTorch and Windows-build
verification" for whether it installed in this sandbox and what that implies for ADR 0008.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav

_encoder: VoiceEncoder | None = None


def _get_encoder() -> VoiceEncoder:
    global _encoder
    if _encoder is None:
        _encoder = VoiceEncoder()
    return _encoder


@dataclass
class ResemblyzerClipFeatures:
    path: str
    embedding: np.ndarray  # 256-d


def extract(path: Path) -> ResemblyzerClipFeatures:
    wav = preprocess_wav(str(path))
    embedding = _get_encoder().embed_utterance(wav)
    return ResemblyzerClipFeatures(path=str(path), embedding=embedding)
