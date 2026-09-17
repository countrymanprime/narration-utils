# Concurrent Story Bible build during manuscript import

**Status: Planned — not implemented.**

## Problem

Manuscript import is fast (the Go importer parses a full manuscript in well under a second in normal testing). Building the Story Bible is a separate, manual step the user has to remember to trigger afterward (`Guide.tsx`'s "Build / refresh Story Bible" button, `api.guideBuild()`). Given the import's speed, there's no strong reason to force this into two steps.

## Proposal

Add a setting — global default and/or a per-import toggle in the Import Manuscript modal's confirmation step (see `import-settings-workflow.md` for where a broader options step could live) — that, when enabled, automatically triggers `api.guideBuild()` immediately after a successful `manuscriptImportCommit`, using the same `WorkDialog` progress UI already used for the import itself (or a chained second phase in the same dialog).

## Interactions to resolve before building this

- **Character-candidate seeding** (implemented — see `shell/bindings.go`'s `seedCharacterCandidates`) already writes manual `Character` entities into `manuscript_guide.json` *before* any Build runs, tolerating a missing guide file. A subsequent auto-triggered Build must not treat those manual entities as gone — `merge_locked()` already preserves `manual: True` entities through a rebuild, so this should compose correctly, but needs a manual end-to-end check once implemented (import with checked candidates → auto-build → confirm both the seeded entities and the freshly-extracted ones coexist).
- **Where the setting lives**: likely `Settings.tsx`'s Story Bible category (global default) plus an optional override in the per-import confirmation dialog, mirroring how `sectionKinds`/`characterCandidateIds` already round-trip through that same dialog.
- **Failure handling**: if the import succeeds but the auto-triggered build fails, the import must still be reported as successful — don't let a build failure look like the import itself failed (this is exactly the kind of confusion item 11's fix addressed for the manual Build button).

## Out of scope for this doc

The actual UI copy/toggle placement and whether the default is on or off — that's a product decision to make when this is scheduled.
