/**
 * Audiobook opening/closing credit templates (PRD audiobook-credits-templates.prd.md, Phase 1: "Renderer, template
 * store, Settings Credits, preview"). One shared renderer on the Go side (apps/desktop/internal/credits) produces
 * every CreditsRenderResult the UI sees, so what Settings previews here is exactly what later phases (the estimate,
 * the teleprompter) will read and count.
 */

/** kind: "opening", "closing" or "chapter_announcement" (Open Question C8; chapter announcements render per chapter, Phase 5). */
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

/** One chapter's rendered announcement (Phase 5, Open Question C8, ADR 0151): `chapter` is the chapter's heading, which
 * fills [Chapter]; its subtitle fills [Chapter Title]. */
export type CreditsAnnouncement = { chapterId: string; chapter: string; result: CreditsRenderResult };

/** The retail sample the narrator picked (Phase 5, Open Question C10, ADR 0152), measured against the current manuscript:
 * where it starts and ends (the reader's line numbers, from 1 within each chapter) and how long it runs at ~155 words a
 * minute. A marker only: it adds no time to the estimate. */
export type RetailSample = {
  startParagraphId: string;
  endParagraphId: string;
  startChapterId: string;
  startLine: number;
  endChapterId: string;
  endLine: number;
  words: number;
  seconds: number;
};

/** CreditsRetailSample's and CreditsSaveRetailSample's answer: the sample (null when none is picked, or when a saved one
 * cannot be measured any more) and, in that last case, why (`problem`, otherwise empty). */
export type RetailSampleAnswer = { sample: RetailSample | null; problem: string };

/** A credits row's status (Credits in the Chapter Table, CT2): the same five values a manuscript chapter's own status
 * has ("not_started" | "recording" | "editing" | "proofing" | "finalized"). */
export type CreditsStatus = string;

/** CreditsStatuses' payload: "opening" and/or "closing" keys, each a CreditsStatus. A kind never set is absent, and the
 * UI treats that as "not_started", the same default a manuscript chapter with no note has. */
export type CreditsStatuses = Record<string, CreditsStatus>;

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
  /** Renders body once per narration chapter, filling [Chapter] and [Chapter Title] from that chapter (Phase 5). */
  creditsChapterAnnouncements(body: string): Promise<CreditsAnnouncement[]>;
  /** Reads this project's retail sample, measured against the current manuscript (Phase 5). */
  creditsRetailSample(): Promise<RetailSampleAnswer>;
  /** Picks paragraphs start..end (both included) as the retail sample; refused over 5 minutes. Two empty ids clear it. */
  saveCreditsRetailSample(startParagraphId: string, endParagraphId: string): Promise<RetailSampleAnswer>;
  /** Reads this project's credits row statuses (Credits in the Chapter Table, Phase 1). */
  creditsStatuses(): Promise<CreditsStatuses>;
  /** Sets kind ("opening" or "closing") to status, on the project manifest so it survives Replace manuscript and Clear
   * derived data, unlike a manuscript chapter's own status. */
  setCreditsStatus(kind: string, status: CreditsStatus): Promise<CreditsStatuses>;
}
