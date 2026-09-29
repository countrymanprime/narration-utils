# Story Bible build after import

An opt-in setting and per-import checkbox that chain a Story Bible build onto a successful manuscript import, so a
narrator who always builds right after importing gets it without a second manual step. Delivered by the
story-bible-and-import-ux-briefs PRD's B brief (phase 3); this page replaces that PRD now that it is deleted (its
Open Questions B1-B3 hold the decisions' own reasoning and the measured build durations).

## The path

`apps/ui/src/components/production/ManuscriptImport.tsx` (the import flow, since renamed off "Home") owns the chain:

1. On import success, the import `WorkDialog` closes itself (the same self-closing behavior a successful Story Bible
   rebuild already had, [ADR 0076](../adr/0076-a-host-job-ends-with-one-job-ended-event-the-app-announces-it-and-the-story-bible-rebuild-may-continue-in-the-background.md)).
2. When the per-import checkbox (pre-filled from `ManuscriptGuide.build_after_import`, read once via
   `settingsForScope('global')`) is checked, `api.guideBuild({})` starts and a second `WorkDialog` ("Build the Story
   Bible") tracks it until the host's own `job:ended` event announces it.
3. A build failure is its own toast; it never unmakes the reported import success. Seeded characters
   (`seedCharacterCandidates`) and freshly extracted entities coexist after the chained build, because `merge_locked`
   keeps `manual` entities across a rebuild.
4. `apps/ui/src/hooks/useWorkJob.ts` is the one poll loop behind both the import job and the chained build job (and
   the Story Bible page's own rebuild), pinned by tests on each consumer's success, failure and background-continue
   behavior.

## Decisions worth remembering

- **On by default** (owner decision D8, overriding the PRD's own "off until measured" recommendation).
  `ManuscriptGuide.build_after_import` is a normal Story Bible-category setting, global and project scope like every
  other one.
- **UI-chained, not host-chained** (B3): no binding signature change; the frontend starts the build itself after the
  import job reports success, so a build failure is naturally its own, separate report.
- **Measured cost** (Windows 11 dev venv, `en_core_web_sm`, p50 of 5 runs): import itself is under 0.1s regardless of
  manuscript size; the build is the real cost, roughly 5s of Python/model start-up plus about 1s per 10,000 words (a
  79,000-word manuscript: 14.7s build, 16.8s import-then-build; rules-only, no language model: 1.2s). The chained
  `WorkDialog`'s "Continue in background" makes this acceptable even on a long book. Not measured: the frozen release
  sidecar, or a manuscript longer than about 80,000 words.
- **Sequenced, never overlapped.** Character seeding and the build both rewrite `manuscript_guide.json` from separate
  processes with no lock, so seeding always finishes before a build starts.

## Tests

Vitest: `ManuscriptImport.test.tsx` (checkbox pre-fill, the chained `WorkDialog`, a rejecting `guideBuild` reported
separately from import success, background continuation). Go: `apps/desktop/internal/importer` and `internal/guide`
package tests cover seeding-then-build sequencing and `merge_locked`'s manual-entity survival
(`sidecars/manuscript-guide/tests/test_manuscript_guide.py`).
