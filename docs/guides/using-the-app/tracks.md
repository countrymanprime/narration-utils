[Using the app](README.md) › Tracks

# Tracks

Tracks reads the project's REAPER project file (`.rpp`) directly, so REAPER doesn't need to be
running, and it doesn't need an imported manuscript. Each track shows its color, a Muted badge
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

---

[← Teleprompter](teleprompter.md) · [Index](README.md) · [Settings →](settings.md)
