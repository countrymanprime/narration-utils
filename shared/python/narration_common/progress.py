"""Shared stage|pct|message progress-file writer.

Hardened with a retry loop: os.replace() can fail with a sharing violation
on Windows if the destination is open for reading at that exact instant
(the Lua side polls this file many times a second) - retry briefly rather
than silently dropping the update, since a dropped ERROR/DONE/CANCELLED
line means the UI is stuck showing stale progress forever.
"""

import os
import time


def write_progress(progress_path, stage, pct, message):
    if not progress_path:
        return
    progress_path = str(progress_path)
    tmp_path = progress_path + ".tmp"
    line = f"{stage}|{int(max(0, min(100, pct)))}|{message}"

    parent = os.path.dirname(progress_path)
    if parent:
        os.makedirs(parent, exist_ok=True)

    for _attempt in range(8):
        try:
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.write(line + "\n")
            os.replace(tmp_path, progress_path)
            return
        except OSError:
            time.sleep(0.03)

    try:
        with open(progress_path, "w", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass  # progress reporting is best-effort, never fatal
