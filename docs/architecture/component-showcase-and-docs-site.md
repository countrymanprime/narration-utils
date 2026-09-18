# Component showcase (Storybook) & public documentation site

**Status: Planned — not implemented.** Deliberately deferred: the primitive component library (`Dialog`, `Button`, `MeterBar` as of this session) has only three components in it. This is its own follow-up project once there's enough to show off.

## Problem / goal

"Professional level setup" for potential users and contributors: a way to browse the UI component library in isolation, and public-facing documentation (not just the internal `docs/` tree meant for contributors/agents) that could be published (e.g. GitHub Pages) so people evaluating or contributing to the project have something to look at beyond the source tree.

## Proposal sketch

1. **Storybook** for `shared/ui`'s primitive components. Standard Vite + Storybook setup (`shared/ui` already builds with Vite per `playwright.config.ts`'s `dev:mock` webServer, so a Storybook-for-Vite config is a natural fit). One story per primitive (`Dialog`, `Button`, `MeterBar`, and whatever else exists by the time this is built), demonstrating variants (e.g. `Button`'s `primary`/`ghost`/`danger`, `Dialog`'s `actionsAlign` modes).
2. **Public documentation site**: structure TBD — either generated from the existing `docs/` Markdown tree (would need a static-site generator that can render the existing cross-linked ADR/architecture docs reasonably, e.g. a plain MkDocs/Docusaurus setup) or a separate, purpose-built set of pages aimed at an external audience (the internal `docs/` tree is written for contributors/agents, with a lot of implementation-detail framing that a prospective user doesn't need).
3. **GitHub Pages deployment** via CI, once (1) and/or (2) exist — a new GitHub Actions workflow alongside the existing ones in `.github/workflows/`.

## Sequencing

Do this after the primitive library and design-system reference (`docs/design/design-system.md`) have grown enough to be worth showing off — building Storybook infrastructure around three components has a poor cost/benefit ratio right now. Revisit once `docs/adr/0003-tailwind-tokenized-primitives.md`'s scope has expanded meaningfully.

## Out of scope for this doc

Choosing the static-site generator or Storybook's exact addon set — premature until there's more to document.
