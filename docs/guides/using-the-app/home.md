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
paragraph count, and proposed chapters before anything changes. Each section is listed with its
subtitle after the title ("Chapter One — Down the Rabbit-Hole") when the heading had one, so you can
check that the importer split the title from the subtitle where you meant it to; a long one is cut
short in the row, and hovering it shows the whole line.

![Home - import manuscript confirm dialog with format/paragraph/chapter preview](../../images/ui/home-import-confirm.webp)

The message at the top says what was found: the format, the number of paragraphs and of narration
chapters, then how many front matter and reference sections, character suggestions and repairs the
importer made. Below it the sections are grouped by what each will be: **Narration chapters**,
**Front matter** and **Reference material**. Change a row's kind and it moves to its new group at
once, and the counts follow. The small "i" next to Front matter and Reference material says what
that kind is left out of (the audiobook totals and Proofing, and for reference material the chapter
list too) and that it stays readable in the manuscript. Groups that need a decision start open, and
long lists of chapters the importer got right start closed; open or close any group with its
heading. The character suggestions have Select all and Select none. If the importer had to
repair a heading (a title and a subtitle that were run together), the repairs are listed at the
end. For a Markdown file an **Import options** group holds the chapter heading level.

Every dialog in the app can be used from the keyboard. Focus starts inside the dialog (on its
message, outlined when you opened it with the keyboard), Tab and Shift+Tab stay inside it, and the
page behind is hidden from a screen reader until it closes. Escape declines a confirm, and focus
returns to the button that opened it. Clicking the dimmed background never dismisses a dialog,
so a stray click cannot discard a decision, and a running job (such as an import) ignores Escape
until it has finished. The red confirm button marks an action that destroys data. A step that
cannot be cancelled (rebuilding the Story Bible, or an import while it writes to the project) says
so at the top of its dialog, offers no button while it runs, and shows Close when it finishes.

If the project folder contains a file named `manuscript.docx` or `manuscript.md` and nothing has
been imported yet, Home asks whether to import it. It is only ever an offer — nothing is
imported until you agree, and declining keeps it quiet for the rest of the session. The import
button on Home is always available to pick a different file.

![Home - offer to import a manuscript file found in the project folder](../../images/ui/home-manuscript-offer.webp)

Once you confirm, importing runs in the background and reports what it is actually doing — copying
the source into the project, writing the manuscript, adding checked characters to the Story Bible —
in a live activity log, so the progress bar and log always match the real work.

![Home - a finished manuscript import with its real, step-by-step activity log](../../images/ui/home-import-activity.webp)

Once a manuscript is imported you can read it on the [Manuscript](manuscript.md) page.

---

[← Navigation](navigation.md) · [Index](README.md) · [Manuscript →](manuscript.md)
