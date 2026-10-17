# Settings for a multi-page desktop app with shared resources: best practice

Researched 2026-10-17 for the Settings redesign, tracking issue [#1817](https://github.com/countrymanprime/narration-utils/issues/1817). The sources are as they read on that date and are not kept current.

**Question.** What do the best settings experiences of multi-page desktop apps look like when several pages share one resource, such as one transcription model or one voice? What rules should Narration Studio adopt, and what should it avoid?

**Method.** Web search over the references the owner named plus the audio tools this app sits beside. **Limit of this note:** the research session could not open any page (`WebFetch` failed on DNS for every host). Every claim marked *(snippet)* rests on the search-result excerpt for that URL, not on the page read in full. A claim marked *(recommendation)* is this note's inference for this app, with no source. Things searched for and not found are listed at the end. The note changes no code; the decisions that follow from it are in [ADR 0865](../adr/0865-settings-are-grouped-by-what-is-configured-with-a-scope-and-a-used-by-list-on-every-setting-and-a-model-list-that-owns-the-downloads.md) and the [grouping proposal](settings-inventory-and-grouping.md).

## What the references do

| Reference | Observed | Source |
| --- | --- | --- |
| VS Code | Separate User (global) and Workspace settings; a modified setting gets a blue bar; `@modified` filters to changed ones. | [settings docs](https://code.visualstudio.com/docs/configure/settings) *(snippet)* |
| JetBrains IDEs | A search field and a category tree; project-level options carry a "For current project" icon, options without it are global; Apply, OK and Cancel. | [settings dialog](https://jetbrains.com/help/idea/settings-preferences-dialog.html), [default settings](https://www.jetbrains.com/help/idea/accessing-default-settings.html) *(snippet)* |
| DaVinci Resolve | Workstation Preferences (System and User panes) apart from per-project Project Settings. Preferences supply defaults a project can override, such as the cache location. Some System changes ask for a restart. | [Resolve 18.6 manual mirror](https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part120.htm), [Dell guide](https://infohub.delltechnologies.com/en-au/l/dell-technologies-powerscale-onefs-best-practices-for-davinci-resolve/resolve-preferences) *(snippet)* |
| REAPER | Preferences opens with Ctrl+P; a tree with General, Keyboard, Project, Audio (Device, MIDI Devices), Appearance, Media and Plug-ins. | [CockosWiki Preferences](https://www.cockos.com/wiki/index.php/Preferences) *(snippet)* |
| Ableton Live | Preferences are tabs: Look/Feel, Link/Tempo/MIDI, File/Folder, Library, Plug-ins, Record/Warp/Launch, Licenses & Updates. Machine-level items (locations, plug-ins, licences) sit apart from defaults for new Live Sets. | [Live 12 manual](https://www.ableton.com/en/live-manual/12/first-steps/) *(snippet)* |
| Obsidian | Settings in three groups: Options (General, Editor, Files and links, Appearance, Hotkeys), Core plugins, Community plugins. | [Obsidian help](https://obsidian.md/help/settings) *(snippet)* |
| Windows app guidance | Changes take effect immediately with no confirm button; a toggle for a binary setting; radio buttons for up to five related options; few settings with smart defaults. `ms-settings:` URIs deep-link into Windows Settings, and the guidance suggests linking to `ms-settings:privacy-microphone` when access is missing. | [guidelines for app settings](https://learn.microsoft.com/en-us/WINDOWS/APPS/design/app-settings/guidelines-for-app-settings), [launch Windows Settings](https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings) *(snippet)* |
| Windows Community Toolkit | `SettingsCard` and `SettingsExpander`: a header, a description, an icon and an action on the right; the expander groups related cards. | [SettingsExpander](https://learn.microsoft.com/de-de/dotnet/communitytoolkit/windows/settingscontrols/settingsexpander) *(snippet)* |
| Model managers (Ollama, LM Studio) | A list of local models with sizes; remove by name; shared files mean removing one variant may free little space; Ollama refuses to delete a model a request is using. Third-party guides only. | [Ollama guide](https://insiderllm.com/guides/managing-multiple-models-ollama/), [LM Studio cleanup](https://mole.fit/blog/how-to-remove-ai-tool-leftovers-mac) *(snippet)* |
| OS voices | Windows installs voices with language packs in the background and then lists them in the voice dropdown; macOS has System Voice, Manage voices, with Enhanced and Premium variants. Third-party guides only. | [Windows](https://geekrewind.com/how-to-change-the-default-speech-synthesis-voice-in-windows-11-time-and-language/), [macOS](https://www.resemble.ai/resources/text-to-speech-mac-os-x-guide) *(snippet)* |
| WCAG 2.2 | 2.5.8 targets of at least 24 by 24 CSS px; 2.4.11 a focused element is not entirely hidden (sticky headers are the usual failure); 3.3.7 no re-entering information already given; 1.4.10 no two-dimensional scrolling at 320 CSS px, data tables excepted; 4.1.3 status messages are announced without moving focus. | [new in 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow), [ARIA22](https://w3.org/WAI/WCAG22/Techniques/aria/ARIA22) *(snippet)* |
| ARIA Authoring Practices | Tabs: tablist, tab, tabpanel; arrows move between tabs; Home and End; Tab enters the panel. | [tabs pattern](https://w3.org/WAI/ARIA/apg/patterns/tabs/) *(snippet)* |

## Rules to adopt

Each rule has a stable id; the mock and the ADR cite them.

### Information architecture

- **R-IA1.** Every setting has one owner scope, this computer or this project, shown as a badge on the row and not only by where the row sits. *(VS Code and JetBrains mark scope on the setting; Resolve and Ableton split machine from project.)*
- **R-IA2.** Where a project may override a computer default, show "uses the computer setting" with an action to override, and, once overridden, the override with a way back to the computer setting. Never let a project silently differ. *(recommendation, from Resolve's preferences-as-defaults and VS Code's two scopes)*
- **R-IA3.** Group by what is being configured, not by which page reads it. A resource that several pages share has one home. *(recommendation; REAPER, Ableton and Resolve group by device, files, plug-ins and look)*
- **R-IA4.** A shared setting lists the pages that use it, each a link. A consuming page shows the value read-only with a link to the setting. *(recommendation)*
- **R-IA5.** Offer a "changed" filter and a changed marker. *(VS Code `@modified` and the blue bar)*
- **R-IA6.** Audio tools separate devices, file and asset locations, plug-in or model management, appearance, and licences or updates. Follow that split. *(REAPER, Ableton, Resolve, Obsidian)*

Avoid: one long column of unrelated panels with no scope labels; the same control on several pages with no stated owner; a resource's choice and its downloaded files in two distant places.

### Navigation and search

- **R-NAV1.** A left category list with one category visible at a time and a search box above it; about eight categories, in a few labelled groups. *(VS Code, JetBrains and REAPER use a tree; the count is a recommendation)*
- **R-NAV2.** Search matches labels, descriptions, section names and synonyms the label lacks ("whisper", "reaper", "threads"), shows the category of each result, and opens collapsed Advanced sections that match. *(recommendation, from VS Code search)*
- **R-NAV3.** Every setting is addressable, so another page can deep-link to it: the page opens on the category, scrolls to the row, moves focus there and highlights it. *(Windows `ms-settings:` URIs; recommendation for the rest)*
- **R-NAV4.** Ctrl+, opens Settings from any page, and Back returns to the page the narrator came from. *(recommendation; Ctrl+, is VS Code's binding, per search snippet; REAPER's is Ctrl+P)*
- **R-NAV5.** When a page needs a missing resource (no model, no DAW), it shows the problem where it happens with a link to the fix. *(the Windows microphone-privacy example)*
- **R-NAV6.** Order categories by the narrator's workflow, with machine-level ones last. *(recommendation)*

Avoid: horizontal tabs for more than about five categories; accordions that hide search hits; a deep link that lands at the top of a long page with no highlight.

### Editing

- **R-EDIT1.** Apply at once, with no global Save, and show a short "Saved" on the row. *(Windows app guidance; JetBrains' Apply/OK model is the counter-example)*
- **R-EDIT2.** A change that costs something (checks re-run, files move) asks first and says what will happen. *(recommendation; Resolve prompts for restarts)*
- **R-EDIT3.** Show a reset only on a changed row, plus a reset for a whole category after confirmation. *(recommendation)*
- **R-EDIT4.** Mark a changed row with text as well as colour. *(WCAG 1.4.1; recommendation)*
- **R-EDIT5.** Validate on commit, put the error beside the field with how to fix it, and keep the previous valid value in effect. *(recommendation)*
- **R-EDIT6.** Put rarely changed options behind an Advanced disclosure, closed by default. *(Windows "minimal settings, smart defaults")*
- **R-EDIT7.** Say when a change takes effect ("used the next time the app starts REAPER") on the row, not in a dialog. *(recommendation)*
- **R-EDIT8.** Refuse or warn when removing or changing a resource a job or setting is using, and offer the fallback. *(Ollama refuses to delete a model in use)*

Avoid: a mix of instant and Save panels on one page; a value that reverts without a word; error states told by colour alone.

### Resources: models, voices, DAW

- **R-RES1.** One list of everything downloadable: name, kind, size, status, and which pages use it. *(Ollama and LM Studio lists; recommendation for the used-by column)*
- **R-RES2.** Which resource a role uses is chosen in the section for that role, from the list, with a download in place when the chosen one is missing. *(recommendation)*
- **R-RES3.** A download shows progress, can be cancelled, and on failure says why and offers Try again. Progress is announced politely. *(recommendation)*
- **R-RES4.** Show disk use per item and in total, with the storage folder, Open folder and Change location. *(Resolve and Ableton give locations their own place)*
- **R-RES5.** Removal confirms, states the space freed, and handles an item in use (R-EDIT8). *(Ollama)*
- **R-RES6.** Say what a model needs (memory, speed) beside it. *(recommendation; the thresholds are not sourced)*
- **R-RES7.** The recording tool is a status card: which tool, connected or not, a Test connection, and what it can do, with unavailable capabilities listed and a reason. *(recommendation)*
- **R-RES8.** A download that fails its check is an error row, not a silently missing item. *(recommendation)*

Avoid: a download that carries on invisibly after leaving the page; "Available" and "Installed" as two unlinked lists; deleting files without updating the catalogue.

### Accessibility

- **R-A11Y1.** Landmarks: `nav` labelled "Settings categories", `main` for the pane, `search` for the box; `h1` for the page and `h2` for the category. *(recommendation, general ARIA practice; the APG landmark page was not opened)*
- **R-A11Y2.** The category list is a list of buttons with `aria-current`, not an ARIA tabs widget, because it changes what the page shows. Real tabs are for a same-page switch and follow the APG keys. *(APG tabs)*
- **R-A11Y3.** Each control has a visible label and a description linked with `aria-describedby`. *(recommendation)*
- **R-A11Y4.** Saved, error and progress messages go into live regions that exist before their text changes, and focus does not move. *(WCAG 4.1.3, ARIA22)*
- **R-A11Y5.** Targets are at least 24 by 24 CSS px, and an icon-only button's name includes what it acts on ("Remove Whisper small"). *(WCAG 2.5.8)*
- **R-A11Y6.** A sticky header must not cover the focused row. *(WCAG 2.4.11)*
- **R-A11Y7.** At 320 CSS px the category list folds into one control and tables become cards. *(WCAG 1.4.10)*
- **R-A11Y8.** After a deep link, focus is on the target row's control; after a removal it moves to a sensible neighbour. *(recommendation)*
- **R-A11Y9.** Do not ask again for what the app already has, such as a project's narrator name prefilled from the computer default. *(WCAG 3.3.7)*
- **R-A11Y10.** Meaning is never carried by colour alone, and motion respects `prefers-reduced-motion`. *(recommendation; forced-colours guidance was not found)*

Avoid: a live region created together with its text; essential explanations only in hover tooltips; a confirmation dialog with no Escape.

### Windows conventions

- **R-WIN1.** The Windows 11 shape: left navigation, a page title, rows with the label and description on the left and the control on the right, related options grouped. *(SettingsCard and SettingsExpander)*
- **R-WIN2.** Bind Ctrl+, and list it in the shortcut sheet. *(see R-NAV4)*
- **R-WIN3.** Link out to Windows Settings only for what Windows owns, such as microphone privacy and sound devices. *(`ms-settings:` guidance)*
- **R-WIN4.** Respect the system theme and text scaling; test at 125, 150 and 200 percent and at 400 percent zoom. *(recommendation)*
- **R-WIN5.** Workflow commands (start recording, run a check) do not live in Settings. *(Windows app guidance)*
- **R-WIN6.** Prefer a page inside the main window to a modal Options dialog, so deep links, Back and long lists work. *(recommendation)*

Avoid: OK/Apply/Cancel dialogs as the default model; custom controls that ignore forced-colours mode.

## Searched for and not found

- VS Code's "Also modified in" label, and Figma, Notion and Linear workspace-versus-personal models, were not confirmed.
- Apple's guidance on System Settings search, Cmd+, and instant apply: third-party summaries only.
- Windows 11 NavigationView, DPI and forced-colours pages; the APG switch, disclosure and landmark pages; WCAG 2.1.1, 2.4.3, 2.4.6, 2.4.7 and 1.4.13 text: not opened.
- LM Studio's download-progress interface and Obsidian's community-plugin manager: not confirmed.
- A claim with no source in the list above is marked *(recommendation)*; it is a design inference, not evidence.
