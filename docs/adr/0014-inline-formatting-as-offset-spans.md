# 0014. Inline formatting is stored as offset spans over canonical plain text

- **Status:** Accepted
- **Date:** 2026-09-18

## Context and problem

The Manuscript page showed plain text only, so italics, bold and underline — the ordinary storytelling formatting an author relies on (a thought in italics, an emphasized word) — were lost at import. The obvious fix, embedding markup (`*x*`, `<i>`) in the paragraph text, would corrupt everything that treats `text` as the source of truth: note anchors (character offsets into `text`), search, the Story Bible and Transcript Compare Python sidecars, and word counts.

## Decision drivers

- Keep the ordinary storytelling formatting an author relies on (italics, bold, underline).
- `text` is the source of truth for note anchors, search, the Python sidecars, and word counts, and must not be corrupted.
- Offsets should match the unit the browser uses for note anchors, so the reader applies them without conversion.

## Considered options

1. Plain, authoritative `text` with a separate list of offset spans per paragraph
2. Embedding markup (`*x*`, `<i>`) in the paragraph text

## Decision outcome

**Chosen option: plain, authoritative `text` with a separate list of offset spans per paragraph**, because embedding markup would corrupt everything that treats `text` as the source of truth.

`text` stays plain and authoritative. Formatting is an optional, separate list on each canonical paragraph:

```json
"spans": [{ "start": 9, "end": 14, "style": "italic" }]
```

- `style` is one of `bold`, `italic`, `underline`. Nothing else (fonts, sizes, colors) is modelled.
- Offsets are **UTF-16 code units** over the final normalized `text` — the unit the browser uses for note anchors — so the reader applies them without conversion.
- The importer computes spans in the same pass that normalizes whitespace (`shell/internal/importer/richtext.go`) so offsets always match the stored text. DOCX reads run properties (`<w:b/>`, `<w:i/>`, `<w:u/>`, with `w:val="0|false|none"` meaning off) and the Emphasis/Strong character styles; Markdown reads `*`, `**`, `***`, `<u>`.
- `canonicalize` writes `spans` only when non-empty; `paragraphPayload` passes it through. It is additive to schema version 1 (older manuscripts simply have none; the Python validator ignores unknown keys).
- The reader (`ParagraphView.tsx`) renders spans as the innermost layer of its existing annotation compositor, beneath interactive entity and note highlights, as `<strong>`/`<em>`/`<u>`.

### Consequences

- **Good:** Notes, search, Story Bible extraction and Proofing are unaffected by formatting.
- **Bad:** Formatting exists only for manuscripts imported after this change; older ones need Replace manuscript.
- **Neutral:** A new style (e.g. strikethrough) means adding it to `styleOrder`, `FORMAT_TAG` and the contract type, with a test — not a schema bump.
- **Neutral:** Switching to inline markup, or a different offset unit, would supersede this ADR.

### Confirmation

A new style is added with a test.

## Pros and cons of the options

### Embedding markup in the paragraph text

- Bad, because it would corrupt note anchors (character offsets into `text`), search, the Story Bible and Transcript Compare Python sidecars, and word counts.
