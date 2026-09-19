---
description: Read-only scorecard of the UI atlas state (stories vs components, debt, CI, docs freshness, kit drift)
argument-hint: "[--dir <ui-root>] [--min <score>]"
---

Audit the UI atlas of this repository. Arguments given: $ARGUMENTS

1. Delegate to the `ui-atlas-auditor` agent (read-only). Pass it the arguments and the repository path. It runs
   `node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" audit --json`, reads the repo to confirm what the JSON says, and
   returns a prioritized scorecard.
2. Relay the scorecard as it came back: overall score, the top findings in priority order, and the single next action.
3. If the user only wants the raw numbers, skip the agent and run the CLI directly:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" audit $ARGUMENTS
   ```
   A non-zero exit means the score is below `--min`; say so.

This command changes nothing. Fixing findings is a separate request (`ui-story-writer`, `ui-atlas-docs-sync`,
`/ui-atlas:sync`).
