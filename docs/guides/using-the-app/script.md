[Using the app](README.md) › Script

# Script

The Script page is where you prep the book before recording, under **Prep** in the navigation. It has three parts
side by side on a wide window:

- **Chapters · Prep** on the left: every narration chapter, the one you are reading marked. Under a chapter, a count
  such as **3 to confirm** says how many names first heard in it still have a pronunciation the author has not
  confirmed (see [Queries](#pronunciations-characters-and-queries) below). Press a chapter to open it in the reader.
  Below the list, **Marks** is the key to the colours in the text.
- **The reader** in the middle: the imported chapter text with characters, places and other entities highlighted
  inline, with alternating row shading and any italics, bold or underline from the original document. Clicking a
  highlighted name or note opens its details in a side panel. "Go to line" from the [Story Bible](story-bible.md)
  keeps the destination line highlighted for 30 seconds. Text size is adjustable independently of the rest of the app.
- **The rail** on the right, with three tabs: **Pronunciations**, **Characters** and **Queries**.

On a narrower window the chapter list is in the **Chapters & Search** panel, and the rail opens as a panel from the
**Prep rail** button in the band above the text.

An old link to the Manuscript page (`/manuscript`, with a line or chapter after `#`) still works: it opens the Script
page at the same place.

![Script reader at the medium text size](../../images/ui/script-reader.webp)

## Pronunciations, characters and queries

- **Pronunciations** lists every Story Bible name that has a pronunciation: the word, how to say it, and its status
  (**Researched**, **Query sent** or **Author confirmed**). Press a name to open its summary, the same one a
  highlighted name in the text opens; **Open in Story Bible** from there is where you change a pronunciation.
- **Characters** lists the Story Bible's characters with the first line of each description. Press one to open it.
- **Queries** lists every name the author has not confirmed yet, in reading order, with the chapter it is first heard
  in and its status. **Manage queries** opens the Story Bible's queries panel, where you export them as CSV for the
  author and mark each one sent or answered; the list and the chapter counts follow.

![Script - the rail's Queries tab and the chapter list counting the names still to confirm](../../images/ui/script-prep-rail-queries.webp)

![Script reader at the large text size](../../images/ui/script-reader-large.webp)

Importing keeps the storytelling formatting from a Word, Markdown, plain-text or EPUB manuscript —
italics, bold and underline — and line breaks inside a paragraph (verse, addresses), so the reader
matches the original. Chapter titles and subtitles that Word (or an EPUB's own table of contents)
stores separately are shown as a title with its subtitle. An EPUB's front matter, table of
contents and back matter (endnotes, glossary, and the like) are recognized from the book's own
markup and kept out of the narration chapters, the same as a Word document's front matter. A
plain-text file with no chapter markings, or an EPUB with no table of contents or headings,
still imports as one narration chapter rather than failing or importing nothing narratable — the
import log says so. Re-import a manuscript (Replace manuscript on [Home](home.md)) to pick this up in an older project.

![Script - italic, bold and underline from the source document, and a preserved line break inside a paragraph](../../images/ui/script-formatting.webp)

Bookmark a chapter with the icon at the left of its header; bookmarks show in blue. Chapter
headers stay opaque as you scroll so the text never shows through them.

![Script - a chapter bookmarked, shown with a blue bookmark icon](../../images/ui/script-bookmark.webp)

The reader follows the Light, Dark or System theme, with readable controls in both.

![Script reader in the Dark theme - readable controls and an opaque sticky chapter header](../../images/ui/script-reader-dark.webp)

Chapters default to fully expanded inline; collapsing them switches to a compact list for
jumping between chapters without scrolling through the full text (the chapter list on the left does the same on a wide window).

![Script, collapsed chapter list](../../images/ui/script-chapter-list.webp)

**Opening credits** sits before the first chapter and **Closing credits** after the last, when the
credit template library (Settings, This Project, [Credits](settings.md#credits)) has an opening or a
closing template. Each shows its word count and a read time, and opens and closes the same way a
chapter card does — press anywhere on its header, not just the title — with a chevron showing which
way it is set. Both are open by default and stay open or closed the way you leave them for as long as
you keep the project open. Open one to read the credits with the project's values filled in. A token
with no value yet stays in brackets, highlighted, and a line below lists the unresolved tokens, with a
**Fill in** next to it that opens the same "Set up the credits" dialog Home offers — see
[Home](home.md) for what it asks and when. A banner above Opening credits does the same while any
token stays unresolved and setup has not been dismissed for the project. These
entries are read-only and are not chapters: they are not in the chapter list or search. Record the
credits as their own files, as ACX expects, not inside a chapter file: Proofing compares a chapter file
with that chapter's text only, so credits recorded inside it are reported as extra words. Each credits
card also has a **Read aloud** button once it has anything to read, opening the same full-screen dialog
described below, titled "Read aloud — Opening credits" or "Read aloud — Closing credits" — see the note
at the end of that section for how it differs from reading a chapter.

The [retail sample](settings.md#retail-sample), once picked, is marked where it is: the chapter header shows
a **Retail sample** tag, and in the open chapter its lines have a rule down their left edge, with "Retail
sample starts" and its length above the first line and "Last line of the retail sample" above the last.

A heading that isn't really a chapter (a part title, an epigraph, or front matter your source read in
as one) is removed from recording from its track panel on [Home](home.md), not from here: choosing
**Not a chapter** takes it out of this chapter list and search too, and **Front matter** keeps it in the
list without recording it. Either way its text is untouched and **Restore** on Home brings it back as a
narration chapter.

![Script, the retail sample marked on lines 1 to 3 of Chapter 3](../../images/ui/script-retail-sample.webp)

Each narration chapter's header has a **Read aloud** button. It opens the [Teleprompter](teleprompter.md)
read-along for that chapter in a full-screen dialog titled "Read aloud: " and the chapter's name - its
title, and its subtitle after an em dash when it has one, the same as everywhere else the app shows a
chapter's name. A compact control bar at the bottom stays in view while you scroll: **Play**, **Stop reading**, the
microphone (a popover with its device list and Refresh) and **Settings** (a popover with the engine and
model). Closing the dialog while it is still listening asks first ("Stop reading?"); Stop and close ends the
session, and nothing recorded in REAPER is affected.

![Manuscript - the Read aloud dialog before reading, with the Where you stopped notice above the text, the reading panel beside it and the control bar below](../../images/ui/manuscript-read-aloud-resume.webp)

Above the text, a compact **Where you stopped** notice looks for the chapter's track in the project's
REAPER file and listens to the last 30 seconds recorded on it (with the same local Whisper model, which it
asks to download first if it is missing). When REAPER is open on that project and **Read track arm state**
is on in Settings (an experimental REAPER action), it asks REAPER where the track is now: the edit cursor
when it sits on the track's recording, otherwise the end of the recording, including a take you have not
saved yet, and labels it "in REAPER now". Otherwise it reads the saved project and says it is as of the
project's last save. While REAPER is recording on the chapter's track it offers nothing and reading starts
from the top. It shows the track, where it read it, and the sentence it matched. **Resume from here** makes Play begin at that word - shown as a clearable chip
in the control bar ("Starts at '…'") until you start or clear it; **Start from the top** and **Pick a word**
(start reading, then click the word you want) are the other choices, and nothing starts until you press
Play. Choosing any of the three clears the notice at once for the rest of this dialog's open: it does not
ask again after a session ends, so the next Play begins at the top with nothing to clear. Starting playback
or recording in REAPER clears it too, without choosing anything. With **Read track arm state** on, moving
REAPER's edit cursor onto the recording while the notice shows makes it look again from there. A chapter already
recorded to its last word says so instead of offering to resume past the end. When the match is uncertain or
a confirmed track has a problem (renamed, missing, or linked to more than one chapter), the notice says so
with a link to the Tracks page instead of asking you to pick a track here; when the recording cannot be read
or does not match the chapter it says why and reading starts from the top.

The dialog marks Story Bible names and your notes in the text, in the same colours as the reader here. A
reading panel beside the text has four tabs: **Key** (what each mark means), **Flags** (see below),
**Notes** (the chapter's notes) and **Story bible** (the entries the chapter mentions). Clicking a marked
name, note or flag opens it in the panel, read-only; it never moves the highlight, the listening position
or the scroll. The panel's arrow button hides it to widen the text, and the dialog remembers on this
computer whether the panel is shown and which tab was last open.

![Manuscript - Read aloud listening, with read words dimmed, the current word highlighted and Story Bible names marked](../../images/ui/manuscript-read-aloud-listening.webp)

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

![Manuscript - a suspected restart opened in the Flags tab, with the script's words and what was heard](../../images/ui/manuscript-read-aloud-flag.webp)

Reading the opening or closing credits opens the same dialog and control bar, titled "Read aloud:
Opening credits" or "Read aloud: Closing credits", but a few things are different: there is no **Where
you stopped** notice (the credits are not on a REAPER track), and a warning naming any token still
without a value takes its place when one is unresolved, with **Fill them in Settings** — the same
warning and action the [Teleprompter](teleprompter.md) page shows for the credits. Flags are still shown
as you read, but the Flags tab says "Flags on the credits are not kept" instead of a save state: nothing
about the credits is written to the project's findings, so re-reading them raises the same flags again.

![Manuscript - the Read aloud dialog on the opening credits, with the unresolved-token warning in place of the resume notice](../../images/ui/manuscript-read-aloud-credits.webp)

Selecting a stretch of text offers actions for it — adding a reader note or sending it to the
Story Bible as a new entry. When the selection is one word, it also offers **Look up**.

![Script - text-selection action popup on one word (+ Note, + Story Bible, Look up)](../../images/ui/script-selection-popup.webp)

Choosing "+ Note" opens a dialog to write the note against that selection.

![Script - Add Note dialog open after selecting text](../../images/ui/script-add-note.webp)

Clicking an existing note or a highlighted entity opens a detail sidebar on the right —
the note's anchored text and content for a note, or pronunciation, description, and evidence
for an entity.

![Script - detail sidebar open on a reader note](../../images/ui/script-note-sidebar.webp)

Choosing "Go to line" on a [Story Bible](story-bible.md) entry's evidence opens the Script page at that line and
keeps it highlighted for 30 seconds, so you can see where you landed after the scroll.

![Script - the line reached from the Story Bible stays highlighted so it is easy to find](../../images/ui/script-go-to-line.webp)

The Chapters & Search icon opens a panel with the chapter list and a search box. Typing filters
matching chapter titles and subtitles right away; matching lines appear about two seconds after you
stop typing (or immediately on Enter), so a fast typist never sees a flash of "No matches" for a
query that was never finished. Each line result shows the surrounding text with the match
highlighted; choosing one clears the search box, closes the panel, and jumps to that line. The
clear (×) icon empties the box and returns focus to it; Escape clears the box first, then closes
the panel on a second press.

A chapter with a live "Suggested: Editing/Proofing/Finalized" recommendation ([Home](home.md)'s
per-chapter stage suggestions) shows that same wording under its title here too, so it is visible
while browsing chapters without opening the estimate breakdown. It is read-only in this list -
Confirm, Dismiss and the evidence view stay on Home and, for a chapter in Proofing, on the
[Proofing](proofing.md) panel.

The reader shows only the manuscript's narratable chapters. A table of contents or a Characters
section the importer recognized stays in the project's data (the Story Bible has the readable form
of Characters) but is never a page you page through in the reader, and a saved or shared link into
one tells you so instead of landing there.

## Mark up the script

While prepping, select words on one line and choose **Mark up** to note how to read them: **Stress** (a dotted
underline), **Breath** (one slash after them), **Pause** (two slashes) or **Speaker** (a name chip before them; the
Story Bible's characters are one press away, or type any name). The marks are kept in the project's
`narration-utils/prep/markup.json`, separate from the manuscript, so a re-import keeps them. To take a mark off,
select the same words and choose **Mark up** again: the dialog lists the marks already there, each with **Remove**.

The marks never change the text you select or search. When the words under a mark change (an edited manuscript
re-imported, say), the mark is not moved to a guess: the line says **Text changed here** and names the mark and the
words it was on, with a **Remove**; a mark whose line is gone is listed above the chapter. Extra spaces or line breaks
alone never count as a change.

## Look up a word

Select one word (a double-click does it) and choose **Look up**. A panel opens on the right with
what an offline English dictionary says about it: each part of speech (noun, verb, adjective,
adverb) with its numbered meanings, most common first, the dictionary's own examples, and the
synonyms and antonyms it lists. A word with an ending, such as "curiouser" or "ran", is looked up
under the word it comes from, and the panel names that word. Punctuation and quotes around the
word are ignored.

![Script - the Look up panel for "bank": definitions, examples and synonyms by part of speech, with the dictionary's credit](../../images/ui/script-word-lookup.webp)

The dictionary is the [Open English WordNet](https://en-word.net/) 2025 Edition, used under
CC BY 4.0; its credit is at the foot of every answer. It is kept on your own computer and every
lookup works without an internet connection: nothing you select is sent anywhere. It has single
English words (US English), not phrases, and most names and invented words are not in it; the
panel says so plainly when a word is not there.

![Script - Look up for a word the dictionary does not have](../../images/ui/script-word-lookup-not-found.webp)

The dictionary is not bundled with the app. The first time you look a word up, the app asks
before downloading it (about 10 MB, 16 MB on disk once installed), and shows its version,
publisher, licence and where it will be kept. Nothing downloads until you choose **Download
dictionary**; once it is installed, the word you asked about is looked up. If the copy on your
computer is ever damaged, Look up asks to download it again ("Repair the dictionary?") instead of
showing a garbled answer. You can check, repair or remove the dictionary any time in
[Settings, Local assets](settings.md#local-assets).

![Script - the first Look up asks before downloading the dictionary](../../images/ui/script-word-lookup-download.webp)

---

[← Production](production.md) · [Index](README.md) · [Proofing →](proofing.md)
