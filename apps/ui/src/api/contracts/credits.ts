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

/** Confidence is how sure a DetectedCandidate is (credits-token-setup-and-front-matter-detection.prd.md): "high" when
 * two sources agree or an explicit marker was seen, "medium" for one pattern with a positional cue, "low" for a
 * descriptor-derived guess or a lone, unconfirmed source. */
export type Confidence = 'high' | 'medium' | 'low';

/** One credits token value detected from the manuscript's front matter or the stored source file's own metadata
 * (Phase 1 of credits-token-setup-and-front-matter-detection.prd.md): never written anywhere on its own, only ever
 * offered (ADR 0019). token is a credits.Values field name ("Title", "Author", "Series", "BookNumber", "Year",
 * "CopyrightHolder", "Publisher", "Subtitle"), not the render token's bracket form. */
export type DetectedCandidate = { token: string; value: string; source: string; confidence: Confidence; lines?: string[] };

/** CreditsProjectValues' payload: the project's own saved values, the global narrator default (General.narrator_name),
 * and title/author suggestions seeded from the manuscript's front matter and file metadata (Open Question C3) - never
 * written back, always editable. detected carries the same candidates with their source and confidence; suggestions
 * alone stays wire-compatible with what this always returned. */
export type CreditsProjectValuesResult = {
  values: CreditValues;
  narratorGlobal: string;
  suggestions: Record<string, string>;
  detected: DetectedCandidate[];
};

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

/** One token the credits setup prompt asks for (credits-token-setup-and-front-matter-detection PRD Phase 2): `token` is its
 * render name ("Copyright Holder"), `field` the `CreditValues` key to fill ("copyrightHolder"), and `candidate` the value
 * detected from the manuscript to prefill (show its `source` and `lines` as the caption; `low` confidence means "check this"). */
export type CreditsSetupField = { token: string; field: keyof CreditValues; candidate: DetectedCandidate | null };

/**
 * `CreditsSetupState` (credits-token-setup-and-front-matter-detection PRD Phase 2, ADR 0208): whether to ask for the credits
 * values and what to ask for. `needed`: show the "Set up the credits" dialog. `banner`: show the banner (tokens are still
 * unresolved and the narrator did not choose "Don't ask"). `dismissed`: '' (never), 'session' ("Not now") or 'project'
 * ("Don't ask for this project", stored for this manuscript). `fields`: the unresolved tokens of the first opening and
 * closing templates, in order, with what was detected. `candidates`: every detected value for a token the project has not
 * set. `narratorGlobal`: General's narrator name ('' when not set: offer "Use for all my projects").
 */
export type CreditsSetupState = {
  needed: boolean;
  banner: boolean;
  dismissed: '' | 'session' | 'project';
  dismissedAt: string | null;
  documentId: string;
  narratorGlobal: string;
  fields: CreditsSetupField[];
  candidates: DetectedCandidate[];
};

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
  /** Whether to ask for the credits values, and what to ask for (PRD Phase 2). Only reads. */
  creditsSetupState(): Promise<CreditsSetupState>;
  /** "Not now" (`session`) or "Don't ask for this project" (`project`); answers the new state. */
  creditsSetupDismiss(scope: 'session' | 'project'): Promise<CreditsSetupState>;
  /** Fills the project's empty values from the prompt (never replaces a set one); answers the new state. For "Use for all my
   * projects", save the narrator through `saveSettings` (General.narrator_name) and leave `narrator` out here. */
  creditsSetupSave(values: Partial<Record<keyof CreditValues, string>>): Promise<CreditsSetupState>;
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
