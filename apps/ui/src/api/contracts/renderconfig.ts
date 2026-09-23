// Per-chapter render configuration (reaper-automation-follow-through PRD, Phase 11, Open Question 7 answered
// (a)): configure only. Sets the render bounds to all regions, the naming pattern to the region name, and the
// output folder, then reports the resulting file names. This never triggers a render: the narrator presses
// Render themselves in REAPER (Ctrl+Alt+R or File > Render). Mirrors
// apps/desktop/internal/renderconfig.Service.Snapshot() exactly: one configure run at a time, reported by phase.

export type RenderConfigPhase = 'idle' | 'configuring' | 'success' | 'error';

export type RenderConfigState = {
  runId?: string;
  phase: RenderConfigPhase;
  message: string;
  /** The folder the last successful (or in-flight) configure used. */
  folder: string;
  /** The predicted output file names (from RENDER_TARGETS), one per chapter region; empty until a configure
   * succeeds, or when no chapter regions exist yet. */
  targets: string[];
  count: number;
};

export type RenderConfigStartResult = { status: 'started' };

export type RenderConfigSuggestedFolder = { folder: string };

export interface RenderConfigApi {
  /** Asks REAPER to set the render bounds to all regions, the pattern to the region name, and the output folder
   * to outputFolder. Never renders anything. */
  renderConfigConfigure(outputFolder: string): Promise<RenderConfigStartResult>;
  /** A default output folder (a "renders" subfolder of the project) the UI may offer to prefill; the narrator
   * can change it before configuring. */
  renderConfigSuggestFolder(): Promise<RenderConfigSuggestedFolder>;
  renderConfigState(): Promise<RenderConfigState>;
  subscribeRenderConfig(onUpdate: (state: RenderConfigState) => void): () => void;
}
