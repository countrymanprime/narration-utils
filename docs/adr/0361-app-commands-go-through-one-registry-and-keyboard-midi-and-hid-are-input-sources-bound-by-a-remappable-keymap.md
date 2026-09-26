# 0361. App commands go through one registry, and keyboard, MIDI and HID are input sources bound by a remappable keymap

**Status:** Accepted
**Date:** 2026-09-26
**Supersedes:**
**Amends:** [ADR 0196](0196-the-read-aloud-control-bar-lives-in-a-dialog-footer-slot-and-space-plays-or-stops-a-session.md) decision 5. The mechanism changes: Space moves from `ReadingControlBar`'s own listener to the registry. The behaviour stays the same.

## Context

[Input Commands and Pedals](../prds/input-commands-and-pedals.prd.md) comes from recommendation 2 of the [audiobook studio benchmark](../research/audiobook-studio-benchmark.md). The benchmark requires that "every command on the keyboard, and footswitches (USB, MIDI or HID) can be mapped", that the booth is keyboard-first and silent while recording, and that everything works from a screen reader. Today the app has three hand-written `keydown` listeners, each with its own rules for when a key counts:

- **Back and Forward:** `apps/ui/src/App.tsx:269-306`. It skips a key while a dialog is open.
- **Workspace keys:** `components/workspace/WorkspacePage.tsx:148-185`. It skips a key typed into a field, but ignores modifiers and `defaultPrevented`.
- **Space in the reading bar:** `components/teleprompter/ReadingControlBar.tsx:70-95` ([ADR 0196](0196-the-read-aloud-control-bar-lives-in-a-dialog-footer-slot-and-space-plays-or-stops-a-session.md)). It skips a key aimed at a widget.

These listeners have no shared list, so nothing can be remapped and nothing detects when two of them act on the same key. By reading the code, Alt+← on the workspace should both go back and step a word, although this has not been reproduced. None of the listeners can hear a MIDI or HID pedal.

## Decision

1. **One command registry in `apps/ui/src/input/`.** It does not live under `components/`: primitives stay leaves ([ADR 0062](0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md)), and features depend on `src/input`, never the reverse.
   - Commands are static descriptors in `src/input/commands.catalog.ts`. Each has an `id`, a `label`, a `scope` (`global | page | booth | dialog`), an optional `noisy` flag and default gestures.
   - A feature attaches behaviour with `useCommand(id, handler, enabled)`. A test fails when an id is missing from the catalog, or when a catalog row is never registered.
2. **Features never listen to `keydown` for a command.**
   - A scan test fails on `addEventListener('keydown'` outside `src/input/`.
   - It has a reasoned allowlist of listeners that are not commands: `components/primitives/inputModality.ts` (modality), `components/primitives/Tooltip.tsx` and `components/manuscript/SelectionMenu.tsx` (Escape closes), and `components/teleprompter/useFollowCursor.ts` (scroll-intent detection, [ADR 0119](0119-a-hand-scroll-pauses-following-until-the-current-word-is-back-in-the-band.md)).
   - Widget keys owned by the primitives (Escape, the Tab trap, arrows in a list) are not commands.
3. **Devices are `InputSource`s.** Each has one method, `subscribe(onGesture) => unsubscribe`, and emits a normalised `Gesture` `{source: 'keyboard' | 'midi' | 'hid', code, modifiers}`. The router depends only on this interface.
   - `KeyboardSource` is built first. It covers USB footswitches that present as keyboards.
   - `MidiSource` (Web MIDI) and `HidSource` (WebHID) follow, but only after a spike confirms each webview exposes the API.
4. **A keymap binds gestures to command ids.** The router resolves the active scopes (topmost dialog, then booth, then page, then global), looks up the keymap, checks `enabled()`, and applies the target guard to a gesture that has no modifier. The guard uses `EDITABLE`, `SPACE_ACTIVATES` and `KEY_WIDGET_ROLES`, moved to `src/input/targets.ts` and re-exported from `useFollowCursor.ts`. The router then acts on the result:
   - **A gesture a command takes:** it calls `preventDefault` and the handler. `isScrollKey` already skips a prevented event, so ADR 0119 and ADR 0196 keep working unchanged.
   - **A gesture no command takes:** it leaves the event alone.
5. **Defaults live in code; the narrator's overrides live in the host settings store.** The overrides are one global row, whose shape is PRD Q2, added append-only to `config/defaults.json`, `apps/desktop/internal/settings/store.go` and `apps/desktop/app.go` `fieldSchemas`. The UI parses the row through `parseWireJson` and a Zod schema ([ADR 0069](0069-payloads-are-validated-with-zod-behind-parsewire-and-a-wrong-shape-fails-loudly.md)). A malformed document falls back to the defaults.
6. **Conflicts are a pure function.**
   - `findConflicts(catalog, keymap)` reports two commands on one gesture in scopes that can be active together.
   - The default keymap must have none, which a unit test checks, backed by fast-check properties.
   - A remap that would conflict names the other command and asks the narrator before replacing it.
7. **While the DAW reports recording, `noisy` commands do not run.** This depends on the recording state from the DAW port PRD.

## Consequences

- Every shortcut is listed, remappable and announced (`aria-keyshortcuts`), which meets WCAG 2.1.4 for the single-key defaults. A new feature adds a catalog row and a `useCommand` call instead of a listener. The rules for dialogs, fields and recording are applied in one place.
- A pedal that sends a key works anywhere the app runs. MIDI and HID depend on the webview: WebView2 is Chromium, while macOS and Linux webviews are not known to ship Web MIDI or WebHID. Those sources may therefore be Windows-only, or may need a host-side reader later.
- Keyboard bindings match modifiers exactly, so a shortcut held with an extra modifier no longer fires. Mouse buttons 3 and 4 stay a pointer listener in `App.tsx`.
- OS-level hotkeys while REAPER has focus are not covered. They need a host change, which would read the same keymap row.
- To change the registry's shape, allow command listeners elsewhere, or move the keymap out of the host settings, write a new ADR that supersedes this one.
