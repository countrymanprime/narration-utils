[Using the app](README.md) › Manuscript

# Manuscript

The manuscript reader shows the imported chapter text with characters, places, and other
entities highlighted inline, with alternating row shading and any italics, bold or underline
from the original document. Clicking a highlighted name or note opens its details in a side
panel. "Go to line" from the [Story Bible](story-bible.md) keeps the destination line highlighted for 30 seconds.
Text size is adjustable independently of the rest of the app.

![Manuscript reader at the medium text size](../../images/ui/manuscript-reader.webp)

![Manuscript reader at the large text size](../../images/ui/manuscript-reader-large.webp)

Importing keeps the storytelling formatting from a Word, Markdown, plain-text or EPUB manuscript —
italics, bold and underline — and line breaks inside a paragraph (verse, addresses), so the reader
matches the original. Chapter titles and subtitles that Word (or an EPUB's own table of contents)
stores separately are shown as a title with its subtitle. An EPUB's front matter, table of
contents and back matter (endnotes, glossary, and the like) are recognized from the book's own
markup and kept out of the narration chapters, the same as a Word document's front matter. A
plain-text file with no chapter markings, or an EPUB with no table of contents or headings,
still imports as one narration chapter rather than failing or importing nothing narratable — the
import log says so. Re-import a manuscript (Replace manuscript on [Home](home.md)) to pick this up in an older project.

![Manuscript - italic, bold and underline from the source document, and a preserved line break inside a paragraph](../../images/ui/manuscript-formatting.webp)

Bookmark a chapter with the icon at the left of its header; bookmarks show in blue. Chapter
headers stay opaque as you scroll so the text never shows through them.

![Manuscript - a chapter bookmarked, shown with a blue bookmark icon](../../images/ui/manuscript-bookmark.webp)

The reader follows the Light, Dark or System theme, with readable controls in both.

![Manuscript reader in the Dark theme - readable controls and an opaque sticky chapter header](../../images/ui/manuscript-reader-dark.webp)

Chapters default to fully expanded inline; collapsing them switches to a compact list for
jumping between chapters without scrolling through the full text.

![Manuscript, collapsed chapter list](../../images/ui/manuscript-chapter-list.webp)

**Opening credits** sits before the first chapter and **Closing credits** after the last, when the
credit template library (Settings, This Project, [Credits](settings.md#credits)) has an opening or a
closing template. Each shows its word count; open it to read the credits with the project's values
filled in. A token with no value yet stays in brackets, highlighted, and a line below lists the
unresolved tokens. These entries are read-only and are not chapters: they are not in the chapter list or
search. Record the credits as their own files, as ACX expects, not inside a chapter file: Proofing
compares a chapter file with that chapter's text only, so credits recorded inside it are reported as
extra words.

Each narration chapter's header has a **Read aloud** button. It opens the [Teleprompter](teleprompter.md)
read-along for that chapter in a full-screen dialog titled "Read aloud — " and the chapter title, with the
same microphone and model choices, Start reading and Stop. Closing the dialog while it is still listening
asks first ("Stop reading?"); Stop and close ends the session, and nothing recorded in REAPER is affected.

Above the microphone, a **Where you stopped** card looks for the chapter's track in the project's REAPER
file and listens to the last 30 seconds recorded on it (with the same local Whisper model, which it asks
to download first if it is missing). It shows the track, that this is as of the project's last save, and
the word to resume at inside the sentence it matched, with how sure it is. **Resume from here** makes
Start reading begin at that word; **Start from the top** and **Pick a word** (start reading, then click
the word you want) are the other choices, and nothing starts until you press Start reading. When more
than one track could hold the chapter, or none does, the card asks you to choose the track instead of
guessing, and when the recording cannot be read or does not match the chapter it says why and reading
starts from the top.

The dialog marks Story Bible names and your notes in the text, in the same colours as the reader here. A
reading panel beside the text has four tabs: **Key** (what each mark means), **Flags** (see below),
**Notes** (the chapter's notes) and **Story bible** (the entries the chapter mentions). Clicking a marked
name, note or flag opens it in the panel, read-only; it never moves the highlight, the listening position
or the scroll. The panel's arrow button hides it to widen the text, and the dialog remembers on this
computer whether the panel is shown and which tab was last open.

While you read, the dialog marks places where listening suspects something went differently from the
script: skipped words (a dotted underline) and a restart, where you went back and read again (a dashed
underline on the word you went back to). Misreads (a wavy underline) and extra words (a bar before the word
they came before) can also be shown; they are off at first because live listening mishears correct reads
too often to trust them yet. Turn each kind on or off in the **Flags** tab; the dialog remembers your
choice on this computer. Hovering or focusing a flag says what was heard. Clicking it opens it in the Flags
tab with the script's words and what was heard, and **Dismiss** removes it from the text. **Punch from
here** is not available yet. Every flag is only suspected: Transcript Compare over the recording is the
authority. When reading stops, or you close the dialog, the session's flags are kept in the project as
unreviewed findings (a dismissed flag is kept as dismissed), so they can be reviewed later; reading the
chapter again does not add the same flag twice.

Selecting a stretch of text offers actions for it — adding a reader note or sending it to the
Story Bible as a new entry.

![Manuscript - text-selection action popup (+ Note, + Story Bible)](../../images/ui/manuscript-selection-popup.webp)

Choosing "+ Note" opens a dialog to write the note against that selection.

![Manuscript - Add Note dialog open after selecting text](../../images/ui/manuscript-add-note.webp)

Clicking an existing note or a highlighted entity opens a detail sidebar on the right —
the note's anchored text and content for a note, or pronunciation, description, and evidence
for an entity.

![Manuscript - detail sidebar open on a reader note](../../images/ui/manuscript-note-sidebar.webp)

Choosing "Go to line" on a [Story Bible](story-bible.md) entry's evidence opens the Manuscript at that line and
keeps it highlighted for 30 seconds, so you can see where you landed after the scroll.

![Manuscript - the line reached from the Story Bible stays highlighted so it is easy to find](../../images/ui/manuscript-go-to-line.webp)

The Chapters & Search icon opens a panel with the chapter list and a search box. Typing filters
matching chapter titles and subtitles right away; matching lines appear about two seconds after you
stop typing (or immediately on Enter), so a fast typist never sees a flash of "No matches" for a
query that was never finished. Each line result shows the surrounding text with the match
highlighted; choosing one clears the search box, closes the panel, and jumps to that line. The
clear (×) icon empties the box and returns focus to it; Escape clears the box first, then closes
the panel on a second press.

The reader shows only the manuscript's narratable chapters. A table of contents or a Characters
section the importer recognized stays in the project's data (the Story Bible has the readable form
of Characters) but is never a page you page through in the reader, and a saved or shared link into
one tells you so instead of landing there.

---

[← Home](home.md) · [Index](README.md) · [Proofing →](proofing.md)
