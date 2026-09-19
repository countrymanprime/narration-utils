# 0019. A manuscript found in the project folder is offered, never imported automatically

**Status:** Accepted
**Date:** 2026-09-18

## Context

Opening or creating a project whose folder already holds the manuscript (`manuscript.docx`, `manuscript.md`) still showed "No imported manuscript", leaving the user to browse for a file that sat right there. Importing on its own would be wrong: an import writes project data, and replacing or picking the wrong file has a real cost.

## Decision

- `manuscript.DetectSource` (`shell/internal/manuscript/detect.go`) looks in the project folder only (not recursively) for a regular file whose name is `manuscript` — case-insensitive — with an extension the importer supports (`.docx`, `.md`, `.markdown`; `.docx` preferred). It returns nothing once a manuscript has been imported, and ignores Word lock files (`~$manuscript.docx`), directories and unsupported formats such as `.txt`.
- `Bootstrap` includes `manuscriptCandidate` `{ path, name }` when nothing is imported and a file is detected.
- `Home.tsx` asks "Import manuscript?" with the file name. Import calls `manuscriptBeginImport(path)` and continues into the normal preview dialog (section review, character suggestions, then commit); Cancel leaves everything as it was.
- Declining is remembered for the session only, in module memory; the offer returns the next time the app starts. The import button on Home is always available.
- `ManuscriptBeginImport` accepts only the exact path Detect currently reports, so the binding cannot begin an import from an arbitrary location.

## Consequences

- Detection adds a directory read to `Bootstrap` for projects without an imported manuscript.
- A project folder with several candidates offers one by the documented preference; picking another file uses the import button.
- The host API version is 4 (with the removal of the hotwords export binding); the added binding and Bootstrap field are covered by that bump.
