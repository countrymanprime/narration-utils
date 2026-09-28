# Workflow: Technical QC and Handoff

## Goal

Create a final review pass that combines narrator-visible editorial findings with transparent audio measurements and a shareable report.

## Flow

1. Run narration diagnostics for the selected chapters.
2. Review technical findings by severity and listen in context.
3. Measure render-ready material against the project's delivery profile (ACX unless another is chosen; [Master & QC](../guides/using-the-app/master-and-qc.md)).
4. Resolve, dismiss, or document remaining findings.
5. Export a reviewer package containing timestamps, categories, evidence summaries, review state, and optional local audio references.
6. When every pickup is cleared and every required delivery check reads met, confirm the chapter as proofing-done from the Proof chapter view's readiness suggestion (Proofing readiness, [Proof](../guides/using-the-app/proof.md); [stage recommendations](../architecture/stage-recommendations.md)). Confirming is the one click that moves the chapter to Finalized; nothing in steps 1-5 changes its status on its own. If a pickup reopens or the render changes afterward, the suggestion shows "evidence changed since you confirmed" with a one-click revert back to Proofing.

## Scope boundary

V1 reports measured values and profile checks. It does not certify acceptance by ACX or any distributor, modify mastered audio, or upload files.

## Success signals

- A reviewer can reproduce each reported issue from the report.
- A narrator can distinguish measurable technical failures from subjective notes.
