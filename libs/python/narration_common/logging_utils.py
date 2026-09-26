"""Shared stderr[+file] logging helper for REAPER package Python backends.

docs/prds/tool-run-logging.prd.md phase 2: every call writes one JSON line — {"ts", "level", "run" (when
NARRATION_RUN_ID is set by the host, internal/process.runEnv), "msg", **fields} — to stderr and, when set_log_file was
called, to the same mirror file the `--log` flag has always written. A plain `log("text")` call still works exactly as
before, at level "info". NARRATION_LOG_LEVEL ("info" unless the host set it to "debug", the same variable
internal/process sets) gates the two levels callers use: a "debug" line is dropped before it is even built, so a
caller does not pay to format one nobody will read. Content is never a field's value (ADR 0251, threat-model row 7a):
ids, counts, hashes, paths and timings only — never manuscript or transcript text.
"""

import json
import os
import sys
from datetime import UTC, datetime

_log_file = None

_LEVELS = {"debug": 10, "info": 20, "warn": 30, "error": 40}


def set_log_file(handle):
    global _log_file
    _log_file = handle


def _threshold() -> int:
    return _LEVELS.get(os.environ.get("NARRATION_LOG_LEVEL", "info"), _LEVELS["info"])


def _timestamp() -> str:
    now = datetime.now(UTC)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def log(message: str, level: str = "info", **fields) -> None:
    if _LEVELS.get(level, _LEVELS["info"]) < _threshold():
        return
    record = {"ts": _timestamp(), "level": level, "msg": message}
    run_id = os.environ.get("NARRATION_RUN_ID")
    if run_id:
        record["run"] = run_id
    record.update(fields)
    line = json.dumps(record, sort_keys=True)
    print(line, file=sys.stderr, flush=True)
    if _log_file is not None:
        print(line, file=_log_file, flush=True)
