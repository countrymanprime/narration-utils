// The golden payloads for the workspace alignment and its Phase 3 REAPER navigation: which schema owns each file in
// tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { workspaceAlignmentResultSchema, workspacePeaksResultSchema } from '../schemas/workspace';
import { findingNavigationSchema } from '../schemas/findings';

export const workspaceGoldens: Record<string, z.ZodType> = {
  'workspace-alignment-current.json': workspaceAlignmentResultSchema,
  'workspace-alignment-stale.json': workspaceAlignmentResultSchema,
  'workspace-alignment-never.json': workspaceAlignmentResultSchema,
  'workspace-alignment-needs-align-again.json': workspaceAlignmentResultSchema,
  // WorkspaceGoTo and WorkspaceLoop (edit-and-proof-workspace PRD Phase 3) reuse findingNavigationSchema: the same
  // shape as FindingsGoTo/FindingsLoop, sent by apps/desktop/bindings_workspace.go's encodeBinding(FindingNavigation).
  'workspace-go-to.json': findingNavigationSchema,
  'workspace-loop.json': findingNavigationSchema,
  'workspace-navigation-no-item.json': findingNavigationSchema,
  // WorkspacePeaks (Phase 5, ADR 0520): one item's real peaks, and one item with no usable source (a Reason).
  'workspace-peaks.json': workspacePeaksResultSchema,
  'workspace-peaks-no-source.json': workspacePeaksResultSchema,
};
