# 0081. Local assets is a Settings list built from the registry, whose rows own their download, verify and remove

**Status:** Accepted
**Date:** 2026-09-21

## Context

Voices, Whisper models and the Story Bible language model could each be downloaded from a first-use question and removed from a button beside one selected item (`Settings.tsx`: "Remove local voice", "Remove local model"). There was no place to see everything the app keeps on the computer, to verify or repair an asset, or to follow a download that a page had started. The registry ([ADR 0079](0079-every-downloadable-asset-is-listed-installed-verified-and-removed-through-one-registry-of-providers.md)) already lists every asset with its state, sizes, links and running job, and the install is one job with real bytes ([ADR 0077](0077-every-asset-install-is-one-job-with-real-bytes-a-second-start-joins-it-and-one-hook-follows-it.md)). Owner decisions: the cache folder is shown and never changed or emptied (Q3 a), and removing a voice or model is a danger confirm (D12).

## Decision

- **Settings gets a Global category, "Local assets"** (`components/assets/LocalAssets.tsx`, `LocalAssetRow.tsx`). It lists `AssetsList` and nothing else, so a new kind of asset appears with no page work, and shows the total the installed assets use and the cache folder.
- **Each row owns its own install** (`useAssetInstall`, one per row) and its Verify and Remove (`usePendingAction`, ADR 0075). A download that was running when the page opened is followed through `activeJobId` and `AssetsInstallState`; every other start is `AssetsInstall`, which the host joins to a running job and which repairs a damaged asset. The list reloads after any change and keeps the rows mounted, so a download being followed is never torn down by a refresh.
- **Five states, one action slot.** Not installed (Download), downloading (real bytes, Cancel while bytes arrive), verifying (a busy button, no Cancel), installed (Verify, Remove) and needs repair (`verification_failed`: Repair, Remove). The first button keeps its place as the state changes, so keyboard focus is not dropped. A failure is written in the row (`role="alert"`), never only in a toast.
- **`ProgressBar` becomes a primitive** (`components/primitives/ProgressBar.tsx`, with stories and a test), extracted from `WorkDialog` unchanged in look and semantics, because a row needs the same bar without a dialog and only primitives may import Base UI. `valueText` carries the bytes so the numbers stay out of the live region.
- **`useAssetInstall` releases its guard when the component is torn down**, so a `begin` run from an effect that StrictMode tore down before it answered no longer leaves every later `begin` refused (a page that follows a download begins from an effect).
- **The mock reaches every state without a host**: `?mockAssets=installing|checking|damaged` (a running download followed through `activeJobId`, a download at its check, a model that fails verification), with `download-fails` and the default for the rest; the visual suite captures each at every viewport including the 390 px reflow width.

## Consequences

- One place to see, verify, repair and remove assets; the older per-page remove buttons still work (they call the same removal) and can be dropped when their pages move over.
- The first Verify on a large model reads every byte and can take seconds; the button says it is working and cannot be pressed twice.
- There is no "clear the cache" button and no way to move the folder from the app (owner decision Q3 a); to add either, write a new ADR that supersedes this one.
- The row's state is derived from the list plus its own job, so a second window that starts a download is seen only when the list next reloads.
