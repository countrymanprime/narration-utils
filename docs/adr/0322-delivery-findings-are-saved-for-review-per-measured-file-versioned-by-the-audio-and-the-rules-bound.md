# 0322. Delivery findings are saved for review per measured file, versioned by the audio and the rule's bound

**Status:** Proposed
**Date:** 2026-09-27

## Context

The host judges every measured file against the project's delivery profile each time the measurement is read ([ADR 0179](0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md)). The `delivery_qc` findings that judgement raises were shown only on the Delivery page and in the exported report, which already reads decisions from the findings store by finding id. They never reached that store, so the Review page could not list or decide them. [Delivery Platform Profiles](../prds/delivery-platform-profiles.prd.md) Phase 9 (P12, option A) puts them on the Review page: "go to" opens the Delivery page on the file and rule, and accept, dismiss and defer behave as they do for every other category. A delivery finding has no manuscript position and no REAPER item. A measurement covers only the files the narrator picked. The project's profile can change without a new measurement.

## Decision

1. `deliveryprofile.ReviewFindings` (`apps/desktop/internal/deliveryprofile/findings_adapter.go`) makes one finding per file rule whose result is `not_met` or `not_measurable`. It uses the id `EvaluateFile` already gives the finding (profile id and rule id, not the version), so the Delivery page, the report and the Review page share one decision. A rule's advice (true peak above ACX's advice, digital silence at an edge) is not saved: it is not a missed rule, and it stays on the Delivery page.
2. The evidence carries the rule's label, the requirement it enforces, the profile's title and the unit. The Review page has no profile to look these up in. `deliveryQcEvidenceSchema` gains them as optional fields.
3. `evidence_version` hashes the measured audio's SHA-256 fingerprint, the rule id, the result, the violation, the value to a hundredth, and the rule's bounds. It leaves out the profile's version and a custom profile's revision. A decision therefore holds while the same audio is judged against the same bound. It returns to unreviewed, keeping its note, after a re-render or when the bound is edited. A newer ACX version with the rule unchanged keeps it.
4. Each measured file is its own store scope (`file-` plus 16 hex characters of the path's SHA-256), under the analyzer `measure`. `SaveAnalyzerFindings` replaces that scope. A rule met again leaves its finding marked `not_in_latest_run` (resolved), and measuring one file never touches another file's findings. A file that failed or was cancelled keeps what it had.
5. The host saves when a measurement ends, before it publishes `job:ended`. It saves again after a profile is chosen, saved or deleted, by re-judging the last measurement against the profile now in force. One save runs at a time. A measurement started in another project is never saved into the open project's store.
6. On the Review page, a delivery finding reads as its rule, value and violation ("RMS −24.1 dBFS, below the minimum of −23"). It names its file where other findings name a chapter. It offers **Open in Delivery** in place of **Show in manuscript**, which opens `/delivery#file=<path>&rule=<id>`. The Delivery page then opens that file rule by rule with "Opened from the Review page: …", or says the file is not in the last measurement. It never guesses another file.

## Consequences

- One decision covers the Review page, the Delivery page's report and the exported report, and it survives a restart. Dismissing a delivery finding changes nothing but the review history: not the profile, the measurement or the judgement.
- The Review page's counts and badge now include delivery findings once a file is measured. A project that never measures sees none.
- Delivery findings sort first by chapter, like any finding with no chapter id (`findings.Query`). Filter by the Delivery check category or the Delivery measurement check to see them alone.
- The last measurement is held only for the app's session. After a restart, Open in Delivery finds no file until it is measured again, and the page says so.
- `resetDerived` removes delivery findings with every other finding when the manuscript is replaced or cleared. The next measurement saves them again.
- The Delivery page does not yet mark the finding's own rule inside the file's rule-by-rule table. That table belongs to the page's per-file components, which Phase 10 is changing now, so marking the rule is left for a later change.
