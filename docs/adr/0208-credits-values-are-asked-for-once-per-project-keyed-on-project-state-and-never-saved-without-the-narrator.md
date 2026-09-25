# 0208. Credits values are asked for once per project, keyed on project state, and never saved without the narrator

**Status:** Accepted
**Date:** 2026-09-25
**Amends:** the seeding half of `docs/prds/audiobook-credits-templates.prd.md` C3 (detected values are now also offered in a prompt, not only as Settings suggestions)

## Context

The owner opened a project with an imported manuscript and was never asked for the credits values. The Manuscript page, the estimate and the teleprompter all showed `[Title]`, `[Author]` and `[Narrator]` unresolved (`docs/prds/credits-token-setup-and-front-matter-detection.prd.md`). Phase 1 made detection find the values. Nothing asked for them. The project manifest has no schema version, and the in-app update records nothing per project, so an old project opened in a new version looks exactly like a new project with no credits values. The owner answered CS1 (D35: a dialog once per project, then a banner while tokens stay unresolved). D39 takes the recommendations for CS2 ("Not now" for the session; "Don't ask" stored per imported manuscript), CS4 (A: ask only for the unresolved tokens of the credits the app reads), CS7 (B: offer to keep a typed narrator for every project) and CS9 (credits-only, but record the pattern). ADR 0019 (a detected manuscript is offered, never imported) is the precedent for offering and never applying. The alternative, storing a "last seen app version" per project, would miss a fresh import and a Replace manuscript. Those are the other moments the owner meant.

## Decision

- **Ask on state, not on version.** `CreditsSetupState` (`apps/desktop/creditsetup.go`) is `needed` when a manuscript is imported, the first opening and the first closing template (ADR 0093) have tokens the project's values and the global narrator leave unresolved, and nothing dismissed the prompt. That one rule covers the first open, the first open after an update, an import, and a Replace manuscript alike.
- **What it asks for** is `fields`, from `credits.SetupFields`: those unresolved tokens in the order they first appear, each with its `CreditValues` key and the value `credits.Detect` found for it (Phase 1's precedence). `[Chapter]` and `[Chapter Title]` are never asked for (ADR 0151). Every other detected value for a token the project has not set comes back as `candidates`, for Settings' captions. A candidate for a set value is never offered.
- **Dismissal has two scopes.** `CreditsSetupDismiss("session")` is "Not now". It is kept in host memory per project folder and manuscript document, so a new run of the app or a Replace manuscript asks again. `CreditsSetupDismiss("project")` is "Don't ask for this project". It is stored as `project.Manifest.CreditsSetup{dismissedFor: documentId, dismissedAt}`, additive with `omitempty` like `Credits`, so a Replace manuscript (a new document id) asks again. `banner` stays true while tokens are unresolved unless the narrator chose "Don't ask" (CS1 C).
- **Save fills, never overwrites.** `CreditsSetupSave(fields)` fills only the project's empty values from the prompt and ignores empty fields. A stale or blank prompt field can never clear or replace a value the narrator set. "Use for all my projects" saves `General.narrator_name` through the existing settings binding, not the project override. Nothing is written without a Save.
- **The pattern, recorded for reuse (CS9).** A per-feature setup that must catch old projects keys on the project's state plus a manifest marker scoped to what the answer was about (here, the manuscript's document id). It does not key on an app or manifest version.
- **Wire contract.** The goldens are `credits-setup-state-{needed,dismissed}.json` (`TestContractCreditsSetupState`, over a real import of `tests/fixtures/after-the-applause.md`). The schema is `creditsSetupStateSchema`. The mock asks only with `?mockCredits=setup`: it otherwise boots as if the narrator chose "Don't ask", so the prompt never covers other screens. `hostAPIVersion` is 52.

## Consequences

- The owner's book opens to a prompt prefilled with "After the Applause" and "Adrian Crow" that needs only a narrator name, and one Save resolves the Manuscript card.
- A narrator who never records credits answers "Don't ask" once per manuscript. Deleting the templates also stops the prompt, because nothing is then unresolved.
- An older app version that re-saves `project.json` drops `creditsSetup`. The worst case is one extra prompt.
- The dialog, the banner and their placement on Home (sequenced after the ADR 0019 manuscript offer) are the UI half (lane C).
