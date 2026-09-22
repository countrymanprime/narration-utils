## Conventional title required

Use the pull request title that you want GitHub to use for the squash commit:
`feat: ...`, `fix(scope): ...`, `chore: ...`, and so on. Add `!` or a
`BREAKING CHANGE:` footer for a breaking change.

## Related issue

Closes #

## Checks

- [ ] I ran the relevant local quality checks (`pnpm check`).
- [ ] This change does not add unreviewed runtime/model artifacts.
- [ ] If `apps/ui` changed: I looked at the visual-suite screenshots at every viewport, and ran `pnpm --dir apps/ui atlas` if a primitive or `styles.css` changed.
- [ ] If `integrations/reaper` changed: I ran the bridge harness (`pnpm check`) and verified REAPER's own API behaviour by hand inside REAPER (the harness fakes `reaper`).
- [ ] If this settles or changes a decision: I added or updated an ADR in `docs/adr/`.
