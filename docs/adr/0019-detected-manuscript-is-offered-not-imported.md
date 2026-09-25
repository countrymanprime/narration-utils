# 0019. A manuscript found in the project folder is offered, never imported automatically

- **Status:** Accepted
- **Date:** 2026-09-18
- **Related:** Its extension list is amended by [ADR-0103](0103-txt-and-epub-are-accepted-import-formats-hand-rolled-drm-refused-and-offered-for-detection.md), which adds `.epub` and `.txt`; the offer/accept mechanism below stands.

## Context and problem

Opening or creating a project whose folder already holds the manuscript (`manuscript.docx`, `manuscript.md`) still showed "No imported manuscript", leaving the user to browse for a file that sat right there. Importing on its own would be wrong: an import writes project data, and replacing or picking the wrong file has a real cost.

## Decision drivers

- The user should not have to browse for a manuscript that already sits in the project folder.
- An import writes project data, and replacing or picking the wrong file has a real cost.

## Considered options

1. Detect the manuscript and offer to import it, importing only on the user's accept
2. Import a detected manuscript automatically
3. Keep the status quo: show "No imported manuscript" and leave the user to browse

## Decision outcome

**Chosen option: detect the manuscript and offer to import it, importing only on the user's accept**, because it saves the user from browsing for a file that sits right there, while an automatic import would write project data and could pick the wrong file.

- `manuscript.DetectSource` (`shell/internal/manuscript/detect.go`) looks in the project folder only (not recursively) for a regular file whose name is `manuscript` — case-insensitive — with an extension the importer supports (`.docx`, `.md`, `.markdown`; `.docx` preferred). It returns nothing once a manuscript has been imported, and ignores Word lock files (`~$manuscript.docx`), directories and unsupported formats such as `.txt`.
- `Bootstrap` includes `manuscriptCandidate` `{ path, name }` when nothing is imported and a file is detected.
- `Home.tsx` asks "Import manuscript?" with the file name. Import calls `manuscriptBeginImport(path)` and continues into the normal preview dialog (section review, character suggestions, then commit); Cancel leaves everything as it was.
- Declining is remembered for the session only, in module memory; the offer returns the next time the app starts. The import button on Home is always available.
- `ManuscriptBeginImport` accepts only the exact path Detect currently reports, so the binding cannot begin an import from an arbitrary location.

### Consequences

- **Bad:** Detection adds a directory read to `Bootstrap` for projects without an imported manuscript.
- **Neutral:** A project folder with several candidates offers one by the documented preference; picking another file uses the import button.
- **Neutral:** The host API version is 4 (with the removal of the hotwords export binding); the added binding and Bootstrap field are covered by that bump.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Import a detected manuscript automatically

- Bad, because an import writes project data, and replacing or picking the wrong file has a real cost.
