// The golden payloads for the workspace alignment and its Phase 3 REAPER navigation: which schema owns each file in
// tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import {
  workspaceAlignmentResultSchema,
  workspaceFXChainsResultSchema,
  workspaceFXPluginsResultSchema,
  workspaceFXResultSchema,
  workspacePeaksResultSchema,
} from '../schemas/workspace';
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
  // WorkspaceListFXChains (Phase 8, ADR 0234): the narrator's FX chains by name.
  'workspace-fx-chains.json': workspaceFXChainsResultSchema,
  // WorkspaceListFX, WorkspaceAddTakeFX and WorkspaceApplyFXChain (Phase 9, ADR 0234): the installed plug-ins, and what
  // adding a plug-in or applying a chain did or why it was refused.
  'workspace-fx-plugins.json': workspaceFXPluginsResultSchema,
  'workspace-fx-added.json': workspaceFXResultSchema,
  'workspace-fx-applied.json': workspaceFXResultSchema,
  'workspace-fx-refused.json': workspaceFXResultSchema,
  // WorkspacePeaks (Phase 5, ADR 0520): one item's real peaks, and one item with no usable source (a Reason).
  'workspace-peaks.json': workspacePeaksResultSchema,
  'workspace-peaks-no-source.json': workspacePeaksResultSchema,
};
