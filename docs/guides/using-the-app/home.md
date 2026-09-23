[Using the app](README.md) › Home

# Home

The landing page after opening a project: manuscript status, audiobook time estimates,
recording progress, and shortcuts into the latest [Proofing](proofing.md) comparison and
[Story Bible](story-bible.md) review.

![Home, manuscript found](../../images/ui/home-default.webp)

Next to the narration estimates, **Credits** is the estimated reading time of the opening and closing
credits (the first of each in [Settings, Credits](settings.md#credits)), each with the room tone set in
Settings, General, plus the first chapter announcement read once for every chapter, shown in seconds under
a minute. It is kept apart from the narration totals, and it is left out when there is no credit template.
The [retail sample](settings.md#retail-sample) adds nothing: it is part of a chapter already counted.

The pill at the top right of every page says whether a REAPER project is linked; see
[Navigation](navigation.md) for its states.

The estimate card's per-chapter breakdown is collapsed by default; expanding it lists every
chapter with its word count, estimated and actual recorded length, and status.

![Home, per-chapter breakdown expanded](../../images/ui/home-chapter-table-expanded.webp)

Under each actual recorded length a small label says where the number comes from. **measured**
means a recording check of the saved REAPER project found that share of the chapter's words in
the audio. **estimated from status** means the chapter has no current check, so the length is
guessed from its status (half for Recording, all of it from Editing on). A check that is out of
date no longer counts as measured.

### Checking a chapter's recording

**Check** at the end of a row opens the chapter's recording check. Nothing runs until you ask:
the dialog first shows the last result, or says the chapter was never checked, and names the
saved project file it reads ("Based on the saved REAPER project, file modified ..."). Save the
project in REAPER before checking, because the check reads the saved file, not the open session.

**Check recording** (or **Check again**) transcribes the audio items on the chapter's REAPER
track with the Whisper model chosen in Settings, then compares the words with the chapter's text
in order. The progress is real, from the transcription itself; **Cancel** stops it and keeps the
items already transcribed, so the next check is quicker, and **Continue in background** closes
the dialog while the row keeps its percent. The app tells you when it ends, wherever you are.
If the Whisper model is not installed yet, the app asks before downloading it, as Proofing does.

![Home - a chapter's recording check with text still to record](../../images/ui/home-recording-check.webp)

The result reads "Text present: N of M words", then lists the missing text: where it is (the
start or the end not read, a skipped block, a short read, or different text read), which
paragraphs, how many words, the first and last missing words, and where the gap sits in the
audio (the item on the track and the time in its audio file). **Go to paragraph** opens the
manuscript there. The paragraph list shows how many words of each short paragraph were
recorded. Misreads, false starts, retakes and a spoken chapter title never count against you.
The check changes nothing: it never edits the project or moves a chapter's status.

A result goes **out of date** when the saved project changes under it (an item added, removed,
trimmed, moved, muted or switched to another take, an audio file changed) or the chapter's text
changes. The dialog says which, keeps the old counts labelled as from then, and offers
**Check again**; only the changed items are transcribed again.

When a chapter cannot be checked, the dialog says why in plain words and where to fix it: a
chapter that is not linked to its REAPER track gets the track picker right there (the same link
as on the [Tracks](tracks.md) page), a missing project file points to Tracks, and a missing
Transcript Compare tool points to [Settings](settings.md).

Importing (or replacing) the manuscript opens a confirm dialog previewing the detected format,
paragraph count, and proposed chapters before anything changes. Each section is listed with its
subtitle after the title ("Chapter One — Down the Rabbit-Hole") when the heading had one, so you can
check that the importer split the title from the subtitle where you meant it to; a long one is cut
short in the row, and hovering it shows the whole line. If a heading's second line is not really a
subtitle, clear that row's **Subtitle** box: a title that was wrapped onto two lines is joined back
together ("The Girl Who Fell Through the Ice"), and in a plain-text file a line such as an epigraph
goes back into the chapter's text so it is narrated (the row says it "is read as text"). The
**Read a heading's second line as its subtitle** option in Import options does the same for every
row at once; a row you changed by hand keeps your choice.

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
end. The **Import options** group holds the subtitle option, the choice to build the Story Bible
after import, and, for a Markdown file, the chapter heading level.

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
