"""Shared manuscript-picker entry point for every DAW's Select Manuscript
action. See narration_common/manuscript.py for the actual pick/copy/remember
logic - this is just the CLI shell around it.
"""

import argparse
from pathlib import Path

from narration_common.manuscript import pick_and_cache_manuscript


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    select_parser = sub.add_parser("select")
    select_parser.add_argument("--project-folder", default="")
    select_parser.add_argument("--status-out", required=True)
    args = parser.parse_args()

    if args.command == "select":
        # Writes the raw picked path on success (the caller needs it even
        # when there's no project folder to copy into - see
        # narration_common/manuscript.py), or the literal CANCELLED.
        picked = pick_and_cache_manuscript(args.project_folder)
        Path(args.status_out).write_text((picked + "\n") if picked else "CANCELLED\n", encoding="utf-8")


if __name__ == "__main__":
    main()
