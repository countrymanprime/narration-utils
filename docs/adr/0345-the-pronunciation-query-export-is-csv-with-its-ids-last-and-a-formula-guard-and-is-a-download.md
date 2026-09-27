# 0345. The pronunciation query export is CSV with its ids last and a formula guard, and is a download

**Status:** Accepted
**Date:** 2026-09-27
**Supersedes:** none. Builds on [ADR 0344](0344-a-pronunciation-carries-a-status-and-note-and-the-narrators-own-sits-beside-the-dictionarys-as-the-alternate.md) (status and note). Prep depth PRD ([`docs/prds/prep-depth.prd.md`](../prds/prep-depth.prd.md)) Phase 3, Open Question Q3 (recommendation taken, D22).

## Context

Phase 3 turns the pronunciation statuses into a list of questions for the author: every name not `author_confirmed`, which the narrator exports, sends however they already send things, and marks answered when the author replies. Q3 recommends CSV, reusing the app's existing "hand a file to someone outside the app" pattern. The only CSV export in the app is the pickup list (`internal/pickups/csv.go`, `PickupsDialog.tsx`): a header row with lowercase column names, the host returns the CSV text, and the page saves it as a browser download instead of calling a native file dialog. Phase 6 will read an answered file back, so the file has to identify each row without depending on how an author edits it. The person who opens the file is outside the app, most likely in a spreadsheet, where a cell starting with `=` runs as a formula.

## Decision

- **The list is derived, never stored.** `guide.Service.PronunciationQueries` builds it from the Story Bible on every read, like `VocabularyCandidates`. It holds every name (each entity's own and each alias) whose status is not `author_confirmed`, each exactly once. A missing or unknown status counts as `researched`. The order is reading order: by the first manuscript paragraph that uses the name, then by name, with names that never occur last. The chapter and excerpt are those of that first use.
- **CSV with a header, readable columns first, ids last:** `word, entry, category, chapter, excerpt, pronunciation, source, status, note, entry_id, alias_index`. `source` reads `Yours` for the narrator's own pronunciation. `status` is the key (`query_sent`). `entry_id` and `alias_index` (empty for the entity's own name) let Phase 6 match a row back to its entry, whatever order the author leaves the columns in.
- **Formula guard.** A cell starting with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading apostrophe, so opening the file runs nothing. Reading back strips only an apostrophe that is followed by one of those characters.
- **Read-back is proven now and applied later.** `ParseQueriesCSV` reads an exported file or a hand-edited one: any column order, any header case, CRLF, and a status written as its key or its label ("Author confirmed"). Every row it cannot use (no word or no entry id, an unknown status, a bad alias number) is reported with its line, never dropped or guessed. Matching rows to entries and applying them is Phase 6's; no binding reads a file yet.
- **A download, not a written file.** `GuidePronunciationQueriesCSV` returns `{csv, count}`. The page saves `pronunciation-queries.csv` through the webview's own download, the same as the pickup export. The host writes no file.
- **"Mark answered" is the existing status call.** The panel's Mark sent / Mark answered call `GuidePronunciationSetStatus` (ADR 0344). An answered name leaves the list on the next read. No new write binding is added.

## Consequences

- A narrator can send the whole open list or re-send it after each answer. The file always reflects the Story Bible at the moment of export.
- A spreadsheet user sees an apostrophe in front of an IPA that starts with `-`. That is the price of the guard, and it is stripped again on read-back.
- The list includes every entry the build found that has not been confirmed, including Needs Review candidates. The panel's filter (all / query sent / researched) keeps it usable; if a narrator wants rejected candidates left out, that is a later filter, not a change to what "open" means.
- Two new read bindings, `GuidePronunciationQueries` and `GuidePronunciationQueriesCSV`. `hostAPIVersion` goes from 68 to 69.
