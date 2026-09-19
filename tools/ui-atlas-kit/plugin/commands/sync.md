---
description: Compare the kit files vendored in this repo with the plugin templates, and refresh them or just check for drift
argument-hint: "[--check] [--dir <ui-root>]"
---

Sync the vendored UI atlas kit files. Arguments given: $ARGUMENTS

1. Always check first, without changing anything:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" sync --check $ARGUMENTS
   ```
   Exit 0 means no drift. Exit 1 lists the files that differ from the plugin templates. Without a
   `ui-atlas.config.json` in the UI root (written by `init`) there is nothing to compare; say so.
2. If the arguments included `--check`, stop here and report the drift list.
3. Otherwise show the user which files would be refreshed and why. A file the repo customized on purpose (its
   own viewports, its own state catalog) must not be overwritten silently: point that out and let the user decide.
4. After approval, run `node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" sync $ARGUMENTS`, then run the repo's tests
   and the `ui-atlas-gate` skill, because refreshed harness files can change what the suites check.
5. If the atlas output changed, follow `ui-atlas-docs-sync` to regenerate `docs/ui/`.

Do not commit or push.
