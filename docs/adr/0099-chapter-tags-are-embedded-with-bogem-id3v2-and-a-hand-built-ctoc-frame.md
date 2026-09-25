# 0099. Chapter tags are embedded with bogem/id3v2 and a hand-built CTOC frame, into a new file, MP3 only

- **Status:** Accepted
- **Date:** 2026-09-22

## Context and problem

Phase 12 of [reaper-automation-follow-through.prd.md](../prds/reaper-automation-follow-through.prd.md) ("Chapter tag embedding") was scoped as "Go ID3 CHAP/CTOC writer producing a new file beside the render (library and license TBD - needs research), explicit action, tests on fixtures", with the goal "chapter metadata in rendered MP3s" and success signal "a third-party player shows the chapters; the source render is untouched." D17 (implementation plan) requires any new Go dependency to be AGPL-3.0-or-later compatible.

Two things needed research before writing any code:

**Which library.** Considered:

- **`github.com/bogem/id3v2/v2`** (MIT). The most widely used Go ID3v2 reader/writer. It has a built-in `ChapterFrame` type implementing the CHAP frame from the [ID3v2 Chapters Addendum](http://id3.org/id3v2-chapters-1.0) (element ID, start/end time or byte offset, a `TIT2` title sub-frame), and it already registers `"CHAP"` in its frame-type table, so a `ChapterFrame` round-trips through `Open`/`Save` without extra plumbing. It has no built-in `CTOC` (table of contents) frame type, but its `Tag.AddFrame(id string, f Framer)` plus an `UnknownFrame{Body []byte}` type let any frame be added as raw bytes.
- **`github.com/sa6mwa/id3v24`** (MIT). A thin wrapper around `bogem/id3v2` that adds a structured `CTOC` type and an `AddCHAPAndCTOC()` helper. It pulls in its own MP3-duration dependency and is a small, lightly-used fork (not the library the wider Go ecosystem reaches for), adding a second dependency surface for one convenience function this package does not need (it computes its own durations, see below).
- **Hand-rolling the whole ID3v2 writer.** Rejected: `bogem/id3v2` already handles the ID3v2 header, frame framing, synchsafe sizes and re-serialization correctly and is battle-tested; reinventing that for one feature is needless risk.

**Decision: `github.com/bogem/id3v2/v2` for the tag and `ChapterFrame`, with the `CTOC` frame body built by hand** (`internal/chaptertags/chaptertags.go`'s `buildCTOCBody`) and attached via `AddFrame("CTOC", UnknownFrame{Body: ...})`. The CTOC body format is small and stable (a null-terminated element ID, a one-byte flags field, a one-byte child count, then each child's null-terminated element ID, per the Addendum) and is exercised by round-trip tests that parse it back out the same way a third-party reader would. This keeps the dependency list at one library, already MIT, with the ecosystem's most-used ID3v2 implementation doing the header/frame mechanics.

**MIT is AGPL-3.0-or-later compatible** (D17): the LICENSE file of `github.com/bogem/id3v2/v2` at the pinned version (`v2.1.4`, `go.sum`-hashed) is the standard MIT text, copyright Albert Nigmatzianov, 2016.

**Which files this applies to.** The PRD's own scope line names "rendered MP3s", but Phase 11 (`internal/renderconfig`, `narration_render.lua`) renders one file *per chapter region* and deliberately never writes `RENDER_FORMAT` (Open Question 7, Phase 11): the render keeps the narrator's last-used sink, and the S5 spike's own scratch run recorded that default as WAV (`docs/research/reaper-spike-s5-render-details.md`, "Findings in detail" 3: `RENDER_FORMAT` decoded to `evaw`, WAV reversed). So Phase 11's own output is neither guaranteed to be MP3, nor - even when it is - a natural target for *multi*-chapter tags: each per-chapter file already *is* one chapter, split at the file boundary; embedding a single CHAP entry spanning a whole per-chapter file adds no navigation a filename does not already give a player.

ID3v2 CHAP/CTOC frames are meaningful for a *single combined* audio file with multiple chapters inside it (the shape "a third-party player shows the chapters" describes) - a file this PRD's phases do not render, since nothing upstream of Phase 12 produces one. Rather than force Phase 11's per-chapter WAV/MP3 outputs into a shape they were never designed for, this phase targets that combined file directly: the narrator supplies its path (a separate MP3 they already rendered, by whatever means - REAPER's own single-file render, a later phase, or a tool outside this app), and `chaptertags.BuildTimeline` computes each chapter's start/end by reading the *durations* of the already-known per-chapter files (Phase 11's `RENDER_TARGETS`, titles from their names) and laying them out sequentially. This reuses the one input this app actually has (chapter names and order) without assuming the combined file's chapters exactly match the per-chapter renders' boundaries beyond what the narrator has arranged.

**MP3 only.** `Embed` refuses a non-`.mp3` destination outright. ID3v2 is not a WAV chapter mechanism this feature supports: RIFF/WAVE has its own, different chapter-adjacent conventions (an `id3 ` RIFF chunk some tools tolerate is not the same read path most audiobook readers use for CHAP/CTOC), and building and testing that is a separate, unresearched feature, not part of this phase's scope.

## Decision drivers

- Chapter metadata in rendered MP3s, with "a third-party player shows the chapters; the source render is untouched" as the success signal.
- Any new Go dependency must be AGPL-3.0-or-later compatible (D17).
- Keep the dependency list at one library, with the ecosystem's most-used ID3v2 implementation doing the header/frame mechanics.
- Phase 11 renders one file per chapter region and never writes `RENDER_FORMAT`, so its output is not guaranteed to be MP3.
- ID3v2 CHAP/CTOC frames are meaningful for a single combined audio file with multiple chapters inside it.

## Considered options

1. `github.com/bogem/id3v2/v2` with a hand-built `CTOC` frame, into a new file, MP3 only
2. `github.com/sa6mwa/id3v24`
3. Hand-rolling the whole ID3v2 writer
4. Tagging Phase 11's per-chapter render files
5. WAV chapter tagging

## Decision outcome

**Chosen option: `github.com/bogem/id3v2/v2` with a hand-built `CTOC` frame, into a new file, MP3 only**, because it is the ecosystem's most-used ID3v2 implementation, MIT (AGPL-3.0-or-later compatible), already round-trips `CHAP`, and a hand-built `CTOC` body keeps the dependency list at one library.

1. **Dependency:** `github.com/bogem/id3v2/v2` (MIT, pinned in `apps/desktop/go.mod`/`go.sum`). No second ID3 library.
2. **Package:** `apps/desktop/internal/chaptertags` - pure local-file logic, no REAPER bridge dependency. `mp3.go` parses MPEG audio frame headers (Layer I/II/III, MPEG 1/2/2.5) to estimate a file's duration by summing frame sample counts, skipping a leading ID3v2 header by its syncsafe size. `chaptertags.go`'s `BuildTimeline` lays out sequential chapter start/end times from a list of `{Title, Path}` (the per-chapter render files); `Embed` copies a narrator-named MP3 to a new file beside it (`<name>.chapters.mp3`), opens the copy (never the original) with `id3v2.Open`, replaces any existing `CHAP`/`CTOC` frames (idempotent re-run), adds one `ChapterFrame` per timeline entry and one hand-built `CTOC` frame referencing them in order, and saves.
3. **Host bindings** (`apps/desktop/bindings_chaptertags.go`, `hostAPIVersion` 16 to 17): `ChapterTagsPreview` reads the render-config service's last successful configure (titles and paths) and reports which files exist on disk yet; `ChapterTagsEmbed(destPath)` builds the timeline and calls `chaptertags.Embed`. Neither ever touches a per-chapter render file or the narrator-named destination file itself - only new copies.
4. **UI:** `apps/ui/src/components/tracks/ChapterTagsDialog.tsx` ("Embed chapter tags…" next to "Link chapters…", "Pickups…" and "Prepare chapter render…" on the Tracks page, no new nav item), gated behind a destination path and an explicit "I understand this writes a new file... the original file is not changed" confirm checkbox before the action is enabled.

### Consequences

- **Good:** Any MP3 the narrator names gets chapter tags computed from Phase 11's chapter titles and file durations, without this feature needing to know how that combined file was produced.
- **Good:** The per-chapter render files Phase 11 already writes (WAV, by the S5 spike's evidence, unless the narrator has changed their last-used render format) are read only for their duration; they are never tagged, renamed or otherwise touched by this phase.
- **Bad:** `CTOC`'s hand-built body is not covered by `bogem/id3v2`'s own tests - only by this package's. If a future change needs richer CTOC sub-frames (a nested table of contents) or fuller Addendum coverage than a flat, ordered list of top-level chapters, extend `buildCTOCBody` and its tests, or write a new ADR that supersedes this one if that means a different library.
- **Neutral:** `mp3Duration` is a frame-summing estimate (it does not decode audio), consistently a little long due to encoder priming/padding frames (LAME's info frame among them); tests tolerate that. It is precise enough for chapter boundaries; it is not a source of truth for exact sample-accurate seeking.
- **Neutral:** A WAV-only or WAV-chapter-tagging feature, if ever wanted, needs its own research and its own ADR: this one covers MP3/ID3v2 only.

### Confirmation

Round-trip tests parse the hand-built `CTOC` body back out the same way a third-party reader would; `mp3Duration`'s tests tolerate its frame-summing estimate.

## Pros and cons of the options

### `github.com/bogem/id3v2/v2`

- Good, because it is the most widely used Go ID3v2 reader/writer, and its built-in `ChapterFrame` round-trips through `Open`/`Save` without extra plumbing.
- Good, because it is MIT, which is AGPL-3.0-or-later compatible.
- Bad, because it has no built-in `CTOC` frame type, so the `CTOC` body is built by hand and covered only by this package's tests.

### `github.com/sa6mwa/id3v24`

- Good, because it adds a structured `CTOC` type and an `AddCHAPAndCTOC()` helper.
- Bad, because it pulls in its own MP3-duration dependency and is a small, lightly-used fork, adding a second dependency surface for one convenience function this package does not need.

### Hand-rolling the whole ID3v2 writer

- Bad, because `bogem/id3v2` already handles the ID3v2 header, frame framing, synchsafe sizes and re-serialization correctly, and reinventing that for one feature is needless risk.

### Tagging Phase 11's per-chapter render files

- Bad, because Phase 11's output is not guaranteed to be MP3, and a single CHAP entry spanning a whole per-chapter file adds no navigation a filename does not already give a player.

### WAV chapter tagging

- Bad, because RIFF/WAVE has its own, different chapter-adjacent conventions, and building and testing that is a separate, unresearched feature.
