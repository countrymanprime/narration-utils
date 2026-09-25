[Using the app](README.md) › Navigation

# Navigation

[Home](home.md), [Manuscript](manuscript.md), [Proofing](proofing.md), [Story Bible](story-bible.md),
[Teleprompter](teleprompter.md), [Tracks](tracks.md), [Review](review.md), and [Delivery](delivery.md) are
reachable from a sidebar on the left. At
desktop widths it stays open with labels; narrower windows switch it to icon-only, then hide
it behind a hamburger menu that opens it as a slide-in drawer. [Settings](settings.md) lives at the
bottom of the sidebar in every layout.

![Primary navigation sidebar at desktop width](../../images/ui/nav-sidebar-desktop.webp)

In the icon-only layout, hover an icon (or tab to it) to see the page's name.

![Icon-only navigation rail with a page name shown on hover](../../images/ui/nav-rail-tooltip.webp)

Manuscript, Proofing, Story Bible, and Teleprompter stay locked until a manuscript has been
[imported on Home](home.md), and Proofing also stays locked until a REAPER project (`.rpp`) is linked to the
project. Hovering a locked entry says what is missing. Home, Tracks, Review, and Delivery are always available.

The pill at the right of the header shows the REAPER link, and clicking it opens a file picker to link (or
change) the project's `.rpp` file:

- **REAPER project linked**: a `.rpp` file is linked to this project.
- **No REAPER project linked**: nothing is linked yet.
- **Wrong REAPER project open**: REAPER is running with a different project open than the linked one. Link
  the open project instead, or switch REAPER to the linked file.

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
first, and leaving [Proofing](proofing.md) resets its run the same way. They only move between pages — closing a
slide-over, the previous chapter, or the previous Story Bible entry are not Back steps.

---

[← Getting started](getting-started.md) · [Index](README.md) · [Home →](home.md)
