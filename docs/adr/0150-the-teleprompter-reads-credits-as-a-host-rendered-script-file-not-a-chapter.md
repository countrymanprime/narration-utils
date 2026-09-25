# 0150. The teleprompter reads the credits as a host-rendered script file, not as a chapter

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

`audiobook-credits-templates.prd.md` Phase 4 asks for "Opening credits" and "Closing credits" to be selectable on the
teleprompter, readable with the highlight following, through the one Go renderer (`internal/credits.Render`) so what the
narrator previews is what is read. The credits are not manuscript chapters and must never become one: `contentKind: "opening"`
is Front Matter (ADR 0004), `manuscript.json` holds no credits (the PRD's "What We're NOT Building"), and the Manuscript
pseudo-entries of Phase 3 exist outside the chapter list by construction. The teleprompter sidecar, however, only emitted the
`script` event the reader needs (spans that map its word indices onto rows) in `--manuscript FILE --chapter ID` mode; its
`--script FILE` mode read plain text and sent no spans. The PRD's Technical Approach names the two options: spans for
`--script`, or a pseudo-chapter. Owner decision C6 (2026-09-23): unresolved tokens warn, and Start is still allowed.

## Decision drivers

- What the narrator previews is what is read, through the one Go renderer (`internal/credits.Render`).
- The credits are not manuscript chapters and must never become one.
- Owner decision C6: unresolved tokens warn, and Start is still allowed.

## Considered options

1. Spans for a named `--script`, read from a host-rendered file
2. A pseudo-chapter

## Decision outcome

**Chosen option: spans for a named `--script`, read from a host-rendered file**, because the credits must never become a manuscript chapter, and one renderer keeps what the narrator previews equal to what is read.

- **The UI names only the kind.** `TeleprompterStart` takes `credits: "opening" | "closing"` instead of `chapter`
  (`apps/ui/src/api/contracts/teleprompter.ts`). The host (`creditsScript`, `apps/desktop/creditsbindings.go`) picks the first
  template of that kind (ADR 0093, the same one the estimate times and the Manuscript entry shows), renders it with
  `credits.Render` and the project's values (the same `creditTokens` `CreditsPreview` uses), and starts the session with
  `teleprompter.Service.StartScript` (`internal/teleprompter/service.go`). The text never travels from the UI to the sidecar.
- **The text reaches the sidecar as a file.** The service writes it to `teleprompter_<stamp>.script.txt` in the session directory
  (mode 0600) and passes `--script FILE --script-id credits-<kind> --script-title "<Kind> credits"`; the file is removed when
  the session ends, like the stop and control files. No manuscript is needed.
- **A named `--script` gets spans.** With `--script-id`/`--script-title`, the sidecar builds the script with
  `chapter_script.text_script` and emits a `script` event like a chapter's: one `paragraph` span per line that has words, ids
  `credits-<kind>-<n>` from 1, `index: null`, and no title span (the name is not read aloud). A plain `--script` is unchanged.
  The reader splits the same text the same way (`creditsParagraphs`/`creditsRows`, `readerModel.ts`); the golden
  `teleprompter-credits-script.json` and a cross-check in `wireContracts.test.ts` pin that both sides agree.
- **Unresolved tokens stay visible and warn (C6).** `creditsScript` never refuses a text with unresolved tokens; the
  placeholder stays in brackets. The Teleprompter page shows a warning naming the tokens, with "Fill them in Settings"
  (`/settings#credits`), and Start stays enabled.
- The credits are offered on the standalone Teleprompter page's picker, first and last around the chapters. The read-aloud
  dialog (opened from a Manuscript chapter) is not given the credits here: its flags are kept as findings per chapter
  (ADR 0117), which credits are not.

### Consequences

- **Good:** One renderer: the preview, the estimate, the Manuscript entry and the teleprompter all render through `credits.Render`, and a
  test pins that the teleprompter text equals the preview's.
- **Good:** The payload shapes are unchanged (the `script` event already allowed `index: null`), so no binding, `hostAPIVersion` bump or
  new schema is needed; the new golden is checked by the existing event schema.
- **Neutral:** The narrator's credits text sits in the session directory for the length of a session. It is their own text in their own
  profile's temp directory, readable by them only, and removed at the end; a crash that skips the watcher can leave it behind,
  like the stop and control files.
- **Neutral:** Choosing which template a project reads (instead of the first of each kind) is still ADR 0093's open follow-up; when it lands,
  only `creditsScript`'s lookup changes. Offering the credits in the read-aloud dialog would need its flags kept somewhere other
  than a chapter's findings, and a new ADR.

### Confirmation

The golden `teleprompter-credits-script.json` and a cross-check in `wireContracts.test.ts` pin that the sidecar and the reader split the text the same way, and a test pins that the teleprompter text equals the preview's.

## Pros and cons of the options

### A pseudo-chapter

- Bad, because the credits are not manuscript chapters and must never become one.
