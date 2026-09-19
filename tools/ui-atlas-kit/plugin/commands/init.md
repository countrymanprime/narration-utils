---
description: Set up the UI atlas (visual capture suite, Storybook, docs, CI) in the current repo at a chosen tier
argument-hint: "[--dir <ui-root>] [--tier 0|1|2] [--dry-run]"
---

Set up the UI atlas in this repository. Arguments given: $ARGUMENTS

1. Follow the `ui-atlas-init` skill end to end. It decides the tier from the repo's stack and size.
2. Start with a dry run so nothing is written blindly:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" init --dry-run $ARGUMENTS
   ```
   Show the user the detected stack, the chosen tier, blockers (for example no Vite or no TypeScript, which keep the
   repo at tier 0), and which files would be written or skipped. `init` never overwrites an existing file, and it
   does not install packages: it prints the install command as a note.
3. If the user agrees (or the arguments already contained an explicit `--tier`), run it again without `--dry-run`.
4. Report what was created and skipped, then run the new scripts once (`pnpm test`, then the visual suite and the
   atlas per `ui-atlas-gate`) so the first result is a real number, not a promise.
5. Next steps to offer, not to start unasked: `/ui-atlas:audit` for the scorecard, the `ui-story-writer` agent for
   the components that still lack stories, and the `ui-atlas-ci` skill to wire the CI jobs.

Do not commit or push. Do not edit `state-catalog.ts` or add stories as part of init.
