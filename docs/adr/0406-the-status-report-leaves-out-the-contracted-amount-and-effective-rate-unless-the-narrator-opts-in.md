# 0406. The status report leaves out the contracted amount and effective rate unless the narrator opts in

**Status:** Proposed
**Date:** 2026-09-27
**Supersedes:** none

## Context

The [production tracking PRD](../prds/production-tracking.prd.md) (Phase 5) adds a **status report export**: an HTML page and a JSON file, written into the project's own `narration-utils/production/reports` folder, carrying the same figures the Production page just showed (hours by stage, book PFH, the deadline and milestone status, and book-wide readiness counts, [ADR 0320](0320-pfh-and-the-effective-rate-come-only-from-logged-hours-and-measured-recorded-time.md)).

Unlike the delivery report ([`internal/deliveryreport`](../../apps/desktop/internal/deliveryreport)), which the narrator keeps for their own records, a status report is the kind of document a narrator hands to someone else: a publisher, a collaborator, a rights holder checking on progress. Two of the figures the page shows — the contracted amount and the effective hourly rate — are financial facts about the narrator's own business, not facts about the book's production progress. A recipient who only needs to know "is chapter 4 on pace" has no need to also learn what the book pays.

The report's other figures (hours by stage, PFH, the deadline, milestones, readiness counts) carry no comparable sensitivity: they describe the book's own progress, not the narrator's finances.

## Decision

`internal/productionreport.Options.IncludeContractedAmount` defaults to `false`. Unless the narrator ticks the box on the Status report panel, the exported report's `rate` object carries `contracted_amount: null` and `effective_rate: null` with a note saying they were left out; neither figure appears anywhere else in the JSON or the HTML page. Opting in writes both, exactly as the Production page's own KPI row shows them (undefined when no amount is set or no hours are logged, never a guess).

This mirrors the delivery report's own opt-in for file paths (`Options.IncludePaths`, off by default): the report's default shape is the one safest to hand to someone else, and the narrator's own choice widens it.

## Consequences

- A status report shared without a second thought (attached to an email, dropped in a shared folder) never carries the narrator's rate unless they meant it to.
- The wire contract (`ProductionReportExport.contractedAmountIncluded`) tells the UI which shape was written, so the panel's confirmation text is accurate without re-reading the file.
- A future recipient-facing use of the report (for example, a template a narrator fills in for ACX) still has to ask for the amount separately if it needs one; this ADR does not add a second, narrower opt-in for other figures, since none of the rest carry the same sensitivity.
