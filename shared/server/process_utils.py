"""Starts Python subprocesses without a visible console window.

Ported from shared/hub/WindowsProcess.cs. CREATE_NO_WINDOW only applies on
Windows; elsewhere subprocess already starts without a console.
"""

import subprocess
import sys
import threading

_CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def run(file_name: str, arguments: list[str], working_directory: str | None = None) -> tuple[int, str, str]:
    """Runs a process to completion and captures stdout/stderr."""
    result = subprocess.run(
        [file_name, *arguments],
        cwd=working_directory or None,
        capture_output=True,
        text=True,
        creationflags=_CREATE_NO_WINDOW,
    )
    return result.returncode, result.stdout, result.stderr


class DetachedProcess:
    """Wraps a Popen started with drained (discarded) stdout/stderr."""

    def __init__(self, popen: subprocess.Popen):
        self._popen = popen

    @property
    def has_exited(self) -> bool:
        return self._popen.poll() is not None

    @property
    def exit_code(self) -> int | None:
        return self._popen.returncode

    def request_cancel(self) -> None:
        # Cancellation here is cooperative (a ".cancel" sentinel file the
        # backend polls for), matching Hub.cs's TranscriptCancel - this method
        # exists only for symmetry/future use, not currently called.
        pass


def _drain(stream) -> None:
    for _ in iter(stream.readline, ""):
        pass


def start_detached_silently(file_name: str, arguments: list[str], working_directory: str | None = None) -> DetachedProcess:
    """Starts a detached process and drains its output to prevent pipe-buffer deadlock."""
    popen = subprocess.Popen(
        [file_name, *arguments],
        cwd=working_directory or None,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=_CREATE_NO_WINDOW,
    )
    threading.Thread(target=_drain, args=(popen.stdout,), daemon=True).start()
    threading.Thread(target=_drain, args=(popen.stderr,), daemon=True).start()
    return DetachedProcess(popen)
