"""Shared stderr[+file] logging helper for REAPER package Python backends."""

import sys

_log_file = None


def set_log_file(handle):
    global _log_file
    _log_file = handle


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)
    if _log_file is not None:
        print(message, file=_log_file, flush=True)
