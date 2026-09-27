"""Praat features via parselmouth (candidate 6, local-dependency-evaluation.md), for the
trial's blind comparison against the dependency-free baseline. Optional: importing this
module raises ImportError when `praat-parselmouth` is not installed, and the trial runner
treats that as "did not install" rather than a hard failure (the PRD's Phase 1 scope says
"compare ... where they install").

parselmouth is a Python binding that links Praat's own C++ engine in-process; it is GPL-3.0-
or-later (see docs/research/local-dependency-evaluation.md candidate 6), so a shipped
integration would keep Praat a separately installed executable to preserve the process
boundary - this trial script imports it directly only because it is throwaway research code
that is never packaged or shipped.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

import parselmouth


@dataclass
class PraatClipFeatures:
    path: str
    f0_median: float | None
    f0_p10: float | None
    f0_p90: float | None
    f1_mean: float | None
    f2_mean: float | None
    f3_mean: float | None
    intensity_mean: float | None


def extract(path: Path) -> PraatClipFeatures:
    snd = parselmouth.Sound(str(path))
    pitch = snd.to_pitch()
    f0_values = pitch.selected_array["frequency"]
    f0_values = f0_values[f0_values > 0]

    formant = snd.to_formant_burg()
    times = [formant.get_time_from_frame_number(i + 1) for i in range(formant.get_number_of_frames())]
    f1 = [formant.get_value_at_time(1, t) for t in times]
    f2 = [formant.get_value_at_time(2, t) for t in times]
    f3 = [formant.get_value_at_time(3, t) for t in times]
    f1 = [v for v in f1 if not math.isnan(v)]
    f2 = [v for v in f2 if not math.isnan(v)]
    f3 = [v for v in f3 if not math.isnan(v)]

    intensity = snd.to_intensity()
    intensity_values = intensity.values[0]

    def _median(xs):
        import numpy as np

        return float(np.median(xs)) if len(xs) else None

    def _pct(xs, p):
        import numpy as np

        return float(np.percentile(xs, p)) if len(xs) else None

    return PraatClipFeatures(
        path=str(path),
        f0_median=_median(f0_values),
        f0_p10=_pct(f0_values, 10),
        f0_p90=_pct(f0_values, 90),
        f1_mean=_median(f1),
        f2_mean=_median(f2),
        f3_mean=_median(f3),
        intensity_mean=_median(intensity_values),
    )
