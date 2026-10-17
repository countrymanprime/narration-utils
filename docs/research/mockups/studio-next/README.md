# Studio Next: the working mock

A self-contained, runnable React + TypeScript mock of the narrator studio, built to settle the design before the real app is rebuilt around it. It is **not** wired to the repo's host, sidecars or REAPER bridge; every real capability (DAW, speech engine, alignment, measurement, extraction, component downloads) sits behind a small interface with a mock implementation fed by fixture data. A later change replaces a mock provider with the real one without rebuilding a screen.

The owner's rulings that shaped it are in [`research/repo-compare-decisions.md`](research/repo-compare-decisions.md). The research behind them (repo comparison, editing FX, icon audit, Story Bible extraction, local and own-model LLMs) is in [`research/`](research/). `ARCHITECTURE.md` describes the layers, stores and registries.

## Run it

This folder is a standalone npm project (it is not part of the pnpm workspace).

```bash
cd docs/research/mockups/studio-next
npm ci
npm run dev        # http://localhost:5173
npm test           # vitest, jsdom
npm run typecheck
npm run artifact   # one self-contained HTML file (SINGLE=1 vite build)
```

`e2e/` holds Playwright scripts used to audit overflow at 860 to 1600 px (`overflow.mjs`) and to take screenshots; they expect a Chromium and the `@fontsource` fonts from `node_modules`.

## What it covers

Production, Schedule, Script, Story Bible, Booth, Editing (script-based audio editing), Proof, Pickups, Master, Delivery, Settings, Companion (parked), with the jump menu, undo history, key-hint footers, Mock states panel and DAW capability model (REAPER, built-in recorder, Audacity).

## Settings

The Settings page is the redesign proposed in [ADR 0865](../../../adr/0865-settings-are-grouped-by-what-is-configured-with-a-scope-and-a-used-by-list-on-every-setting-and-a-model-list-that-owns-the-downloads.md) (Proposed, 2026-10-17). It **supersedes the earlier single-column page** (eleven stacked panels, deleted from `src/pages/Settings.tsx`; `git log` has it) and is the spec for Settings once the owner accepts the ADR. The research is in [settings-best-practice.md](../../settings-best-practice.md), the setting-by-setting grouping in [settings-inventory-and-grouping.md](../../settings-inventory-and-grouping.md).

- **Code.** `src/pages/Settings.tsx` (shell, search, category list), `src/pages/settings/` (rows, controls, Models & downloads), `src/fixtures/settings.ts` and `settingsAssets.ts` (the registry), `src/state/commands/settingsPage.ts`, `src/styles/settings.css`.
- **States to try.** Mock states > Settings: ready, loading, settings file unreadable, changes cannot be saved, some or no models on the disk; Downloads: reachable, blocked, low disk space; Recording setup changes which DAW rows show; "Open from Pickups" shows a deep link and Back. Ctrl+, opens Settings from any page.
- **Narrow.** Below about 760 px of the page's own width the category list folds into a Category button and the model table becomes cards. Capture at 390 px as well ([ADR 0061](../../../adr/0061-settings-states-are-also-captured-at-a-390px-reflow-width.md)).
- **Tests.** `tests/settings.test.tsx`.

## Status

Design reference only. Lifecycle: this folder is deleted when the real app matches it (`.claude/rules/ui-spec-and-screenshots.md`, "Which mocks are the spec"). Items deliberately left out or deferred are listed in the decisions file (time tracking, the Companion, proofer CSV, FX chains on whole takes, Audacity 4, redo).
