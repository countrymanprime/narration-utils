[Using the app](README.md) › Tracks

# Tracks

Tracks reads the project's REAPER project file (`.rpp`) directly, so listing and playing tracks doesn't
need REAPER to be running or an imported manuscript. Its [REAPER tools](#reaper-tools) are the exception. Each track shows its color, a Muted badge
when it's muted, and how many of its items have playable audio (for example `1/1`). A warning
triangle marks a track with an item whose audio file can't be found on disk, or that isn't
audio at all (such as a MIDI item).

![Tracks page with transport controls and a list of project tracks](../../images/ui/tracks-default.webp)

The transport plays the selected track's audio items back to back. It has play/pause, skip back
and forward 30 seconds, and previous/next track — those two move between tracks, not between
items within one.

While a track plays, the readout beside the controls shows the position and length of the item
currently playing. Skipping stays within that item, and playback stops at the end of the
track's last item.

![Tracks page playing a track, after skipping forward 30 seconds](../../images/ui/tracks-playback.webp)

If a file that was present when the page loaded can't be played (for example, it was moved or
deleted since), playback stops and a message says so.

Selecting a track with no playable audio says so and disables the playback controls (previous
and next track still work).

![Tracks page with a track selected whose audio file is missing](../../images/ui/tracks-unplayable.webp)

If the project folder holds more than one `.rpp` file, Tracks asks which one to read. Backup
copies (`.rpp-bak`, or files inside a subfolder such as Backups) aren't offered. The choice is
remembered for the project.

![Tracks page asking which of two REAPER project files to use](../../images/ui/tracks-rpp-picker.webp)

If the folder has no `.rpp` file at all, Tracks says so. Save the REAPER project into the
project folder and reopen the page.

![Tracks page explaining that no REAPER project file was found](../../images/ui/tracks-no-project-file.webp)

Under the page title, **Link a REAPER project file** (or **Link a different REAPER project file**
once one is linked) is the same link as the pill in the [header](navigation.md). Tracks finds its
`.rpp` on its own either way; the link is what [Proofing](proofing.md) needs.

## Pickups & duplicates

Finding lines you recorded more than once (restarts, pickups and near-duplicate takes) moved to the
[Review](review.md#pickups-and-duplicates) page: **Find pickups and duplicates…** there scans a track,
and each group it finds is reviewed with the rest of your findings.

## REAPER tools

When the project has tracks, five buttons sit beside the page title. **Link chapters…**, **Pickups…**
and **Prepare chapter render…** change the project open in REAPER, through the Narration Utils script
the launcher runs there; nothing is written until you press the dialog's action button.

**Link chapters…** (shown once a manuscript is imported) stamps each chapter's identity onto the REAPER
items that hold its recording. Choose the track for each chapter; **Items to stamp** shows how many of
that track's items will carry it, and **Stamp N items** writes it. An item already stamped with a
different chapter is left alone unless you tick **Overwrite items already stamped with a different
chapter**, and items REAPER no longer has are listed as stale. **Read current stamps** lists what the
project carries now, with each item's status (OK, Text changed since stamping, Manuscript re-imported
since stamping, Chapter no longer in the manuscript, and so on). This is not the same as the
[Chapter links](#linking-chapters-to-tracks) list below: that list is kept by the app and changes
nothing in REAPER, and the dialog starts with every chapter Not linked whatever the list says.

**Pickups…** works with a proofer's pickup list. **Import CSV…** reads a CSV with a start time in
seconds, a note and an optional tag on each row (a first row starting with `start` is skipped as a
header) and adds a pickup marker in REAPER for each; rows that cannot be used are listed with the
reason. The dialog shows how many pickups remain. **Next pickup** moves REAPER's edit cursor to the next
open pickup and shows its note, and **Mark this pickup done** marks it resolved. **Export CSV** saves the
pickups still open as `pickups.csv`.

**Prepare chapter render…** sets REAPER's render to every chapter region, names each file after its
region, and saves into the **Output folder** (a `renders` folder in the project to start with). Press
**Configure render** and it lists the files the render will create. It never renders anything itself:
press Render in REAPER (Ctrl+Alt+R or File > Render) to create the files. If the project has no chapter
regions yet, it says so.

**Embed chapter tags…** adds ID3 chapter markers to an MP3 of the whole book that you have already
rendered, timed from the chapter files of your last chapter render. It lists those chapters and marks
any that are "not rendered yet"; every one must exist first. Enter the path of the combined book MP3 and
tick the confirmation: the file you name is never changed, and a new, tagged copy is written beside it.
This one does not talk to REAPER.

**Cleanup tools…** opens a repair tool in REAPER on the items you have selected there. Select the items
in REAPER first, then press **Open** beside the tool. **Repair Pops/Clicks** is REAPER's own dialog
(REAPER 7.80 or later); **Magnolius DeClick** is a free third-party script for mouth clicks, and works only
if you installed it in REAPER yourself (ReaPack, or Actions > Load ReaScript). Narration Utils never
installs it. Opening a tool changes nothing: you apply or cancel the repair in its own window, and REAPER's
Undo takes it back. If nothing is selected, the tool is missing, or your REAPER is too old, the dialog says so.

**Retakes on lanes…** is for retakes recorded into REAPER's fixed item lanes. It lists every line of
the manuscript (linked with **Link chapters…**) that has retakes on more than one lane of a track, with
each retake's lane, its item name and whether that lane plays in the saved project. Press **Play this
lane** beside the retake you want: that lane becomes the only one playing on its track. A lane plays
across the whole track, so every other lane of that track goes silent, not only for this line.
Nothing else changes, and one Undo in REAPER puts the previous lanes back. Narration Utils never turns
lanes on, converts takes to lanes or builds a comp: if a track is not in fixed-lane mode, or the retake
has changed since you last saved, the dialog says so and changes nothing.

## Linking chapters to tracks

Below the track list, Chapter links shows every narration chapter with the track it's confirmed
to, so checks that need to know "which audio is this chapter" (the [editing check](#editing-check)
below, an evidence view) don't guess by name. A chapter starts **Not linked**; choose a track and press Confirm to
link it. A confirmed chapter shows **Linked** with the track's name, and Change or Clear. Change
replaces the chapter's link, so a chapter is never left linked to two tracks; a track already
linked to another chapter moves to this one. Clear removes every link the chapter has. If the
confirmed track is deleted, or the project points somewhere else, the chapter shows **Track
missing** until it's relinked or cleared. These links are kept in the app's own project data and never
change the REAPER project.

![Tracks page chapter links list with one chapter confirmed to a track](../../images/ui/tracks-chapter-links.webp)

A linked chapter's row also has **Open workspace**, into the [chapter workspace](workspace.md): one
screen to listen to the chapter against its script and see where the recording check found a problem.

## Editing check

Each chapter's row also has **Editing check…**, opening a panel over the same list: whether
empty space, clicks and breaths still need trimming out. The same panel opens from
[Home](home.md#stage-suggestions)'s evidence popover, under **Why**, when the editing signal
names it as the way to resolve what's unknown.

The panel never starts a check on its own: opening it only reads what the last check already
found. **Check editing** (**Check again** once one has run) runs the scan with real progress and
**Cancel**; items already checked are cached, so re-checking after a small edit is fast. Every
result carries the caveat "Analysis of source audio; take FX, item gain and fades are not
applied", since REAPER's own processing isn't part of what's analyzed.

Each of the three classes — Empty space, Click, Breath — has its own state: **Met** (checked, no
open candidate remains), **Not met** (one or more open candidates), or **Can't tell yet** with why
(not checked yet, changed since the last check, no track linked, a maximum gap not set in
[Settings](settings.md), an item this build can't analyze, or the check running). Click and
breath read "Not yet validated on the corpus" until their detectors are validated on a labeled
corpus — a class this build cannot vouch for is never shown as done.

An open candidate lists its time range, class, confidence and reason, with **Hear** to play its
own source audio (a short lead-in included) without touching REAPER, and **Accept**, **Dismiss**
or **Defer** to record your decision — the same review the [Review](review.md) page uses, so a
decision here also shows up there. **Go to in REAPER** and **Loop in REAPER** move REAPER's
cursor or loop the candidate's spot when REAPER is connected; without a connection the buttons
are off and say why, and the rest of the panel works the same either way.

If the chapter isn't linked to a track yet, the panel offers the same track picker the recording
check does, right in place.

## Chapter sync

The first time a REAPER project is linked with a manuscript already imported, a dialog asks **Sync
chapters to tracks?**. It shows what would happen without changing anything yet: which chapters will
be linked by a confident, matching track name, which need you (two tracks look alike, or the closest
one isn't a confident match), which have no track yet, and which tracks name no chapter. **Sync**
turns chapter sync on and links the confident matches; **Not now** leaves every chapter as it was and
asks again only if you unlink and relink the project. The same question can come up from any of the
ways to link a project (the header pill, choosing a project on this page, an import, or reopening a
linked project).

Once on, the Chapter sync panel above the track list says when it last synced and how many chapters
are linked. **Turn off** stops it (chapter links you already made are kept); **Turn on** asks again
from a project that had it off. Its own Needs you list lets you pick the right track and press
**Link** for a chapter sync couldn't confidently match, the same link Chapter links below records. A
track sync doesn't recognize as any chapter's is listed under "Tracks that are not chapters" so it
isn't mistaken for a missing link. Chapter sync only reads the saved project: nothing in REAPER
changes, and a chapter you link yourself is never overwritten.

---

[← Teleprompter](teleprompter.md) · [Index](README.md) · [Chapter workspace →](workspace.md)
