---
description: Independently review the latest visual captures (every viewport and theme) against the state descriptions
argument-hint: "[<page>/<state> | <Component>/<Story> ...]"
---

Review visual captures. Targets given: $ARGUMENTS (if empty, use the states changed in this branch).

1. Follow the `ui-visual-review` skill. Work out the list of states: the arguments, or the `{page, state}` and
   stories touched by `git diff --name-only` against the base branch.
2. Make sure fresh captures exist for them: `screenshots/app/<page>/<state>/<viewport>.png` and
   `screenshots/atlas/<component>/<story>--<theme>-<viewport>.png` under the UI root. If they are missing or older
   than the last UI edit, run the suite for just those states (commands are in the skill).
3. Read each state's intent from `tests/visual/state-catalog.ts` (`description`) or the story name and comments.
4. Delegate to the `ui-visual-reviewer` agent with the list of image paths and the description of each state, so the
   review is independent of whoever made the change. If the change author is reviewing, do the checklist yourself
   and say the review was not independent.
5. Report per state: images opened, defects per viewport or theme (path plus observation), and APPROVE or REJECT.
   A REJECT is fixed in the UI or the driver, never by adding a `sameAs`, `undriven` or debt entry.

Nothing is committed or pushed by this command.
