# Using the app

A screenshot walkthrough of the narration workspace, page by page. The screenshots on this
page are generated from the same mock data used by the app's Playwright visual test suite
(`shared/ui/tests/visual/`) — see [`doc-screenshot-sync`](../../.claude/skills/doc-screenshot-sync/SKILL.md)
for how they're kept current when the UI changes.

## Getting started

Launching the app without a project folder attached shows a picker instead of the workspace:
recent projects to reopen, or actions to browse to an existing folder or create a new one.

![No project open yet - recent projects, browse, and create actions](../images/ui/project-picker.webp)

## Navigation

Home, Manuscript, Proofing, Story Bible, Teleprompter, and Tracks are reachable from a sidebar on the left. At
desktop widths it stays open with labels; narrower windows switch it to icon-only, then hide
it behind a hamburger menu that opens it as a slide-in drawer. Settings lives at the bottom
of the sidebar in every layout.

![Primary navigation sidebar at desktop width](../images/ui/nav-sidebar-desktop.webp)

![Primary navigation drawer opened on a narrow window](../images/ui/nav-drawer-mobile.webp)

In the icon-only layout, hover an icon (or tab to it) to see the page's name.

![Icon-only navigation rail with a page name shown on hover](../images/ui/nav-rail-tooltip.webp)

Manuscript, Proofing, Story Bible, and Teleprompter stay locked until a manuscript has been imported;
hovering a locked entry says why. Home and Tracks are always available.

## Home

The landing page after opening a project: manuscript status, audiobook time estimates,
recording progress, and shortcuts into the latest Proofing comparison and Story Bible review.

![Home, manuscript found](../images/ui/home-default.webp)

The estimate card's per-chapter breakdown is collapsed by default; expanding it lists every
chapter with its word count, estimated and actual recorded length, and status.

![Home, per-chapter breakdown expanded](../images/ui/home-chapter-table-expanded.webp)

Importing (or replacing) the manuscript opens a confirm dialog previewing the detected format,
paragraph count, and proposed chapters before anything changes.

![Home - import manuscript confirm dialog with format/paragraph/chapter preview](../images/ui/home-import-confirm.webp)

If the project folder contains a file named `manuscript.docx` or `manuscript.md` and nothing has
been imported yet, Home asks whether to import it. It is only ever an offer — nothing is
imported until you agree, and declining keeps it quiet for the rest of the session. The import
button on Home is always available to pick a different file.

![Home - offer to import a manuscript file found in the project folder](../images/ui/home-manuscript-offer.webp)

Importing runs in the background and reports what it is actually doing — reading the document,
counting paragraphs and headings, copying the source into the project, adding checked
characters to the Story Bible — in a live activity log, so the progress bar and log always match
the real work.

![Home - a finished manuscript import with its real, step-by-step activity log](../images/ui/home-import-activity.webp)

## Manuscript

The manuscript reader shows the imported chapter text with characters, places, and other
entities highlighted inline, with alternating row shading and any italics, bold or underline
from the original document. Clicking a highlighted name or note opens its details in a side
panel. "Go to line" from the Story Bible keeps the destination line highlighted for a minute.
Text size is adjustable independently of the rest of the app.

![Manuscript reader at the medium text size](../images/ui/manuscript-reader.webp)

![Manuscript reader at the large text size](../images/ui/manuscript-reader-large.webp)

Importing keeps the storytelling formatting from a Word or Markdown manuscript — italics, bold
and underline — and line breaks inside a paragraph (verse, addresses), so the reader matches the
original. Chapter titles and subtitles that Word stores on separate lines are shown as a title
with its subtitle. Re-import a manuscript (Replace manuscript) to pick this up in an older project.

![Manuscript - italic, bold and underline from the source document, and a preserved line break inside a paragraph](../images/ui/manuscript-formatting.webp)

Bookmark a chapter with the icon at the left of its header; bookmarks show in blue. Chapter
headers stay opaque as you scroll so the text never shows through them.

![Manuscript - a chapter bookmarked, shown with a blue bookmark icon](../images/ui/manuscript-bookmark.webp)

The reader follows the Light, Dark or System theme, with readable controls in both.

![Manuscript reader in the Dark theme - readable controls and an opaque sticky chapter header](../images/ui/manuscript-reader-dark.webp)

Chapters default to fully expanded inline; collapsing them switches to a compact list for
jumping between chapters without scrolling through the full text.

![Manuscript, collapsed chapter list](../images/ui/manuscript-chapter-list.webp)

Selecting a stretch of text offers actions for it — adding a reader note or sending it to the
Story Bible as a new entry.

![Manuscript - text-selection action popup (+ Note, + Story Bible)](../images/ui/manuscript-selection-popup.webp)

Choosing "+ Note" opens a dialog to write the note against that selection.

![Manuscript - Add Note dialog open after selecting text](../images/ui/manuscript-add-note.webp)

Clicking an existing note or a highlighted entity opens a detail sidebar on the right —
the note's anchored text and content for a note, or pronunciation, description, and evidence
for an entity.

![Manuscript - detail sidebar open on a reader note](../images/ui/manuscript-note-sidebar.webp)

Choosing "Go to line" on a Story Bible entry's evidence opens the Manuscript at that line and
keeps it highlighted for about a minute, so you can see where you landed after the scroll.

![Manuscript - the line reached from the Story Bible stays highlighted so it is easy to find](../images/ui/manuscript-go-to-line.webp)

## Proofing

Proofing transcribes a recorded chapter and compares it against the manuscript. The Setup
step picks the transcription model, chunk length, and any vocabulary hints before starting
a comparison.

![Proofing setup panel before starting a comparison](../images/ui/proofing-setup.webp)

Model, chunk length, and worker count are independent selections — picking a slower, more
accurate model can force other settings to adjust (here, workers dropped to 1 because the
Large model doesn't support Auto).

![Proofing setup panel with a different model, chunk length, and worker count selected](../images/ui/proofing-setup-alt.webp)

Vocabulary hints teach the transcription model unusual names it's likely to mis-hear.
"Suggest from manuscript" proposes candidates from the Story Bible; accepted hints render as
solid pills, suggested-but-not-yet-accepted candidates as dashed outlines you click to accept.

![Proofing - vocabulary hint chips: an accepted term alongside suggested (pending) candidates](../images/ui/proofing-hint-chips.webp)

Once a comparison finishes, the Results step lists every discrepancy between what was written
and what was heard, expandable for the full context around each one. Each row is typed —
a misread word, a skipped one, or words heard that weren't written at all (EXTRA).

![Proofing results table with a discrepancy row expanded](../images/ui/proofing-results.webp)

![Proofing - an EXTRA (words heard but not written) discrepancy row expanded](../images/ui/proofing-results-extra.webp)

## Story Bible

Story Bible tracks every character, place, and organization extracted from the manuscript,
with pronunciation, aliases, and narration notes. Category tabs filter the list.

![Story Bible filtered to the Characters category](../images/ui/storybible-characters.webp)

Selecting an entry opens its detail panel, read-only at first. Press Edit to change
pronunciation, aliases, and notes, then Save (or Cancel). Locked entries can't be edited until
unlocked. Rebuilding is deliberately strict: it favors missing a name over listing ordinary
words, so add unusual names by hand with the + button.

![Story Bible entity detail panel](../images/ui/storybible-entity.webp)

Pressing Edit switches the entry to edit mode, where Save and Cancel appear. Locked entries show
neither Edit nor Save.

![Story Bible - an entry in edit mode, with Save and Cancel shown](../images/ui/storybible-entry-editing.webp)

Entries the build isn't sure about are filed under Needs Review, and their evidence is
highlighted in the review color so it is clear which entries still need a decision.

![Story Bible - a Needs Review entry, its evidence highlighted in the review color](../images/ui/storybible-needs-review.webp)

Typing into the alias field opens a dropdown of existing entries whose name or alias matches,
so a name mentioned under a different spelling can be merged into the entry it already
belongs to instead of creating a duplicate.

![Story Bible alias field with a matching-entries dropdown open](../images/ui/storybible-alias-dropdown.webp)

## Teleprompter

The Teleprompter follows you as you read a chapter aloud: it listens through your microphone
with a local Whisper model and highlights the word you are on. It needs an imported manuscript,
and nothing you say is edited, saved, or sent anywhere.

Choose the chapter, type the name of your microphone exactly as Windows lists it (Settings,
System, Sound), and pick a model. Tiny is the fastest and keeps up on most computers; Small is
more accurate but needs a faster one. The first time you start, the app asks before downloading
the model. It remembers the microphone name for next time.

![Teleprompter before a session, with the chapter, microphone and model choices above the chapter text](../images/ui/teleprompter-setup.webp)

Press Start reading and begin at the top of the chapter, title first. The setup fields fold away
into a bar that stays at the top with the status and a Stop button. Words you have read dim, the
word you are on is filled in, and the page scrolls to keep it near the middle of the screen.
The highlight follows what it hears, not a timer, so it waits when you do.

![Teleprompter listening, with read words dimmed and the current word highlighted](../images/ui/teleprompter-listening.webp)

You do not have to read perfectly. If you skip a word or two it carries on and underlines the
words you missed; if you go back and re-read a sentence it goes back with you. If you stop for
a moment the status says it is waiting for you to return to the script, and it picks up again
as soon as it hears you.

![Teleprompter waiting after the narrator paused](../images/ui/teleprompter-waiting.webp)

When you reach the end of the chapter the status says Done. Press Stop to end the session. You
can leave the page while it runs; coming back shows where you were.

## Tracks

Tracks reads the project's REAPER project file (`.rpp`) directly, so REAPER doesn't need to be
running, and it doesn't need an imported manuscript. Each track shows its color, a Muted badge
when it's muted, and how many of its items have playable audio (for example `1/1`). A warning
triangle marks a track with an item whose audio file can't be found on disk, or that isn't
audio at all (such as a MIDI item).

![Tracks page with transport controls and a list of project tracks](../images/ui/tracks-default.webp)

The transport plays the selected track's audio items back to back. It has play/pause, skip back
and forward 30 seconds, and previous/next track — those two move between tracks, not between
items within one.

While a track plays, the readout beside the controls shows the position and length of the item
currently playing. Skipping stays within that item, and playback stops at the end of the
track's last item.

![Tracks page playing a track, after skipping forward 30 seconds](../images/ui/tracks-playback.webp)

If a file that was present when the page loaded can't be played (for example, it was moved or
deleted since), playback stops and a message says so.

Selecting a track with no playable audio says so and disables the playback controls (previous
and next track still work).

![Tracks page with a track selected whose audio file is missing](../images/ui/tracks-unplayable.webp)

If the project folder holds more than one `.rpp` file, Tracks asks which one to read. Backup
copies (`.rpp-bak`, or files inside a subfolder such as Backups) aren't offered. The choice is
remembered for the project.

![Tracks page asking which of two REAPER project files to use](../images/ui/tracks-rpp-picker.webp)

If the folder has no `.rpp` file at all, Tracks says so. Save the REAPER project into the
project folder and reopen the page.

![Tracks page explaining that no REAPER project file was found](../images/ui/tracks-no-project-file.webp)

## Settings

Settings are split into Global (defaults for every project) and This Project (overrides for
the current one), organized by category.

![Settings, Global scope, General category](../images/ui/settings-general.webp)

Appearance controls the light/dark theme.

![Settings, Global scope, Appearance category](../images/ui/settings-appearance.webp)

![Home with Dark theme selected](../images/ui/theme-dark.webp)

Other categories mix dropdowns and color pickers — Manuscript's own category, for example,
controls the color used to mark reader notes in the text.

![Settings - Global scope, Manuscript category (note color picker)](../images/ui/settings-manuscript.webp)

This Project's "Project data" category is a project-only danger zone: it clears the imported
manuscript, Story Bible, proofing artifacts, and reader notes for the current project, while
leaving its settings in place.

![Settings - Project scope, Project data category (clear derived project data)](../images/ui/settings-project-data.webp)
