[Using the app](README.md) › Navigation

# Navigation

The sidebar on the left is grouped by production stage, the way a narrator's week runs: **Production** ([Production](production.md)),
**Prep** ([Script](script.md), [Story Bible](story-bible.md)), **Record** ([Booth](booth.md)),
**Review** ([Proof](proof.md), [Pickups](pickups.md), [Tracks](tracks.md)) and **Finish** ([Delivery](delivery.md)).
At desktop widths each group shows as a heading over its pages; narrower windows switch it to icon-only groups
divided by a thin line, then hide it behind a hamburger menu that opens it as a slide-in drawer with the headings
back. [Settings](settings.md) lives at the bottom of the sidebar, in every layout, below every group.

![Primary navigation sidebar at desktop width](../../images/ui/nav-sidebar-desktop.webp)

In the icon-only layout, hover an icon (or tab to it) to see the page's name.

![Icon-only navigation rail with a page name shown on hover](../../images/ui/nav-rail-tooltip.webp)

Script, Story Bible, and Booth stay locked until a manuscript has been
[imported on Production](production.md#importing-the-manuscript). Hovering a locked entry says what is missing. Production, Tracks, Proof, Pickups, and Delivery
are always available.

The header runs, left to right: Back and Forward (below), the project's name, and at the right the timer and
engine chips. While a [production stage timer](production.md#the-stage-timer) runs, the timer chip counts its
time and names the chapter ("0:42:07 · timer on Chapter 6") on every page; below the tablet width it keeps the
clock only. With no timer running it is not there.

The engine chip at the right of the header shows the linked audio engine, and clicking it opens a file picker to link
(or change) the project's `.rpp` file:

- **REAPER linked**: a `.rpp` file is linked to this project.
- **No REAPER project linked**: nothing is linked yet.
- **Wrong REAPER project open**: REAPER is running with a different project open than the linked one. Link
  the open project instead, or switch REAPER to the linked file.
- **Built-in recorder**: the project records through the app's own recorder instead of REAPER. Nothing chooses
  this yet; it appears once a future update adds a built-in recorder.

The file must be saved inside the project folder; one from another folder is refused with a message saying
so. The same link can be made from the [Tracks](tracks.md) page and from [Settings](settings.md#daw-integration).

## Moving around: Back and Forward

Two buttons at the left of the header walk the pages you have visited in this project, the way a browser's Back
and Forward do: **Back** (`Alt+Left`, or your mouse's back button) returns to the page you came from; **Forward**
(`Alt+Right`, or your mouse's forward button) goes there again after a Back. Each is disabled — with a tooltip
saying why — when there is nowhere to go: Back on the first page you opened in this project, Forward until you
have gone Back at least once. Switching to a different project starts a fresh history; Back does not cross into
the project you left.

Back and Forward respect the same checks the nav does: leaving unsaved changes in [Settings](settings.md) asks
first, and leaving a chapter's [Proof view](proof.md#the-chapter-view) while a comparison is under way or
showing results resets it the same way. They only move between pages — closing a slide-over, the previous
chapter, or the previous Story Bible entry are not Back steps.

---

[← Getting started](getting-started.md) · [Index](README.md) · [Production →](production.md)
