[Using the app](README.md) › Settings

# Settings

Settings are split into Global (defaults for every project) and This Project (overrides for
the current one), organized by category.

![Settings, Global scope, General category](../../images/ui/settings-general.webp)

Appearance controls the light/dark theme.

![Settings, Global scope, Appearance category](../../images/ui/settings-appearance.webp)

![Home with Dark theme selected](../../images/ui/theme-dark.webp)

Other categories mix dropdowns and color pickers — Manuscript's own category, for example,
controls the color used to mark reader notes in the text.

![Settings - Global scope, Manuscript category (note color picker)](../../images/ui/settings-manuscript.webp)

This Project's "Project data" category is a project-only danger zone: it clears the imported
manuscript, Story Bible, proofing artifacts, and reader notes for the current project, while
leaving its settings in place.

![Settings - Project scope, Project data category (clear derived project data)](../../images/ui/settings-project-data.webp)

## About and updates

The last category of the Global scope, **About & updates**, shows which version of Narration Utils you are running and looks
after updates.

![Settings - Global scope, About and updates category with a newer version found](../../images/ui/settings-about-updates.webp)

- **Check for updates on startup** (on by default): once a day, when the app starts, it asks GitHub which releases exist. That
  request sends nothing about you, your projects or your computer, and it never downloads anything by itself. Switch it off
  if you would rather look yourself with **Check now**.
- **Update channel**: *Candidates and stable* (the default; every release so far is a release candidate) or *Stable only*.
- **Download update** asks first, then downloads the new version with a progress bar and checks it against the release's
  checksum. You can cancel while it downloads.
- **Install and restart** asks again, then closes Narration Utils and starts it again on the new version with the same
  project. It will not install while an import, a Story Bible build, a download, a comparison or a teleprompter session is
  running: finish or stop it and try again. If the new version does not start, the previous one comes back by itself.
- If Narration Utils is installed somewhere it is not allowed to change (for example under Program Files) it says so and
  offers **Show the downloaded file**, so you can replace the program yourself.
- **Release notes** opens the release page in your browser.

Updates apply to Windows. On macOS and Linux (preview builds) the app tells you a newer version exists and links to it.
Releases are not yet signed, so Windows SmartScreen or your antivirus may ask about a new version the first time.

If Narration Utils will not start after an update and the program file is missing from its folder, rename
`narration-utils.exe.old` back to `narration-utils.exe`.

---

[← Tracks](tracks.md) · [Index](README.md)
