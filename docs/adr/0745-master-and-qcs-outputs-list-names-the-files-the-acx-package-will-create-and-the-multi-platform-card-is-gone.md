# 0745. Master & QC's Outputs list names the files the delivery package will create, and the Multi-platform export card is gone

**Status:** Accepted (owner ruling D98 on [#509](https://github.com/countrymanprime/narration-utils/issues/509), 2026-09-29; stream N-F1)
**Date:** 2026-09-29
**Supersedes:** point 1 of [ADR 0480](0480-multi-platform-export-is-a-separate-checkbox-list-encoding-once-per-differing-format-built-sequentially.md) (the separate checkbox list); its points 2 to 4 still describe the host code

## Context

Benchmark mock 05 draws an OUTPUTS list in the Delivery package: the files the package will create, and a "Preview naming" button. The app drew its Outputs only after a package was built, and put a Multi-platform export card (ADR 0480) below the Delivery package. The owner ruled (D98) that the delivery choice is ACX, that the slot shows the MP3 files the package will create for this project with the name and format each will have, and that this replaces the Multi-platform export card.

The names a package's files get are written in one place, `internal/packager` (`plan`, used by `Assemble`). A preview written separately, in the UI or in the host, would drift from it the first time one changed.

## Decision

- `internal/packager` gains `Preview(profile, chapterTitles, extension)` and the three fixed-name helpers (`creditsOpeningName`, `creditsClosingName`, `retailSampleName`). `plan` calls the same helpers and `chapterFileName`, so the preview and the build name files with one piece of code. A test builds a package with `Assemble` and requires the preview's names to equal the manifest's, in order.
- The host answers `PackagePreview(profileId, profileVersion)` (`apps/desktop/package_preview.go`, host API 85): the profile's format (`requiredFormat`, the rule ADR 0480 introduced), then the opening credits, one file per narration chapter of the project's manuscript (named by its subtitle when it has one, by its title otherwise, the way mock 05 reads), the closing credits and the retail sample, leaving out a book rule the profile turned off. A chapter whose title `Assemble` would refuse (empty, or holding a character a Windows file name cannot) comes back with a `problem` and no name. With no manuscript the list is empty and `problem` says so. It builds nothing and reads only the manuscript and the profile.
- The UI reads it through `usePackagePreview` and draws it in the Delivery package's **Outputs** section (`DeliveryPackagePanel.tsx`): before a build, the planned files with their format and count; after a build, the folder and the files written, as before.
- The Multi-platform export card, `MultiPlatformExportPanel.tsx`, its hook state in `useExportJobs.ts`, its tests and its four visual states are removed. The host bindings behind it (`PackageStartMulti`, `PackageMultiState`, `PackageMultiCancel`) and their mock stay for now: nothing in the UI calls them, and retiring them is a separate change to a wire contract.

## Consequences

- The narrator sees what the package will contain, with its names, before building it, and the list cannot disagree with the build.
- The names come from the project's chapters. A build names a chapter after the title the narrator gave that exported file (it defaults to the file's name), so the two agree when the narrator titles files after the chapters; a different title shows in Outputs after the build, which lists what was written.
- Building for several platforms at once is no longer on the page. The delivery choice is ACX (D98); another platform is built by choosing it in the platform tabs.
- `PackageStartMulti` and its siblings are unused by the UI until they are retired or given a screen again.
