# 0170. The Delivery report is built by the host into the project sidecar without paths, and the host judges the limits

**Status:** Proposed
**Date:** 2026-09-23

## Context

Phase 7 of [the diagnostics PRD](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) asks for an exported report, HTML
and JSON with the same finding IDs and review states, redactable, in a sidecar folder, and deterministic. Before it, the
Delivery page judged each measured value against the narrator's limits itself, mirroring `measure.Evaluate` in
TypeScript (Phase 5), and Phases 5 and 6 left moving that judgement to the host to this phase, because a report written by
the host needs the host's own findings with their IDs. Open Question 7 recommended one self-contained HTML plus a JSON,
local paths redacted by default with an explicit opt-in, no audio and no zip. Writing a file the narrator will send to
someone else is a new place the app writes (threat model row 6h).

## Decision

- **The host judges.** Every answer of the measurement job (`MeasureAnalyze/State/Cancel`) carries each measured file's
  `delivery_qc` findings from `measure.Evaluate`, judged against the effective Delivery settings at the moment it is read
  (`judgeMeasureJob`, `apps/desktop/delivery_report.go`), or a `limitsError` when a stored limit is not a number. The page
  shows what the findings say (`apps/ui/src/components/delivery/deliveryLimits.ts`) and no longer judges. The findings are
  not saved.
- **The host builds the report from what it holds.** `DeliveryExportReport(includePaths)` takes only the narrator's one
  choice. It reports the last measurement and the last diagnostics check, the limits in force, each finding's review state
  from the project's findings store, and the installed assets' versions, through `internal/deliveryreport`: one model,
  rendered as indented JSON and as one HTML page from `html/template` with inline styles, no script and nothing fetched.
  Files and findings are sorted and maps are written in key order, so the same input gives the same bytes apart from
  `generated_at`.
- **It writes only into the project's sidecar.** `<project>/narration-utils/delivery/delivery-report-<UTC stamp>[-n].{html,json}`,
  each through a temporary file and a rename, never over an earlier report and never next to the audio. Without a
  project, while a job runs, or with nothing measured, it refuses and writes nothing.
- **No path by default.** A file is named by its base name and a reference (F1, F2, ...); a known path in a message or in
  evidence becomes its file name, its folder `[folder]`, and any other absolute path is removed. The narrator can include
  full paths. No audio, audio reference or manuscript excerpt is ever written; a finding's chapter is.
- **Open means not dismissed.** Every finding the narrator has not dismissed is listed as open, and every file not measured
  or not checked is listed with why. The report says it is a measurement, not a certification.

## Consequences

- The page and the report cannot disagree about a value, and a finding has one ID in both; a second TypeScript copy of
  `Evaluate`'s rules is gone (the browser mock keeps one, as mocks do).
- A limit changed in Settings still re-judges what is on screen, because the host judges on every read; the price is one
  settings read per poll, which is small.
- Delivery's findings are not in the findings store, so their review state reads unreviewed until the review dashboard
  ingests them; the report reads the store anyway, so nothing changes here when it does.
- A fixed folder needs no save dialog and adds no path the page can name. A narrator who wants the report elsewhere copies
  it. Markdown, a zipped package and an opt-in manuscript excerpt are left for when they are asked for.
- Changing where the report goes, what it redacts, or moving the judgement back to the page needs a new ADR that
  supersedes this one.
