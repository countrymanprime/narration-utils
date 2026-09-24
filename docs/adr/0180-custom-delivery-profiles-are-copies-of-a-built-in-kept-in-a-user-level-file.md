# 0180. Custom delivery profiles are copies of a built-in, kept in a user-level file

**Status:** Proposed
**Date:** 2026-09-24

## Context

[Delivery Platform Profiles](../prds/delivery-platform-profiles.prd.md) Open Question P2 asked whether custom profiles ship in v1; the recommended answer (A), approved with the mockups, is yes, for the numbers only. The move of the old "your limits" settings (ADR 0179) needs somewhere to keep an existing narrator's numbers anyway. The layered settings store holds strings only, so a structured profile cannot live there; the credit templates set the precedent of a user-level JSON file beside `recent-projects.json` (`credit-templates.json`, audiobook-credits-templates.prd.md C7).

## Decision

1. **A custom profile is a copy.** `DeliveryDuplicateProfile(id, version)` copies a built-in (or another custom profile) with a new id (`custom-<hex>`), `builtIn: false`, `basedOn` the built-in's key and revision 1. `DeliverySaveProfile` saves only its name, each rule on or off, and the numbers of a file rule with a min/max range; it refuses a built-in, an added, dropped or reordered rule, an added or removed bound, and a lowest above its highest, and bumps the revision. A rule with a fixed value (sample rate, MP3 format, channels) can only be turned off; book and listen rules are kept. `DeliveryDeleteProfile` refuses a built-in; a project that chose a deleted profile is judged against the Global default with a notice.
2. **Storage.** Custom profiles and the Global default are `delivery-profiles.json` in the same folder as `credit-templates.json` (`%APPDATA%\narration-utils`), versioned (`schemaVersion` 1), written through a temporary file and a rename. It is read as narrator data through `persist` (ADR 0069): a file that cannot be decoded, holds more than 100 profiles, or holds a profile with an unknown metric, a non-finite bound or a lowest above its highest is kept aside and reported, and the built-ins still work. A custom profile always judges with its latest revision; the project's manifest names it by id only.
3. **Settings > Delivery** shows the project's choice (the Project scope, where "Change profile" lands) or the Global default (the Global scope), and the profiles with Duplicate, Edit and Delete; a choice takes effect at once rather than through the page's Save.
4. **No import or export** of a profile file in v1 (P9).

## Consequences

- A narrator delivering with other numbers keeps ACX's sources beside their own numbers and sees exactly which rules they changed or turned off.
- A new file the app reads back is a trust boundary: tampering can change a verdict, never write anything; its row is in `docs/architecture/threat-model.md` and `SECURITY.md`.
- A copy cannot express a rule kind the app does not measure; a new kind is a code change with its own rule.
- To change any of this, write an ADR that supersedes this one.
