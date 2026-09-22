/**
 * Audiobook opening/closing credit templates (PRD audiobook-credits-templates.prd.md, Phase 1: "Renderer, template
 * store, Settings Credits, preview"). One shared renderer on the Go side (apps/desktop/internal/credits) produces
 * every CreditsRenderResult the UI sees, so what Settings previews here is exactly what later phases (the estimate,
 * the teleprompter) will read and count.
 */

/** kind: "opening", "closing" or "chapter_announcement" (Open Question C8; chapter announcements are Phase 5). */
export type CreditTemplate = { id: string; kind: string; name: string; body: string; builtIn?: boolean };

/** Render's result (apps/desktop/internal/credits.Result): text is exactly what will be read, unresolved names any `[Token]`
 * left unfilled (Open Question C6 - never rendered as silent empty text). */
export type CreditsRenderResult = { text: string; words: number; unresolved: string[] };

/** A project's own credit token values (Open Question C2: per-project ownership except Narrator, which may override
 * the global default). Every field is optional: an unset one is an empty string on the wire. */
export type CreditValues = {
  title?: string;
  subtitle?: string;
  author?: string;
  series?: string;
  bookNumber?: string;
  copyright?: string;
  year?: string;
  copyrightHolder?: string;
  publisher?: string;
  narrator?: string;
};

/** CreditsProjectValues' payload: the project's own saved values, the global narrator default (General.narrator_name),
 * and title/author suggestions seeded from the manuscript's cover lines and docProps (Open Question C3) - never
 * written back, always editable. */
export type CreditsProjectValuesResult = { values: CreditValues; narratorGlobal: string; suggestions: Record<string, string> };

export interface CreditsApi {
  /** Lists the narrator's credit template library, seeding shipped defaults on first use. */
  creditsTemplates(): Promise<CreditTemplate[]>;
  /** Creates a template (empty id) or updates one in place (an id already in the library). */
  saveCreditsTemplate(id: string, kind: string, name: string, body: string): Promise<CreditTemplate>;
  /** Copies an existing template (including a shipped default) as a new, editable entry named "<name> copy". */
  duplicateCreditsTemplate(id: string): Promise<CreditTemplate>;
  /** Removes a template from the library. The narrator owns this library: a shipped default may be deleted too. */
  deleteCreditsTemplate(id: string): Promise<void>;
  /** Reads the current project's own credit values, the global narrator default, and manuscript-seeded suggestions. */
  creditsProjectValues(): Promise<CreditsProjectValuesResult>;
  /** Saves the current project's own credit token values onto the project manifest. */
  saveCreditsProjectValues(values: CreditValues): Promise<CreditValues>;
  /** Renders body with the current project's values (falling back to the global narrator default), the same renderer
   * every credits surface uses. */
  creditsPreview(body: string): Promise<CreditsRenderResult>;
}
