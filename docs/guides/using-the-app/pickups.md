[Using the app](README.md) › Pickups

# Pickups

Pickups works through a proofer's pickup list: the places in the recording they want read again. It sits under
**Review** in the sidebar, after [Proof](proof.md). The list lives in REAPER as pickup markers, so the page talks to
REAPER through the Narration Utils script the launcher runs there, and each action says so if REAPER is not
answering.

This is the proofer's list. The lines you recorded more than once are a different kind of pickup, found by
[Find pickups and duplicates](proof.md#pickups-and-duplicates) on Proof and reviewed there with the rest of your
findings.

## Importing and exporting the list

**Import proofer CSV…** reads a CSV with a start time in seconds, a note and an optional tag on each row (a first
row starting with `start` is skipped as a header), and adds a pickup marker in REAPER for each. Rows that cannot be
used are listed with the reason, and the rows that can are still imported. Importing the same sheet again adds
nothing twice.

The page shows how many pickups remain of the total, and how many are done. **Export CSV** saves the pickups still
open as `pickups.csv`, in the same columns, to send back to the proofer.

## Working through the pickups

**Next pickup** moves REAPER's edit cursor to the next open pickup and shows its time, tag and note.

- **Open Chapter … in Proof** opens that chapter's [Proof view](proof.md#the-chapter-view) at the pickup's place,
  to hear it against the script. It shows when a chapter is
  [linked to its track](navigation.md#linking-chapters-to-tracks) and that track has audio at the pickup's time. When
  chapter tracks share the timeline, every chapter that matches is offered, and none is guessed. With no match,
  the page says the pickup is not on a linked chapter track.
- **Punch from here** will move REAPER's edit cursor to just before the pickup, ready to record over it. It is an
  experimental REAPER action and stays unavailable (shown greyed out) until it is supported.
- **Mark this pickup done** marks the pickup resolved in REAPER, and the count goes down.

## Pickup session

The **Pickup session** panel is not available yet. It will gather a chapter's pickups in script order, each with its
line in context, ready to record in one sitting.

## In the Booth's companion panel

The companion panel's **Pickups** section shows the same list: how many pickups remain, and the one you last jumped
to. Jumping, punching and marking one done stay on this page.

---

[← Proof](proof.md) · [Index](README.md) · [Delivery →](delivery.md)
