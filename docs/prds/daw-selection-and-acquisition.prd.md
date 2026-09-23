# DAW Selection and Acquisition

**Source:** user request of 2026-09-21 ("include a prd for adding support for selecting a DAW and helping start the download/install if that is allowed through license. probably pointing at their download page rather than starting it"). Citations are `file:line` on branch `claude/recording-suite-prd-1b03c7`.

## Problem Statement

- A narrator who has never used this suite before has no DAW yet and no guidance on which one to get or where. The app assumes REAPER is already installed and reachable; nothing in the product tells a first-time narrator what a DAW is, which one this suite supports, or how to obtain it.
- Even a narrator who knows they need REAPER has to leave the app, search for it, and trust that they found the real vendor page — the app offers no pointer, and there is no code anywhere that detects whether a DAW is installed at all (`apps/desktop` has zero `REAPER.exe`/registry/PATH lookup outside a test-fixture comment).
- This is upstream of, and distinct from, [Project Workspace: DAW Link](project-workspace-and-daw-link.prd.md), which assumes a DAW is already installed and focuses on linking a project to a specific `.rpp` file and (per its Phase 6 spike, W11) *launching* an already-installed `reaper.exe`. This PRD covers the step before that: **does a supported DAW exist on this machine, and if not, how does the narrator get one** — without the app ever downloading, bundling, or running a third-party installer itself, since we cannot verify we're licensed to redistribute or silently install someone else's commercial software.

## Evidence

- **No DAW-detection code existed anywhere in the repo when this PRD was written.** Confirmed by search: no `REAPER.exe` string, registry lookup, or PATH search in `apps/desktop` outside a test-fixture comment. This was the same gap the DAW Link PRD's **W11** ("Where is `reaper.exe`?" — global setting, auto-detect, registry lookup, or `.rpp` file association) left open (`project-workspace-and-daw-link.prd.md:90`); that PRD's own Phase 6 spike has since resolved W11 and shipped a registry-then-file-association locator as `apps/desktop/internal/daw` ([ADR 0092](../adr/0092-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md), not yet on `main`; its PR chain, #283-#298, is open). This PRD needs the same detection fact earlier and for a different reason: to tell a narrator with no DAW at all that they need one — and Phase 1 (below) reuses that locator directly rather than building a second one.
- **REAPER-only scope is a standing decision, not an accident.** `project-workspace-and-daw-link.prd.md:55`: "Multiple DAW files per project, or non-REAPER DAWs... stay out of scope; Windows first per ADR 0030." `docs/roadmap.md:59` lists "Audacity adapters after the shared contract and REAPER workflow are proven" under deferred work. Any DAW-selection UI this PRD builds must reflect that today only REAPER is a real, working choice; Audacity is a placeholder entry until its own PRD's precondition is met.
- **A browser-open precedent already exists and is the template for this feature.** `apps/desktop/update.go:163` calls `runtime.BrowserOpenURL(ctx, status.Available.NotesURL)` inside `openReleaseNotes()` (`update.go:148-165`) to show GitHub release notes in the narrator's browser. Critically, the URL is always built by the host from trusted state, never taken from external or caller-supplied input (`update.go:146-147`) — this is exactly the safety property a "open the vendor's download page" feature needs: a hardcoded, server-side URL per DAW, never anything derived from user input or a remote response.
- **The existing first-use provisioning flow sets the consent bar this feature must match, even though it is not a fit as-is.** `docs/architecture/first-use-dependency-provisioning.md:49-53`: "The narrator must choose Download before any transfer starts," and selecting an option in Settings must never itself trigger a download (`:55-57`). That flow downloads and hashes files the app *does* control and can pin (`config/*-assets.json`, `:9,71-75`) — a DAW installer cannot be pinned or re-hosted this way (the app has no license to redistribute REAPER's or Audacity's installer), so this PRD's flow is deliberately weaker: it never fetches a byte of the installer itself, it only opens the vendor's own page and lets the narrator do the rest.
- **The Go host's networking is fenced and lint-enforced.** `docs/architecture/threat-model.md:36` notes the host imports networking in exactly three places (`internal/assets`, `internal/update`, `media.go`), enforced by a `depguard` rule. `runtime.BrowserOpenURL` does not add a fourth: it shells out to the OS's default-browser handler and does not itself perform an HTTP request, so this feature needs no new network import — but it does introduce a new *kind* of trust boundary (opening an external, if hardcoded, URL and, separately, detecting installed third-party software by inspecting the filesystem/registry) that `threat-model.md` does not yet have a row for.
- **No existing DAW-choice UI or copy exists.** Settings' "DAW Integration" panel is static text that always says "Connected", even in Standalone (`Settings.tsx:179-213`, cited in `project-workspace-and-daw-link.prd.md:31`). There is no first-run "which DAW do you use" step anywhere in `App.tsx` or the picker flow.
- **License and trust constraints, stated once.** REAPER is commercial, trialware-licensed software; Audacity is GPL-licensed free software. This app is AGPL-3.0-or-later (D17, `implementation-plan.md`). The app must not: bundle either installer, silently download or execute one on the narrator's behalf, or claim any affiliation with either publisher. Opening the vendor's own official download page in the narrator's browser sidesteps all of that — the narrator downloads and runs the installer themselves, under whatever terms the vendor presents.

## Proposed Solution

A small, narrow **DAW catalog and "Get it" flow**, independent of and upstream from DAW linking:

1. A hardcoded catalog of supported DAWs (today: REAPER only; Audacity added once its own precondition in the roadmap is met) — name, publisher, one-line license note, and an official download-page URL, all fixed in Go, never fetched or user-editable.
2. Detection: on demand (not polled), check whether each cataloged DAW appears to be installed (registry key or well-known install path on Windows). This produces a fact ("REAPER detected" / "not detected"), not a launchable path — resolving *where* to launch `reaper.exe` from stays the DAW Link PRD's Phase 6/8 concern (W11).
3. A UI surface — shown when no supported DAW is detected (first run, or from Settings at any time) — listing the catalog with each entry's detection state and, for anything not detected, a **"Get REAPER"**-style button that opens that DAW's official download page in the narrator's default browser via `runtime.BrowserOpenURL`. No download, install, or execution happens inside the app at any point.
4. A manual **"Check again"** action so the narrator can re-run detection after installing, with a path to hand off into the existing DAW Link flow once a DAW is found.

## Key Hypothesis

We believe a first-time narrator who has no DAW installed will get to a working REAPER install faster and with more trust if the app tells them plainly what to get and sends them straight to the vendor's real download page, instead of leaving them to search on their own or wonder whether the app already handles it. We'll know we're right when a narrator with no DAW installed can go from first launch to "REAPER detected" using only the in-app prompts, with zero code in this app ever touching the installer file.

## What We're NOT Building

- Downloading, caching, verifying, or executing any DAW installer. The app never touches the installer bytes.
- Auto-installing, silently launching an installer, or elevating privileges on the narrator's behalf.
- A general software-installation framework; this is scoped to the two DAWs this suite already plans to support (REAPER now, Audacity once its precondition is met).
- Version checking, update nudges, or license-key handling for the DAW itself — out of scope, and legally risky to get wrong.
- Launching an already-installed DAW on a specific project file — that's [Project Workspace: DAW Link](project-workspace-and-daw-link.prd.md) Phase 8, which this PRD's detection code can feed but does not replace.
- Any UI implying endorsement, partnership, or official affiliation with REAPER's or Audacity's publishers. Copy is reviewed for this explicitly (see Phase 4).
- Non-Windows detection paths — Windows first, per standing scope (`docs/roadmap.md:52,60`, ADR 0030).

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Detection accuracy | Correctly reports REAPER installed/not-installed on a clean machine and a machine with REAPER present | Manual test on at least two machines; Go unit tests against fake registry/filesystem seams |
| No installer touched | Zero network requests or file writes originate from this feature beyond opening a browser | Code review; `depguard`/network-fence check stays green with no new import |
| Explicit consent | The download page never opens without a narrator click on a labeled button naming the destination | Vitest/manual click-through |
| URL integrity | Every opened URL is one of the hardcoded catalog values; no URL is ever constructed from user input or fetched data | Code review; a unit test asserting the catalog is a literal, not a fetch |
| Successful handoff | After installing REAPER and clicking "Check again," the app reports it as detected without restarting the app | Manual test |
| Legal/copy review | No screen implies affiliation, endorsement, or that the app installs or modifies third-party software | Manual copy review sign-off (Phase 4) |

## Open Questions

All seven adopt their own stated recommendation (`implementation-plan.md` D22: every open question with a recommendation, and not otherwise listed in D1-D23, is adopted without a new ADR).

- [x] **A1. Where does this surface live?** Options: (a) a step in first-run/onboarding before or alongside the project picker; (b) a Settings panel only, reached on demand; (c) both — a first-run prompt that can be dismissed and revisited from Settings. Recommendation: (c), since a narrator mid-project should not be blocked by a DAW they already have. Adopted for the Settings half: `DawCatalogPanel` ships in Phase 2, in Settings' global-scope DAW Integration category (the machine-wide detection fact, not project-scoped). The phase table's own row for Phase 2 lists the first-run prompt as optional ("and optionally first-run prompt per A1"); it is deferred, not built by this phase, to keep Phase 2 to the Solution Detail table's Must rows (catalog UI, the Get-it button, explicit-click-required) — a narrator who has never opened Settings still reaches the catalog the same way they reach every other one-time setup, and nothing in Phase 1-3 depends on the prompt existing. Revisit as its own phase or a follow-up issue if onboarding friction shows this matters.
- [x] **A2. Does "no DAW detected" block anything, or is it purely informational?** The DAW Link PRD already plans to gate Tracks/Proofing on a *linked* DAW file, not on detection (`project-workspace-and-daw-link.prd.md:33,73,94`). Recommendation: this PRD stays purely informational/assistive; it does not add a new gate, it just helps a narrator with nothing installed get to the point where the existing gates can be satisfied. Adopted; `dawcatalog.DetectionResult` is read-only and gates nothing.
- [x] **A3. Detection mechanism.** Registry key (`HKCU`/`HKLM` install entries) versus a well-known install path (`%PROGRAMFILES%\REAPER\reaper.exe`) versus PATH search. Recommendation: registry first (most reliable for an installed-via-installer REAPER), well-known path as a fallback; whichever is chosen should be the same lookup the DAW Link PRD's W11 later reuses to find a launchable path, so land it in a shared, small package rather than duplicating it. Adopted, and taken further than "land in a shared package": `project-workspace-and-daw-link` Phase 6 ([ADR 0092](../adr/0092-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md)) already built and verified that exact registry-then-file-association locator as `apps/desktop/internal/daw.LocateReaperExecutable`. Phase 1 of this PRD reuses it directly (`dawcatalog.DefaultDetectors`) rather than building a second one.
- [x] **A4. Exact download URLs and how they're kept current.** A vendor can change their download URL. Recommendation: a single hardcoded constant per DAW in one Go file, checked by CI's existing docs-link check (`ci-and-releases.md#the-docs-link-check`) if that check already covers non-doc links, or a lightweight periodic manual check otherwise (not a runtime fetch — the whole point is never fetching from the app). Adopted: `apps/desktop/internal/dawcatalog/catalog.go` holds the one constant (`REAPER.DownloadURL`); the docs-link check applies to Markdown, not Go source, so this stays a manual check for now (recorded, not solved, by this PRD).
- [x] **A5. REAPER trial vs. purchase framing.** REAPER installs as a fully-functional evaluation with a purchase reminder; should the app's copy mention the trial, or just say "REAPER" and let the vendor's own page explain licensing? Recommendation: let the vendor's page speak for itself; the app's copy stays neutral ("REAPER — a digital audio workstation this suite can use"). Adopted in `dawcatalog.REAPER.LicenseNote`; final copy review is still Phase 4.
- [x] **A6. When does Audacity actually enter the catalog?** Gated on `docs/roadmap.md:59`'s precondition (shared contract and REAPER workflow proven) — should this PRD's catalog have an Audacity row from day one marked "coming soon," or should Audacity be added by its own future phase once that precondition is met? Recommendation: the latter, to avoid advertising a capability with no working adapter behind it yet. Adopted: `dawcatalog.Catalog` lists REAPER only.
- [x] **A7. Re-detection triggers.** Manual "Check again" only, or also re-check automatically on app relaunch? Recommendation: manual only for the first cut — an automatic background check adds polling complexity for a fact that changes rarely. Adopted; deferred to Phase 3 (the UI action). Phase 1 only exposes `Detect`/`DetectAll` as on-demand calls with no polling of their own.

## Users & Context

**Primary User**: a first-time narrator with no DAW installed, starting fresh with this suite.
**Secondary User**: an existing narrator who wants to try a second, not-yet-installed DAW once one is supported (e.g., Audacity, once added).
**Current behavior**: leaves the app, searches the web for "REAPER download," and hopes they land on the real vendor site; the app gives no acknowledgment that a DAW is even needed until Tracks or Proofing quietly fail to work.
**Trigger**: first launch with no DAW detected, or opening Settings to check DAW status.
**Success state**: the narrator sees a short, clear list of supported DAWs, knows which (if any) is already installed, and reaches the real vendor download page in one click for anything missing.
**Job to Be Done**: When I'm new to this suite, I want to know what software I need and get to the real place to download it, so I don't have to guess or worry I downloaded something fake.
**Non-Users**: narrators who already have REAPER installed and linked — they see this surface rarely, if ever, and it never blocks them.

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | Hardcoded DAW catalog (REAPER; name, publisher, license note, official download URL) | 1 |
| Must | On-demand detection (registry/well-known path) reporting installed/not-installed per catalog entry | 1 |
| Must | UI listing the catalog with detection state | 2 |
| Must | "Get REAPER"-style button opens the vendor's official download page via `runtime.BrowserOpenURL`; button always visible per entry, disabled/relabeled once detected | 2 |
| Must | Explicit narrator click required before any browser navigation; no auto-open | 2 |
| Should | "Check again" action re-runs detection without restarting the app | 3 |
| Should | Copy reviewed for no implied affiliation/endorsement | 4 |
| Could | Handoff link into the DAW Link flow once a DAW is detected | 3 |
| Won't | Downloading, installing, executing, or version-checking any DAW; Audacity catalog entry before its own precondition is met | - |

**User flow (target):** first launch with no DAW detected shows a short panel: "This suite works with REAPER. Get it from the official site," with a button that opens `reaper.fm`'s download page in the default browser; the narrator installs it themselves and returns to the app; they click "Check again" and see "REAPER detected"; the same panel is reachable later from Settings.

## Technical Approach

**Feasibility**: HIGH for detection and the browser-open action (both are small, well-precedented — `update.go:163` already does the browser-open half, and `project-workspace-and-daw-link` Phase 6 already shipped the Windows registry/path locator); MEDIUM was the original estimate for getting Windows registry/path detection right across REAPER's various install modes (per-user vs. per-machine, portable installs that don't register at all) — resolved by reuse rather than a second implementation.

**Architecture notes**

- New small Go package `apps/desktop/internal/dawcatalog` holding the literal catalog (name, publisher, license note, download URL as Go string constants — never loaded from a file the narrator or a remote source could edit) and a `Detect`/`DetectAll` function per entry, behind a `Detector` interface so tests can fake the registry/filesystem. **Delivered in Phase 1**: rather than a second registry/path implementation, `dawcatalog.DefaultDetectors()` wires REAPER's entry straight to `apps/desktop/internal/daw.LocateReaperExecutable` (`project-workspace-and-daw-link` Phase 6, [ADR 0092](../adr/0092-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md)) — same signature, no adapter needed.
- A new Wails binding (e.g., `DawCatalogList()` returning catalog entries plus detection state, and `DawCatalogOpenDownloadPage(id string)` that looks up the id in the same hardcoded catalog server-side and calls `runtime.BrowserOpenURL` — the id, not a URL, crosses the Wails boundary, so nothing UI-supplied can pick an arbitrary destination). This is a `hostAPIVersion` bump. **Phase 2, not built yet.**
- UI: a small panel/dialog on existing primitives (`Dialog`, `Panel`), reachable from Settings and, per A1, optionally a first-run prompt; no new primitive expected. **Phase 2, not built yet.**
- Threat model: add a row for (a) filesystem/registry inspection to detect third-party software (read-only, no new attack surface beyond existing registry-read patterns) and (b) opening a browser to a hardcoded-but-external URL (spoofing risk is nil because the URL is a compile-time constant, not derived from anything the narrator or network supplies — document this explicitly since it is the safety property the whole feature rests on). **Not yet added**; per this PRD's own cross-cutting note this lands "in Phase 1 or 2, whichever lands the detection/browser-open code first" — Phase 1 lands only the pure-Go detection package with no Wails binding and no new externally-reachable action yet, so this stays for Phase 2, which adds the actual browser-open binding.
- Reuse note for the DAW Link PRD: **done** — Phase 1 imports `apps/desktop/internal/daw` rather than re-solving "where is `reaper.exe`" a second time. Cross-PRD dependency: `project-workspace-and-daw-link`'s PR chain (#283-#298) is still open (not on `main`), so this PRD's Phase 1 branch is based on that chain's current tip (`feat/project-workspace-and-daw-link-p7-p8-verify-and-launch`, #298) instead of `main`, and will need a rebase onto `main` once that chain merges.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Portable/non-installer REAPER installs are invisible to registry detection | Medium | Fall back to well-known paths; accept "not detected" as a soft false negative — the narrator can still use "Get REAPER" or their own copy, this feature never blocks anything |
| Vendor changes their download URL and the hardcoded constant goes stale | Low-Medium | Single source-of-truth constant, easy one-line fix; A4 proposes a periodic manual check |
| Copy is read as implying partnership/endorsement | Medium | Phase 4 dedicated copy review before ship; keep language factual ("this suite can use REAPER") |
| Detection code duplicates or conflicts with the DAW Link PRD's later W11 work | Medium | Resolved: Phase 1 imports `internal/daw` directly instead of duplicating it |
| Registry/filesystem probing on narrator's machine reads more than intended | Low | Scope the probe to documented, narrow registry keys/paths only; code review |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | DAW catalog and detection | Go package, hardcoded catalog (REAPER only), registry/path detection behind a fakeable interface, unit tests | complete | - | - | - |
| 2 | "Get it" UI | Settings panel (and optionally first-run prompt per A1), bindings, browser-open action, states | complete | - | 1 | - |
| 3 | Recheck and handoff | "Check again" action, optional link into the DAW Link flow once detected | pending | - | 2 | - |
| 4 | Copy and legal review | Review every screen's wording for affiliation/endorsement implications; finalize A5 framing | pending | Can run alongside 2-3 | 2 | - |

**Phase 1.** Goal: know, on demand, whether REAPER is installed, with no false claims of certainty. Success: Go unit tests against faked registry/filesystem state (present, absent, portable-install-not-registered). **Delivered**: `apps/desktop/internal/dawcatalog` (`catalog.go`, `detect.go`, `detectors.go`), 12 unit tests, 100% statement coverage, reusing `apps/desktop/internal/daw.LocateReaperExecutable` rather than a second locator.
**Phase 2.** Goal: a narrator can get to REAPER's real download page in one click, with zero ambiguity about what the button does. Success: manual click-through opens the correct external URL in the default browser; Vitest confirms no navigation without a click.
**Phase 3.** Goal: closing the loop after install. Success: manual test — install REAPER, click "Check again," see it detected.
**Phase 4.** Goal: the feature reads as helpful, not as a claim we distribute or endorse third-party software. Success: written sign-off recorded in the Decisions Log.

**Parallelism Notes**: sequential 1 → 2 → 3; Phase 4 (copy review) can run alongside 2 and 3 since it only touches wording, not logic.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | New `apps/desktop/internal/dawcatalog`; `scripts/ci/coverage-floors.json` (new entry) | None expected; new package. Depends on `apps/desktop/internal/daw` existing on the base branch (project-workspace-and-daw-link Phase 6, PR chain #283-#298, not yet on `main`). |
| 2 | `apps/desktop/bindings.go` (new bindings, API bump), `apps/desktop/app.go`, `Settings.tsx`, new panel component, `hostApi.ts`, `Host.*`, `wailsClient.ts`, `mockApi.ts`, catalog/drivers | Other `Settings.tsx`/`fieldSchemas` editors (teleprompter, diagnostics, story-bible, Project Workspace PRDs); any phase bumping `hostAPIVersion` |
| 3 | Same panel component, Settings | Project Workspace PRD's Phase 3/4 (DAW link) if it lands first — the handoff link should point at whatever that flow's entry point ends up being |
| 4 | Copy only across the above files | None expected |

Cross-cutting: every phase follows `CLAUDE.md`'s plan → `change-impact-scan` → TDD → `full-verification-gate` → `feature-cleanup` sequence; a Wails binding change bumps `hostAPIVersion` in all three places (`docs/prds/README.md`); `docs/architecture/threat-model.md` gets its new row in Phase 1 or 2, whichever lands the detection/browser-open code first — Phase 1 lands no binding and no browser-open code, so this is still owed by Phase 2.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Never touch the installer | The app only opens the vendor's own download page; it never downloads, verifies, or executes a DAW installer | Bundle/download the installer like the existing asset-provisioning flow does for models | No license to redistribute third-party commercial or GPL installers this way; running a downloaded installer is a different, larger trust boundary than downloading a model file the app already hashes and pins |
| URL source | Hardcoded Go constants, one per DAW, never fetched or user-editable | A remote-fetched catalog (more easily kept current) | A fetched catalog reintroduces exactly the "who controls this URL" risk the feature exists to avoid; a compile-time constant is auditable in code review |
| Relationship to DAW Link PRD | Detection is upstream and informational only; it does not add a new gate | Make DAW-installed a hard gate before any feature works | The DAW Link PRD already gates on *linked*, not *detected*; duplicating a gate here would be redundant and confusing |
| Audacity's place in the catalog | Deferred until the roadmap's own precondition is met (`docs/roadmap.md:59`) | List Audacity now as "coming soon" | Avoid advertising a capability with no working adapter behind it |
| Scope | Windows-only, matching standing scope | Cross-platform detection now | Consistent with `docs/roadmap.md:52,60`, ADR 0030 |
| Phase 1 detection source | Reuse `apps/desktop/internal/daw.LocateReaperExecutable`, built by `project-workspace-and-daw-link` Phase 6 (ADR 0092), via `dawcatalog.DefaultDetectors()` | Build a second, independent registry/file-association locator in `dawcatalog` itself | The two PRDs need the identical fact (is `reaper.exe` on this machine, and where); `internal/daw`'s locator was already spiked and verified against a real install. Duplicating it would double the maintenance surface and could drift. Cost: this PRD's Phase 1 branch depends on `project-workspace-and-daw-link`'s still-open PR chain (#283-#298) rather than bare `main`, and needs a rebase once that chain merges. |

## Research Summary

**Technical Context**: verified in code and docs on this branch — the absence of any DAW-detection code anywhere in the repo at the time this PRD was written, the REAPER-only/Windows-first standing scope, the existing `runtime.BrowserOpenURL` precedent and its trusted-URL discipline, the first-use provisioning flow's consent pattern (and why it doesn't fit an installer we can't pin), and the Go host's lint-enforced networking fence (unaffected by this feature, since `BrowserOpenURL` performs no HTTP request). Phase 1 additionally verified that `project-workspace-and-daw-link` Phase 6 had, since this PRD was written, shipped exactly the registry/file-association locator this PRD's Phase 1 needed (`apps/desktop/internal/daw`, ADR 0092), so Phase 1 reuses it instead of re-verifying REAPER's registry key names/paths independently.
**Not verified**: REAPER's/Audacity's current official download URLs beyond the one used in `dawcatalog.REAPER.DownloadURL` (`https://www.reaper.fm/download.php`, unchanged from Cockos's long-standing URL, not independently re-confirmed at implementation time); Audacity has no catalog entry yet (A6), so its download URL is not needed until its own phase.

---

*Generated: 2026-09-21*
*Status: Phases 1-2 delivered. Phases 3-4 pending, sequential.*
