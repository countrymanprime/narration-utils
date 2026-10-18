# Studio shell and registries

**Status: implemented.** The app shell draws the rail and header, and a page adds a command, a search source, a context menu or an overlay by calling one registry or service, never by editing the shell. The decisions are Command providers and "Go to" (catalogue, providers, jump menu, context menus, help), (overlay service) and [Layout rules](../design/design-system.md#layout-rules) (widths, icons, key caps). Studio shell and registries set the command model they extend and [Verification and code-health tooling](../operations/verification-tooling.md) the rule that an import boundary is a lint or test rule that names its ADR.

All paths are under `apps/ui/src/`.

## Map

| Piece | Folder or file | What it holds |
| --- | --- | --- |
| Command catalogue | `input/commands.catalog.ts` | Every command that has a key, as static data |
| Surfaces | `input/surfaces.ts` | `commandsFor(surface)`: the catalogue rows one surface lists |
| Command providers | `input/commandProviders.ts` | Commands that depend on live data and carry no key |
| Router, keymap, scopes | `input/router.tsx`, `input/keymap.ts`, `input/scopes.ts` | Which handler a gesture runs |
| Help hints | `input/hints.ts` | Key-cap labels and the footer specs |
| Search sources | `registries/search.ts` | Functions the jump menu asks for hits |
| Context providers | `registries/context.ts` | Functions that answer "what menu for this element" |
| Overlay service | `overlay/` | Imperative dialogs, confirms, toasts, announcements |
| Shell | `components/layout/AppShell.tsx` | Rail, header, `<main>` |
| Jump menu, context menu host, history panel | `components/layout/JumpMenu.tsx`, `ContextMenuHost.tsx`, `HistoryPanel.tsx` | The views built on the pieces above |
| Layout widths | `layoutBreakpoints.ts`, `hooks/useLayoutClass.ts` | The width vocabulary |
| Icons and key caps | `icons.catalog.ts`, `components/primitives/KeyCap.tsx` | The icon and key-cap vocabularies |

## Command catalogue

`COMMAND_CATALOG` in `input/commands.catalog.ts` is the one list of commands that have a key. A row is a `CommandDescriptor`: `id`, `label`, `scope`, `defaults` (gestures), and optionally `noisy`, `group`, `hint`, `surfaces`, `shadows` and `fieldsKeep`.

- **Scope** is `global`, `page`, `booth` or `dialog`. The catalogue has 67 rows: 13 global, 40 page, 14 booth, none dialog.
- **Surface** is `jumpMenu`, `help` or `settings`. All 67 rows list on `help` and `settings`; 9 list on `jumpMenu`: `nav.back`, `nav.forward`, `zoom.in`, `zoom.out`, `zoom.reset`, `companion.open`, `help.shortcuts`, `history.open`, `undo.last`. A page key is not a jump menu row because the menu could not run it from another page.
- **Groups** (the jump menu heading and the help and Settings grouping): Go to, Zoom, Editing, Bookmarks, Script, Story Bible, Proof, Booth, View, Edit.
- **Id format** is `area.thing` or `area.thing.direction` (`editing.word.extend.prev`, `proof.decide.waive`). An id is the key the narrator's saved bindings use, so a renamed id loses the binding.
- **Shell rows** `jump.open` (Ctrl/Cmd+K and Ctrl/Cmd+F), `history.open` (Ctrl+Shift+H) and `undo.last` (Ctrl+Z, `fieldsKeep`) are global. `script.find` and `proof.find` take Ctrl+F on their page and name `jump.open` in `shadows`, so Ctrl+F opens the jump menu on every other page.
- **Behaviour** is attached with `useCommand(id, handler, enabled)` (`input/useCommand.ts`). A feature never listens for a key.

| Rule | Enforced by |
| --- | --- |
| No duplicate id, every row has a label and a default, F13 to F24 stay unbound, every row has `group` and `surfaces` | `input/commands.catalog.test.ts` |
| The default keymap has no conflict between rows whose scopes overlap, except a `shadows` pair | `input/commands.catalog.test.ts`, `input/findConflicts.ts` (tested in `input/findConflicts.test.ts`) |
| A row added with `surfaces` shows on every surface it names with no other edit | `input/surfaces.test.ts` |
| No feature adds a `keydown` listener for a command; each exception names a reason | `listenerGuard.test.ts` |

### Router

`CommandRouter` (`input/router.tsx`) subscribes to an `InputSource` (`input/KeyboardSource.ts`, `MidiSource.ts`, `HidSource.ts`). For a gesture it:

1. Takes the active scopes from the mounted `CommandScope` boundaries (`activeScopes`). A dialog hides `global`; a dialog, the Booth or a page claims the surface and the others do not.
2. Leaves a plain key to a focused field or widget (`input/targets.ts`).
3. Walks `SCOPE_PRIORITY` (`input/scopes.ts`: dialog, booth, page, global) and runs the first row bound to the gesture that has a handler registered.
4. For a `noisy` row while the DAW records, consumes the gesture, skips the handler and posts "Not while recording." to a polite live region.

The keymap (`input/keymap.ts`) is the catalogue defaults with the narrator's overrides on top. `Mod` resolves to Cmd on macOS and Ctrl elsewhere. Tests: `input/router.test.tsx`, `input/keymap.test.ts`, `input/scopes.test.ts`.

## Command providers and "Go to"

A command that exists only while data does ("Go to chapter 3") is a provided command: `{ id, group, label, hint?, run }` with no `defaults`. `registerCommandProvider` or `useCommandProvider` (`input/commandProviders.ts`) adds a function that is called each time the jump menu opens. `providedCommands` throws for a result that carries `defaults` or reuses a catalogue id. Provided commands appear in the jump menu only, not in `help`, `settings` or the keymap.

`components/layout/useGoToCommands.ts` registers the "Go to <page>" commands (group "Go to") and "Go to <chapter>" commands (group "Chapters"). `App.tsx` passes the pages from `shellPages({ hasManuscript, dawFileLinked })` in `AppShell.tsx` and the chapters from the `chapters` slot of the store (`studio/slots.ts`).

Tests: `input/commandProviders.test.ts`, `components/layout/useGoToCommands.test.tsx`.

## Jump menu

`openJumpMenu` (`components/layout/JumpMenu.tsx`) opens the menu through the overlay service as a headerless dialog that closes on a press outside. The header button "Jump to or run…" and `jump.open` call it.

| Input | List |
| --- | --- |
| Nothing typed | One row per group with its count; choosing a group lists its commands, and "All commands" or Backspace on an empty field goes back |
| A term | Search hits first, then catalogue and provided commands whose label or hint contains every word of the term |
| A term starting with `>` | Commands only, no search hits |

The text field keeps focus and names the active option with `aria-activedescendant`; the list is a `Listbox` primitive. A catalogue row draws the first gesture of the narrator's keymap as key caps. The menu reads memory only, so it opens and filters without waiting for the host ([The standard](interaction-feedback.md#the-standard)). A catalogue row runs through `shellCommands` in `App.tsx`, the same action as its key or header button.

Test: `components/layout/JumpMenu.test.tsx`.

## Search sources

A `SearchSource` is `(term) => SearchHit[]` with `SearchHit = { group, title, sub?, run }`. `registries/search.ts` keeps them: `registerSearchSource` and `useSearchSource` add one, `searchAll(term)` asks every source in registration order. A term under two characters asks nobody, and a source that throws is skipped with a console warning so the others still answer.

| Source | Registered in |
| --- | --- |
| Manuscript text, Story Bible entries, marks, prep words | `components/script/page/registry/useScriptRegistry.ts` |
| Bookmarks | `components/script/bookmarks/model/useBookmarkCommands.ts` |

Test: `registries/search.test.ts`.

## Context menus

A `ContextProvider` is `{ match(target), items(target), tail? }` (`registries/context.ts`). `registerContextProvider` and `useContextProvider` add one. `contextItemsFor(target)` runs `items` of the first provider whose `match` is true. `tail: false` keeps the shell's tail off a picker such as the Add FX list.

`ContextMenuHost` (`components/layout/ContextMenuHost.tsx`) wraps the content of `<main>` in the `ContextMenu` primitive. On open it takes:

1. The first matching provider's items, then the shell's `tail`.
2. With no provider, the shell's `fallback` (empty space in `<main>`: Go to, zoom, theme), then the tail.
3. With neither, or inside a text field, the browser's own menu.

The Menu key and Shift+F10 arrive as a `contextmenu` event on the focused element (or its `aria-activedescendant`); the host re-sends it from that element's box. It binds no key and adds no listener on `document`. `App.tsx` supplies `fallback` and `tail` ("Jump menu…", "Find a page, chapter or command") to `AppShell`. Providers today: Editing words and FX (`components/editing/menu/useEditingWordMenu.ts`, `components/editing/range/fx/useFxWords.tsx`), Booth (`components/booth/page/useBoothPage.ts`), Proof notes (`components/proof/useNoteContextMenu.ts`), Master & QC files (`components/masterqc/files/FilesTable.tsx`), Production chapters (`components/production/useChapterTools.tsx`), Script (`components/script/page/registry/useScriptRegistry.ts`, `components/script/bookmarks/ui/bookmarkContextMenu.ts`), Story Bible (`components/storybible/Guide.tsx`) and Pickups (`components/pickups/list/usePickupsContextMenu.ts`).

| Rule | Enforced by |
| --- | --- |
| No page renders its own `<ContextMenu items>` and nothing listens for `contextmenu` privately; both ceilings are empty | `contextMenuSites.test.ts` |
| Provider order, lazy `items`, unregister | `registries/context.test.ts` |
| Provider items then tail, fallback, keyboard open, Escape returns focus, no `document` or `window` listener | `components/layout/ContextMenuHost.test.tsx` |

## Help as data

Help is derived, not written twice.

| Surface | File | Reads |
| --- | --- | --- |
| Shortcut sheet (`?`, Shift+Slash) | `components/help/ShortcutSheet.tsx` | `commandsFor('help')`, the narrator's keymap, grouped by scope |
| Settings key list | `components/settings/page/KeysPanel.tsx`, `components/settings/KeyboardPanel.tsx` | `commandsFor('settings')` |
| Booth and Proof footers | `input/hints.ts` | `FOOTER_SPECS`: per footer, the command ids to show, their order, a short label and an optional condition |

`footerHints(surface, keymap)` builds the footer from the narrator's first gesture per command, so a remapped key shows its new cap and a command with no gesture is left out. `nonKeyHints` adds hints that are not a bindable gesture (the Booth "Right-click") next to the command they follow. `codeLabel` and `gestureKeys` turn a physical key code into the cap text (`Slash` to `/`).

Tests: `components/help/ShortcutSheet.test.tsx` (the sheet lists exactly `commandsFor('help')` and shows remapped keys), `input/hints.test.ts` (every id in a footer spec is a catalogue row).

## Overlay service

`overlay/overlayService.ts` holds specs and callbacks as state and draws nothing. `overlay` is the app's one instance; `createOverlayService()` makes a private one for a test or story.

| Call | Result |
| --- | --- |
| `overlay.confirm(spec)` | Promise of the narrator's answer, drawn as `ConfirmDialog` |
| `overlay.open({ kind: 'dialog' \| 'slideOver', ... })` | Function that closes it, drawn as `Dialog` or `SlideOver`; a dialog sets `dismissOnOutsidePress` |
| `overlay.toast(text, { tone?, action?, topic? })` | A toast; a newer toast on the same `topic`, or with the same text and tone, replaces the older one; at most 4 show, information toasts drop first |
| `overlay.toastUndo(text, undo)` | A toast whose Undo calls `undo()` and toasts the journal's refusal sentence if it refuses |
| `overlay.announce(text)` | Writes the one polite live region |
| `overlay.dismissToast(id)`, `overlay.dismissTopic(topic)` | Remove a toast, or a message that stopped being true |

`overlay/OverlayHost.tsx` renders the snapshot in the primitives (`ConfirmDialog`, `Dialog`, `SlideOver`, `ToastRegion`) and the `aria-live` region outside any dialog. `overlay/OverlayProvider.tsx` mounts the host and gives components `useOverlay()`; `App.tsx` mounts it once. Focus return, stacking and Escape order stay in the primitives ([Base UI wrappers](../design/design-system.md#base-ui-wrappers), [Design system reference](../design/design-system.md)). The jump menu, the history panel and the Booth leave guard's confirm all open through it.

| Rule | Enforced by |
| --- | --- |
| `overlay/` imports `components/primitives/`, React and itself only | `.dependency-cruiser.mjs` rule `overlay-imports-primitives-only` (proved by `architectureRules.test.ts`); `overlay/importsPrimitivesOnly.test.ts` |
| `overlay/`, `studio/` and `ports/` never import `api/wailsClient` | `.dependency-cruiser.mjs` ([The store: host reads, cached](ui-state-and-journal.md#the-store-host-reads-cached)) |
| State, each kind opens, primitives' focus and Escape behaviour unchanged | `overlay/overlay.test.tsx` |

## Registry import direction

`registries/` takes `components/primitives/` types, `input/` and itself, and no feature folder; features import registries. `.dependency-cruiser.mjs` rule `registries-import-no-feature` enforces it, and `architectureRules.test.ts` proves the rule fires ([Verification and code-health tooling](../operations/verification-tooling.md)). `JumpMenu` and `ContextMenuHost` are built from the `Dialog`, `Listbox` and `ContextMenu` primitives, so Base UI is imported only inside the primitives ([Base UI wrappers](../design/design-system.md#base-ui-wrappers), `baseUiBoundary.test.ts`).

## History panel and leave guard

`openHistoryPanel(overlay, journal, dawName)` (`components/layout/HistoryPanel.tsx`) opens a slide-over "Undo history" listing the journal's entries newest first. Each row has its label, a pill naming the DAW or "App", and Undo; a row the journal would refuse shows the journal's sentence and a disabled Undo. A successful undo is announced; a refusal is a toast. It opens from the header's History button, `history.open` and the jump menu. `useJournalEntries.ts` reads the journal.

The journal is `studio/journal/createJournal.ts` ([The journal and undo](ui-state-and-journal.md#the-journal-and-undo)); it also holds the leave guard (`studio/journal/leaveGuard.ts`): a page calls `setLeaveGuard` and the shell asks `checkLeave(next)` before it navigates. The verdict is `'allow'` or `{ ask: ConfirmSpec }`, and the Booth sets one while a take records (`components/booth/leave/useBoothLeaveGuard.ts`).

Tests: `components/layout/HistoryPanel.test.tsx`, `studio/journal/createJournal.test.ts`, `studio/journal/leaveGuard.test.ts`.

## Rail and layout bands

`AppShell` (`components/layout/AppShell.tsx`) draws the rail, the header and `<main>`. The same `navigation` markup fills the wide rail and the `NavDrawer` primitive used below `md`.

| Group | Items |
| --- | --- |
| Production | Production (`/`), Schedule (`/schedule`) |
| Prep | Script, Story Bible |
| Record | Booth |
| Edit | Editing |
| Review | Proof, Pickups |
| Finish | Master & QC, Delivery |

Settings is pinned at the foot with the theme toggle, not in a group. Groups follow production stages ([Design principles](principles.md)); [Navigation](../guides/using-the-app/navigation.md) and [Editing](../guides/using-the-app/editing.md) added Schedule, Delivery and Editing.

- **Availability.** `navigation/navAvailability.ts` is the one table of what each rail page needs. The rail and the drawer (`AppShell.tsx`) and the jump menu (`shellPages`, then `useGoToCommands`) read it through `navAvailability(path, { hasManuscript, dawFileLinked })`. With no manuscript Schedule, Script, Story Bible, Booth, Editing, Proof, Pickups, Master & QC and Delivery are off: `NavButton` draws them `aria-disabled` (still focusable, named, with the reason as its description, hint and a note a press opens), and the jump menu lists them off with the reason. A routed page keeps its own "import a manuscript" state for an address reached any other way. Tests: `navigation/navAvailability.test.ts`, `components/layout/AppShell.test.tsx`, `components/primitives/NavButton.test.tsx`.
- **Counts.** `useNavCounts(pathname, hasManuscript)` (`components/layout/useNavCounts.ts`) gives `{ proof?, pickups? }`: open notes from `findingsSummary` through `proofProgress`, and open lines from `pickupsList`. It reads again on every page move and on pickup changes. A key is absent when the host gives no count, and with no manuscript there is none; the rail draws no badge, never an invented number. No other item has a count. Test: `components/layout/useNavCounts.test.tsx`.
- **Booth.** With a manuscript, `/booth` draws no rail, header or drawer, only the page in its own `<main>`. Test: `components/layout/AppShell.test.tsx`.
- **Rail width.** 216 px from 1360 CSS px; below it 64 px of icons that open over the page to 236 px on hover or keyboard focus, labels kept in the markup. Below `md` the drawer replaces the rail.
- **Header.** Back and Forward, project name, "Jump to or run…" with its key chord, Undo and History, a timer chip while a timer runs, the zoom group, the engine chip.

## Width, icon and key-cap vocabulary

| Vocabulary | Where | Rule | Enforced by |
| --- | --- | --- | --- |
| Widths: rail collapses below 1360, strip fits from 1360, medium at 1280 and below, narrow below 1180, tiny below 860 | `layoutBreakpoints.ts` (`layoutClassFor`, `LAYOUT_QUERIES`), `hooks/useLayoutClass.ts` | Layout reads the reported CSS width, so host zoom ([Zoom](../guides/using-the-app/navigation.md#zoom)) moves a window across a threshold | `layoutBreakpoints.test.ts` (the numbers); `layoutQueries.test.ts` (a Tailwind `min-[Npx]` or `max-[Npx]` between 860 and 1440 is one of 8 variants or a listed gap in `OFF_VOCABULARY`, whose counts only fall) |
| Icons: an action name maps to one icon and one tooltip (117 rows) | `icons.catalog.ts` (`iconFor`, `tooltipFor`), `components/primitives/Icon.tsx`, `IconButton.tsx` | The key is the action, not the glyph; a tooltip starts with a verb from `TOOLTIP_VERBS`; two meanings never share an icon; a page icon is worn only by a page or page-link row | `icons.catalog.test.ts`; `iconImports.test.ts` ceilings on direct `FontAwesomeIcon` and icon imports outside the primitives, which only fall |
| Native controls: a page builds a control from a primitive | `components/primitives/` | Raw `<button>`, `<input>` and table elements outside the primitives are counted per file; a file's ceiling only falls | `rawNatives.test.ts` |
| Key caps: arrows, Enter, Esc, Tab, Backspace, Space and Right-click are pictures; every other key is text | `components/primitives/KeyCap.tsx` (`KeyCap`, `KeyChord`, `KEY_GLYPHS`), `Kbd.tsx`, `KeyHint.tsx`, `KeyHints.tsx` | A glyph cap carries its name as accessible name and tooltip; `Kbd` stays text ([Design system reference](../design/design-system.md)) | `components/primitives/KeyCap.test.tsx` |

The ratchet reasons that `rawNatives.test.ts` and `iconImports.test.ts` accept are in `ratchetReasons.ts`.
