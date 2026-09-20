# Contributing

Thanks for helping. Narration Utils is a local-first toolkit that helps a narrator find and review issues faster.
It never edits audio or text automatically; see the [product boundary](docs/roadmap.md#product-boundary).

## Before you start

- Check the [documentation index](docs/README.md) and the [roadmap](docs/roadmap.md).
- Open an issue first for anything beyond a small fix, using the bug or feature form.
  [Tracking work on GitHub](docs/operations/github-workflow.md) explains labels, milestones, and the project board.
- If your change touches the UI primitives, `styles.css`, or a behaviour an ADR names, read the
  [ADR index](docs/adr/README.md) first.

## Setting up

```bash
pnpm run bootstrap   # once after cloning
pnpm run check       # the full quality gate
```

Details, including the Git hooks and CI, are in [CI and releases](docs/operations/ci-and-releases.md).

## Making a change

1. Work on a branch and write tests first; the repository expects them alongside behaviour changes.
2. Run `pnpm run check` before you push. If you changed `apps/ui`, also review the visual-suite screenshots at every
   viewport and run `pnpm --dir apps/ui atlas`. If you changed `integrations/reaper` (Lua), verify it by hand inside
   REAPER, because nothing automated covers it.
3. Open a pull request whose **title is a Conventional Commit** (`feat: …`, `fix(scope): …`). It becomes the squash
   commit and decides the next version. Put `Closes #<issue>` in the description and fill in the template.
4. If you settled a real design decision, record it as an ADR in `docs/adr/`.

## Licensing of contributions

The project is licensed under AGPL-3.0-or-later ([ADR 0039](docs/adr/0039-the-project-is-licensed-agpl-3-or-later.md)).
By opening a pull request you agree that your contribution is licensed under the same terms. There is no
contributor license agreement.

## Reporting a security problem

Do not open a public issue. Follow [SECURITY.md](SECURITY.md).
