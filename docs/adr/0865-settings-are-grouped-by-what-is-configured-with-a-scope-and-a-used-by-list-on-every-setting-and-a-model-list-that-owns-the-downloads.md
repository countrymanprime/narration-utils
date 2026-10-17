# 0865. Settings are grouped by what is configured, with a scope and a used-by list on every setting and one list that owns the downloads

**Status:** Proposed (owner decisions listed in the [grouping note](../research/settings-inventory-and-grouping.md#decisions-that-need-the-owner); register on [#993](https://github.com/countrymanprime/narration-utils/issues/993))
**Significance:** An interface between parts and a construction technique. Every setting is described by one registry entry (scope, pages that use it, other places that write it, Advanced or not), and the Settings page, its search and its deep links are built from that list. Settings that several pages share get one home; settings that change one page leave Settings. Reversing it means re-sorting about 100 keys across panels, anchors, guides and visual states.
**Date:** 2026-10-17

## Context

The owner dislikes the Settings page. Today it is one 860 px column of 27 panels with no navigation or search ([inventory](../research/settings-inventory-and-grouping.md#how-it-works-today)). Panels 1 to 10 follow the Studio Next mock and 11 to 27 are older categories kept as built ([PRD](../prds/studio-next-master-delivery-and-settings.prd.md)), so the order is delivery history. What was observed:

- Shared configuration has no home. Three settings choose a Whisper model (Proof, Recording check, Booth); the same model serves four pages. Downloads are listed or removed in six places. Backups and the delivery profile are edited in three places each.
- Scope is decided per panel by a Global / This project switch that gives no cross-panel view. A non-number row shows an inherited value as if it were set; a Global value has no reset ([`ScopedSetting.tsx`](../../apps/ui/src/components/settings/ScopedSetting.tsx)).
- Many settings only change what one page does (recording check rules, silence cleanup, preview, stage suggestions) yet sit far from it.
- One setting has no consumer (`General.log_verbosity`) and four have no editor.

The [best-practice note](../research/settings-best-practice.md) surveys VS Code, JetBrains, Resolve, REAPER, Ableton, Obsidian and Windows guidance. Its sources were read as search excerpts only; rules without a source are marked as recommendations there.

**Considered options:** keep the single column and add a table of contents (leaves the shared-resource and scope problems, and 27 panels is still 27 panels); tabs across the top (about nine categories is more than a tab bar holds, per R-NAV1); one big searchable list with no categories (loses the workflow grouping the audio tools use, R-IA6); a modal Options dialog (no deep link or Back, R-WIN6); grouping by consuming page (puts the Whisper model on four pages, which is today's problem).

## Decision

1. **Eight categories in three labelled groups, plus an index.** Shared tools: Recording & DAW, Speech to text, Voice & pronunciation, Models & downloads, Delivery. This project: Project. This computer: Appearance & keys, App & updates. Elsewhere: Set on a page. A left list shows one category at a time; below about 760 px of the page's own width it folds into one Category button (R-NAV1, R-A11Y7).
2. **Every setting has one scope and says who uses it.** A row carries a scope badge (this computer, this project, or all projects with an optional project override) and "Used by" links to the pages that read it. Where a project may override, the row shows "This project uses the computer setting" with Override, and the override with a way back (R-IA1, R-IA2, R-IA4). A quick control on a page that writes the same value is named on the row ("Also set in ...").
3. **A setting that changes one page leaves Settings.** Recording check rules, silence cleanup, preview, stage suggestions, compare defaults, punch pre-roll, favourite effects and backups are set on their page. The Settings page lists them under Set on a page and search finds them (R-IA3, R-WIN5).
4. **One transcription default.** "Transcription model" in Speech to text serves Production, Proof, Pickups and Editing. The two-pass models, workers and chunking are Advanced there. The Booth's live engine and model are their own section.
5. **One list owns downloads.** Models & downloads lists every asset with size, status, used-by and what is using it, shows disk use and the folder, and owns download, cancel, retry, repair and remove. A role's choice stays in the section for that role; choosing a model that is not on the disk offers the download in the row. Removing an asset in use names what uses it and moves the setting to another installed choice, or refuses when there is none (R-RES1 to R-RES5, R-EDIT8).
6. **Changes apply at once.** No Save button; each row says Saved, a changed row carries a "Changed" mark in words and can be reset, a category can be reset after confirmation, and a costly change (the transcription model) asks first and says what re-runs. Rarely changed options sit under a closed Advanced. An invalid value keeps the previous one and says how to fix it (R-EDIT1 to R-EDIT6).
7. **Search and deep links.** Search matches label, description, section and synonyms, opens matching Advanced rows and offers "Changed" and "In this project" filters. Another page opens Settings on a row with a Back link; Ctrl+, opens Settings from anywhere (R-NAV2 to R-NAV4).
8. **The registry is the source.** `docs/research/mockups/studio-next/src/fixtures/settings.ts` holds the rows and `settingsAssets.ts` the downloads; the real page builds from the host's `fieldSchemas` plus the same metadata, so a new setting is one entry and no panel is hand-written (the PRD's "0 hand-written rows" metric).
9. **The mock is the spec.** The Studio Next Settings page (`docs/research/mockups/studio-next/src/pages/Settings.tsx` and `pages/settings/`) is the one spec for Settings, replacing its single-column predecessor, under [ADR 0760](0760-the-studio-next-mock-is-the-only-spec-for-every-page-it-covers-tokens-primitive-sizes-and-layouts-included.md). A setting the mock does not place is not built until the owner places it.

## Consequences

- A shared resource has one home and a visible list of its consumers. A worker adding a setting fills one registry entry and decides its scope and Advanced status, instead of choosing a panel.
- **Supersedes** nothing outright while Proposed. If accepted, the Settings text of the [master, delivery and settings PRD](../prds/studio-next-master-delivery-and-settings.prd.md) ("its categories are panels of the page's one column, each two-scope panel with its own Global / This project switch") is replaced, and [ADR 0081](0081-local-assets-is-a-settings-list-built-from-the-registry-whose-rows-own-their-download-verify-and-remove.md) stands with its list renamed Models & downloads and its note that per-page remove buttons can go now carried out. [ADR 0061](0061-settings-states-are-also-captured-at-a-390px-reflow-width.md) stands: every state is still captured at 390 px.
- [ADR 0365](0365-the-theme-is-one-global-setting-and-the-booth-and-companion-follow-it.md) says the theme is one global setting while it is stored per browser. The mock labels it "This computer". Moving it to the host is a separate decision.
- Moving a setting to its page is a change per page, each with its own guide update and visual states. Until a page has it, the setting stays in Settings under its old panel; the index page is built last.
- Page owners lose the single place to look. The index page and search are the mitigation; if narrators still cannot find them, the cost is a longer Settings page, not a different structure.
- The mock's rows use a checkbox with an On/Off word where Windows guidance prefers a toggle, because the primitive set has none (R-WIN1). Adding a switch is a Foundations decision.
- Not decided here: deleting `General.log_verbosity`, what to do with the four settings that have no editor and with `Mastering.provider`, and dropping the project override for the DAW rows. They are listed for the owner in the grouping note.
- To change this, write an ADR that supersedes it.
