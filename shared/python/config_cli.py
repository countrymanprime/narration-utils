"""Non-GUI settings access for values only a DAW's own scripting side
consumes (e.g. REAPER take-marker colors) and can't get simply by invoking
the analysis backend with `--manuscript`.

Writes results to `--out` rather than stdout, matching this repo's existing
file-based IPC convention (progress/log/out files) instead of requiring a
DAW's scripting language to capture subprocess stdout.
"""

import argparse
from pathlib import Path

from narration_common import config


def cmd_get(args: argparse.Namespace) -> None:
    keys = [key for key in args.keys.split(",") if key]
    pairs = []
    for key in keys:
        # hardcoded_default is a throwaway sentinel here, not a real value:
        # a key genuinely resolved to "" (project/global/repo-default tier)
        # is still emitted below, but a key found in NO tier at all is
        # omitted entirely rather than sent as "key=" - the caller's own
        # hardcoded fallback (e.g. Lua's `resolved.key or "small"`) needs to
        # see a missing entry to kick in, not an empty string that would
        # look like a deliberately-configured empty value.
        value, scope = config.get(args.tool, key, args.project_folder or None, None)
        if scope != "hardcoded":
            pairs.append(f"{key}={value}")
    Path(args.out).write_text("|".join(pairs) + "\n", encoding="utf-8")


def cmd_set(args: argparse.Namespace) -> None:
    try:
        if args.scope == "global":
            config.save_global_setting(args.tool, args.key, args.value)
        elif args.scope == "project":
            if not args.project_folder:
                raise ValueError("--project-folder is required for --scope project")
            config.save_project_setting(args.project_folder, args.tool, args.key, args.value)
        else:
            raise ValueError(f"unknown scope: {args.scope!r}")
        Path(args.out).write_text("OK\n", encoding="utf-8")
    except Exception as exc:  # noqa: BLE001 - reported to the caller, not raised
        Path(args.out).write_text(f"ERROR: {exc}\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    get_parser = sub.add_parser("get")
    get_parser.add_argument("--tool", required=True)
    get_parser.add_argument("--keys", required=True, help="comma-separated key list")
    get_parser.add_argument("--project-folder", default="")
    get_parser.add_argument("--out", required=True)
    get_parser.set_defaults(func=cmd_get)

    set_parser = sub.add_parser("set")
    set_parser.add_argument("--tool", required=True)
    set_parser.add_argument("--key", required=True)
    set_parser.add_argument("--value", required=True)
    set_parser.add_argument("--scope", required=True, choices=["global", "project"])
    set_parser.add_argument("--project-folder", default="")
    set_parser.add_argument("--out", required=True)
    set_parser.set_defaults(func=cmd_set)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
