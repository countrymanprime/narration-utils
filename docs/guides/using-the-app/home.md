[Using the app](README.md) › Home

# Home

The landing page after opening a project: manuscript status, audiobook time estimates,
recording progress, and shortcuts into the latest [Proofing](proofing.md) comparison and
[Story Bible](story-bible.md) review.

![Home, manuscript found](../../images/ui/home-default.webp)

The estimate card's per-chapter breakdown is collapsed by default; expanding it lists every
chapter with its word count, estimated and actual recorded length, and status.

![Home, per-chapter breakdown expanded](../../images/ui/home-chapter-table-expanded.webp)

Importing (or replacing) the manuscript opens a confirm dialog previewing the detected format,
paragraph count, and proposed chapters before anything changes.

![Home - import manuscript confirm dialog with format/paragraph/chapter preview](../../images/ui/home-import-confirm.webp)

Every dialog in the app can be used from the keyboard. Focus starts inside the dialog (on its
message, outlined when you opened it with the keyboard), Tab and Shift+Tab stay inside it, and the
page behind is hidden from a screen reader until it closes. Escape declines a confirm, and focus
returns to the button that opened it. Clicking the dimmed background never dismisses a dialog,
so a stray click cannot discard a decision, and a running job (such as an import) ignores Escape
until it has finished. The red confirm button marks an action that destroys data.

If the project folder contains a file named `manuscript.docx` or `manuscript.md` and nothing has
been imported yet, Home asks whether to import it. It is only ever an offer — nothing is
imported until you agree, and declining keeps it quiet for the rest of the session. The import
button on Home is always available to pick a different file.

![Home - offer to import a manuscript file found in the project folder](../../images/ui/home-manuscript-offer.webp)

Importing runs in the background and reports what it is actually doing — reading the document,
counting paragraphs and headings, copying the source into the project, adding checked
characters to the Story Bible — in a live activity log, so the progress bar and log always match
the real work.

![Home - a finished manuscript import with its real, step-by-step activity log](../../images/ui/home-import-activity.webp)

Once a manuscript is imported you can read it on the [Manuscript](manuscript.md) page.

---

[← Navigation](navigation.md) · [Index](README.md) · [Manuscript →](manuscript.md)
