[Using the app](README.md) › Navigation

# Navigation

[Home](home.md), [Manuscript](manuscript.md), [Proofing](proofing.md), [Story Bible](story-bible.md),
[Teleprompter](teleprompter.md), [Tracks](tracks.md), and [Review](review.md) are reachable from a sidebar on the left. At
desktop widths it stays open with labels; narrower windows switch it to icon-only, then hide
it behind a hamburger menu that opens it as a slide-in drawer. [Settings](settings.md) lives at the
bottom of the sidebar in every layout.

![Primary navigation sidebar at desktop width](../../images/ui/nav-sidebar-desktop.webp)

In the icon-only layout, hover an icon (or tab to it) to see the page's name.

![Icon-only navigation rail with a page name shown on hover](../../images/ui/nav-rail-tooltip.webp)

Manuscript, Proofing, Story Bible, and Teleprompter stay locked until a manuscript has been
[imported on Home](home.md), and Proofing also stays locked until a REAPER project (`.rpp`) is linked to the
project. Hovering a locked entry says what is missing. Home, Tracks, and Review are always available.

The pill at the right of the header shows the REAPER link, and clicking it opens a file picker to link (or
change) the project's `.rpp` file:

- **REAPER project linked**: a `.rpp` file is linked to this project.
- **No REAPER project linked**: nothing is linked yet.
- **Wrong REAPER project open**: REAPER is running with a different project open than the linked one. Link
  the open project instead, or switch REAPER to the linked file.

The file must be saved inside the project folder; one from another folder is refused with a message saying
so. The same link can be made from the [Tracks](tracks.md) page and from [Settings](settings.md#daw-integration).

---

[← Getting started](getting-started.md) · [Index](README.md) · [Home →](home.md)
