# Input Commands and Pedals: One Command Registry, a Remappable Keymap, and Keyboard, MIDI and HID Sources

**Source:** [Audiobook studio benchmark](../research/audiobook-studio-benchmark.md) recommendation 2 and the Booth UX section, and the benchmark train plan (docs/operations/agent-train.md). The architecture decision is Proposed [ADR 0361](../adr/0361-app-commands-go-through-one-registry-and-keyboard-midi-and-hid-are-input-sources-bound-by-a-remappable-keymap.md). It keeps the Space behaviour of [ADR 0196](../adr/0196-the-read-aloud-control-bar-lives-in-a-dialog-footer-slot-and-space-plays-or-stops-a-session.md) and the scroll-intent rule of [ADR 0119](../adr/0119-a-hand-scroll-pauses-following-until-the-current-word-is-back-in-the-band.md), which stay as they are. It does not cover the booth mode layout, which gets its own PRD. That PRD consumes the `booth` scope defined here.

Citations are `file:line` on `claude/beautiful-rubin-vcqpkx` at 91bbf98. "TBD - needs <what>" marks an unknown.

## Problem Statement

A narrator in the booth has their hands on the script and their mouth at the microphone, and some cannot see the screen. They need every action on a key or a footswitch. The app has three hard-coded keyboard listeners and nothing else. No list shows which keys do what. Nothing can be remapped. A USB pedal works only if it happens to send a key the app already listens for, and MIDI or HID pedals do not work at all. Each feature listens to `keydown` on its own. Each also repeats its own rules for "not while typing" and "not while a dialog is open", and the rules already differ. Every new shortcut adds one more listener and one more chance that two listeners act on the same key.

## Evidence

- **The benchmark rates this Missing.** Its capability table says: "Alt+←/→ and Space are the only shortcuts. There is no shortcut map and no pedal or MIDI input" (`docs/research/audiobook-studio-benchmark.md:191`). It lists "Every command on the keyboard, and footswitches (USB, MIDI or HID) can be mapped" as a must-have (`:75`). The Booth UX section adds three requirements: "Keyboard-first. Pedals can be remapped. Nothing makes a sound or shows a notification while recording", and "Everything works from a screen reader. REAPER with OSARA is how blind producers work today" (`:116-119`). Recommendation 2 asks for "a remappable shortcut map with pedal input (USB HID and MIDI) and a no-sound, no-notification rule while recording" (`:345-346`).
- **Three command listeners, each with its own rules** (verified in code):
  - `App.tsx:269-306` handles Back and Forward: Alt+←/→, `BrowserBack`/`BrowserForward`, Cmd+[ / Cmd+] and mouse buttons 3 and 4. It skips a key when a `[role=dialog]` or `[role=alertdialog]` is open or when the event is `defaultPrevented`.
  - `components/workspace/WorkspacePage.tsx:148-185` handles Space (play or pause), ←/→ (word), ↑/↓ (paragraph) and `[` / `]` (flags) on `window`. It skips only `INPUT`/`TEXTAREA`/`SELECT` targets. It ignores modifiers and `defaultPrevented`.
  - `components/teleprompter/ReadingControlBar.tsx:70-95` (`useSpaceShortcut`, ADR 0196 decision 5) toggles reading on Space. Its `isWidgetTarget` check reuses `EDITABLE`, `SPACE_ACTIVATES` and `KEY_WIDGET_ROLES` from `components/teleprompter/useFollowCursor.ts:15-35`.
- **The rules already disagree.** Reading the code shows two collisions. The document listener in App.tsx runs before the window listener in WorkspacePage.tsx, and the workspace listener ignores modifiers. So on the workspace, Alt+← should both go back and step a word, and Cmd+[ should both go back and select a flag. Neither case has been reproduced or tested.
- **Other `keydown` listeners are not commands.** Any rule that forbids feature listeners must leave these alone:
  - `useFollowCursor.ts:60-69,158` (`isScrollKey`) detects a hand scroll (ADR 0119). It already skips a prevented event, which is how ADR 0196 keeps Space from pausing following.
  - `components/primitives/inputModality.ts:8` tracks the last input modality.
  - `components/primitives/Tooltip.tsx:81` closes on Escape (WCAG 1.4.13).
  - `components/manuscript/SelectionMenu.tsx:46` closes its menu on Escape.
- **Test coverage of the three consumers** (for the change-impact scan):
  - `App.test.tsx:941-945` fires Alt+ArrowLeft/Right.
  - `ReadingControlBar.test.tsx:292-315` covers the Space shortcut.
  - `useFollowCursor.test.tsx:81-88,134` pins `isScrollKey`.
  - `WorkspacePage.test.tsx` has **no** keyboard test (0 matches), so its shortcuts are zero-coverage.
- **Settings are plain string key/value pairs, stored by the host.** A new row touches three places: `config/defaults.json`, `builtinDefaults` in `apps/desktop/internal/settings/store.go:54-62`, and `fieldSchemas` in `apps/desktop/app.go:1192`. The golden contracts `tests/fixtures/contracts/settings-{global,project}.json` are checked by `apps/ui/src/api/wireContracts.test.ts:211-212`. The known kinds are `choice`, `color`, `text`, `bool` and `number` (`apps/desktop/settings_kinds_test.go:64`). A new kind is a contract change.
- **The Settings page is a list of categories** (`components/settings/Settings.tsx:25-48`). A category without a `tool`, such as Appearance or Delivery, renders its own panel.

## Proposed Solution

All shortcut handling moves into one place, `apps/ui/src/input/`. Features stop listening for keys and instead register commands there.

- **Commands.** A **command catalog** is static data. Each descriptor has an id, a label, a scope (`global | page | booth | dialog`), an optional `noisy` flag and its default gestures. Features attach behaviour at runtime with `useCommand(id, handler, enabled)` and never listen to `keydown` themselves.
- **Input sources.** Each **input source** turns device input into normalised gestures `{source: 'keyboard' | 'midi' | 'hid', code, modifiers}`. KeyboardSource is a Must. Many USB footswitches present as keyboards, so it covers them without extra work. MidiSource (Web MIDI) is a Should. HidSource (WebHID) is a Could, and both need a spike first.
- **Keymap.** A **keymap** maps a gesture to a command id for the active scopes. Defaults live in code. The narrator's overrides are stored through the host settings store.
- **Conflict detection.** A pure, unit-tested function reports two commands bound to one gesture in scopes that can be active together.
- **Screens.** A **Keyboard & pedals** Settings category shows every command and lets the narrator remap it by pressing a key or pedal. A **"?" shortcut sheet** lists what works on the current screen.
- **Recording rule.** While the DAW reports recording, `noisy` commands are suppressed (Should, depends on the DAW port).

## Key Hypothesis

We believe one registry with remappable, device-independent gestures will let a narrator run a reading session, workspace playback and navigation without the mouse, and bind their own pedal in under a minute. We will know it worked when:

- the owner binds their footswitch and reads a chapter without touching the mouse;
- no feature file adds a `keydown` listener for a command;
- the default keymap has zero conflicts.

## What We're NOT Building

| Item | Why |
| --- | --- |
| Macros, command sequences, chords (for example "g then h"), or more than one modifier set per gesture | One gesture runs one command. Sequences need timing and feedback that nothing here asks for |
| OS-level global hotkeys in the MVP (keys that reach the app while REAPER has focus) | This is a host concern (Wails and the OS), owned by lane A. It is a Could with a spike (Phase 12), meant for the companion panel |
| The booth mode layout, the companion panel, the tablet remote | Separate PRD (benchmark recommendation 2). This PRD provides the `booth` scope and the commands it will use |
| MIDI output or feedback (pedal LEDs, motor faders, a MIDI clock) | Input only. Output is a second device protocol with no requirement behind it |
| Suppressing OS notifications while recording | Belongs to the booth mode PRD. This PRD suppresses `noisy` commands only |
| Remapping primitives' own widget keys (Escape, Tab trap, arrows in a list or tabs, Enter on a row) | These are ARIA widget behaviour owned by the primitives (ADR 0047), not app commands |
| Mouse buttons 3 and 4 as a source | They stay in `App.tsx` as a pointer listener. A PointerSource is a later Could |
| Per-project keymaps | Global only (Q3) |

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Command listeners outside `src/input/` | 0; only the reasoned allowlist of non-command listeners remains | A scan test (in the style of `rawNatives.test.ts`) fails on `addEventListener('keydown'` outside `src/input/` and the allowlist. Each migration phase deletes its file's entry |
| Behaviour parity of migrated shortcuts | Existing tests pass unchanged | `App.test.tsx:941-945`, `ReadingControlBar.test.tsx:292-315`, `useFollowCursor.test.tsx` |
| Workspace shortcuts covered | Every workspace command has a test (from 0) | `WorkspacePage.test.tsx` |
| Conflicts in the default keymap | 0 | Unit test over the catalog. fast-check property tests of the conflict function, as in `Highlight.properties.test.ts` |
| Every catalog command is discoverable and remappable | 100% listed in Settings and in the "?" sheet | A test compares the catalog with both renders |
| A pedal bound by the narrator | The owner's USB pedal (keyboard-type) works end to end. A MIDI pedal works on Windows if the Phase 8 spike passes | Owner check, pending until the hardware is available |
| No noisy command while recording | 0 noisy handlers run while recording is reported | Unit test with a fake recording state (Phase 10) |

## Open Questions

- [ ] **Q1. Bind by physical key or by character?** `event.code` is the same on every keyboard layout and is what pedals emit consistently. `event.key` follows the layout, so `[` moves on a German keyboard. **Recommendation:** store `code`. Show the key's label through `navigator.keyboard.getLayoutMap()` where the webview has it (TBD - needs the Phase 8 spike to confirm per webview), and fall back to the US name.
- [ ] **Q2. Storage shape of the overrides.** **Recommendation:** one `Keymap.overrides` row of kind `text`, global scope, hidden from the generic rows. It holds a versioned JSON document `{"version":1,"bindings":{"<command id>":["<gesture>", ...]}}` of changes from the defaults, parsed in the UI through `parseWireJson` and a Zod schema. The alternatives are one row per command, which makes the host know every command id, or a new `keymap` kind, which changes the wire contract.
- [ ] **Q3. Project-scoped keymaps?** **Recommendation:** no. A narrator's pedal belongs to the booth, not the book.
- [ ] **Q4. Where the remap screen lives.** **Recommendation:** a **Keyboard & pedals** category in Settings, global scope. This adds no nav item, so it avoids the nav serialization point in the PRD README.
- [ ] **Q5. Which commands are `noisy`, and what a suppressed press does.** **Recommendation:** noisy commands are the ones that play audio in the app: workspace playback and a TTS preview. A suppressed press does nothing audible and posts "Not while recording" to the status region.
- [ ] **Q6. Single-key defaults and screen readers.** Space, arrows and `[ ]` are single-key shortcuts. WCAG 2.1.4 allows them when the user can remap or turn them off, which this PRD provides. NVDA's and JAWS' browse mode may swallow them. **Recommendation:** keep the current defaults, expose each binding as `aria-keyshortcuts`, and have the owner check with NVDA (pending).
- [ ] **Q7. MIDI device identity.** **Recommendation:** a MIDI binding matches any input port in the MVP (`midi:cc/1/64`). Per-device bindings come later if two controllers clash.
- [ ] **Q8. The shortcut sheet's key.** **Recommendation:** `?` (Shift+Slash), plus a "Show all shortcuts" link in the Settings category.

## Users & Context

- **The narrator in the booth:** reads from the teleprompter or read-aloud dialog. Needs play, stop, next and previous, punch and flag on keys or a footswitch, and must not trigger a sound while the DAW records.
- **The editor at the desk:** steps words, paragraphs and flags in the chapter workspace from the keyboard (edit-and-proof-workspace Phase 2).
- **A blind or low-vision producer:** works in REAPER with OSARA and needs the app's commands discoverable in a list and announced with their shortcut (Booth UX).
- **An agent adding a feature:** registers a command in the catalog and calls `useCommand`. It does not write a listener.

## Solution Detail

### Core capabilities (MoSCoW)

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | `src/input/`: catalog, `useCommand`, scope resolution, target guard, keymap resolver, pure conflict detection, KeyboardSource, guard scan | 1 |
| Must | Migrate Back/Forward, the workspace keys and the reading Space onto the registry, keeping today's behaviour | 2, 3, 4 |
| Must | Overrides persisted through the host settings store | 5 |
| Must | Keyboard & pedals settings category: view, remap by pressing, reset, conflict message | 6 |
| Must | "?" shortcut sheet dialog | 7 |
| Should | MidiSource via Web MIDI (note-on and CC as presses), learned in the same "press a pedal" flow | 8, 9 |
| Should | Silent while recording: `noisy` commands suppressed while the DAW reports recording (needs a live recording state from the DAW port) | 10 |
| Could | HidSource via WebHID | 11 |
| Could | Host-level global hotkeys while REAPER has focus (lane A, spike) | 12 |
| Won't | Macros, chords, MIDI output, per-project keymaps | - |

### MVP scope

Phases 1 to 7. At that point every existing shortcut runs through the registry, every command can be remapped and discovered, and a USB pedal that sends a key can be bound.

### User flow

1. The narrator opens **Settings > Keyboard & pedals**. Commands are grouped by scope. Each shows its label and its gestures as `Kbd` chips.
2. They choose **Change** on "Play or pause reading". A recorder says "Press a key or a pedal…". They press the footswitch, which sends `PageDown`.
3. `PageDown` is already bound to "Next paragraph" in an overlapping scope, so the recorder names that command and offers **Replace** or **Cancel**. They choose Replace.
4. The override is saved to the host settings. From now on, in the read-aloud dialog, the pedal toggles reading. The registry consumes the key (`preventDefault`), so `isScrollKey` does not also pause following (ADR 0119, the same mechanism as ADR 0196).
5. Anywhere in the app, `?` opens the sheet of what works on that screen.

## Technical Approach

**Feasibility:** high for the keyboard, since everything runs in the UI and the host already stores the settings. For MIDI and HID it is platform-dependent. WebView2 (Windows) is Chromium, which ships Web MIDI and WebHID. Whether WebView2 exposes them, and how their permission prompt is answered inside Wails v3, is unknown (TBD - needs the Phase 8 spike). WKWebView (macOS) and WebKitGTK 6.0 (Linux, `docs/prds/wails-v3-migration.prd.md:18`) are not known to ship either API. So MIDI and HID may be Windows-only, or may need a host-side reader. Keyboard-type USB pedals work everywhere through KeyboardSource.

**Architecture** (dependency inversion, mirroring the host's ports; [ADR 0361](../adr/0361-app-commands-go-through-one-registry-and-keyboard-midi-and-hid-are-input-sources-bound-by-a-remappable-keymap.md)):

- **Location.** Everything lives in `apps/ui/src/input/`, not under `components/`. Primitives stay leaves (`primitives-are-leaves`, [ADR 0062](../adr/0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md)), and features import `src/input`, never the other way round.
- **`commands.catalog.ts`.** One `CommandDescriptor` per command: `id` (for example `nav.back`, `workspace.word.next`, `reading.toggle`), `label`, `scope`, `noisy?`, `defaults: Gesture[]`. A test fails when a `useCommand` id is not in the catalog, and when a catalog row is never registered. This is the approach `interactionFeedback.catalog.ts` takes (ADR 0075).
- **`Gesture`.** `{source, code, modifiers}`, serialised as `Alt+ArrowLeft`, `midi:cc/1/64` or `hid:<vid>:<pid>/<button>`.
  - `Mod` in a default means Meta on macOS and Ctrl elsewhere.
  - F13 to F24 stay unbound by default, so a programmable pedal can use them without a conflict.
- **`InputSource`.** `subscribe(onGesture) => unsubscribe`. Implementations are `KeyboardSource` (document `keydown`, normalises modifiers, ignores `repeat` for press-only commands), `MidiSource` and `HidSource`. The router depends on the interface only. Tests drive a fake source.
- **Router.** Mounted once at the root (`main.tsx`; TBD - needs a check of how `App.test.tsx` renders without it). Per gesture it does the following:
  1. Resolves the active scopes:
     - `dialog`: the topmost dialog's own commands, declared by a `CommandScope` boundary the dialog's content wraps.
     - `booth`: a reading surface is mounted, such as the read-aloud dialog or the Teleprompter page.
     - `page`: the mounted page, when no dialog is open.
     - `global`: always, except while a modal dialog is open. This keeps the rule in `App.tsx`.
  2. Looks up the keymap and takes the most specific scope.
  3. Checks `enabled()`.
  4. For a gesture without a modifier, applies the target guard. The guard reuses `EDITABLE`, `SPACE_ACTIVATES` and `KEY_WIDGET_ROLES`, moved from `useFollowCursor.ts` to `src/input/targets.ts` and re-exported where they were. A field or widget that owns the key keeps it.
  5. Suppresses `noisy` commands while recording.
  6. Calls `preventDefault` and the handler. A gesture no command takes is left untouched.
- **Conflict detection.** `findConflicts(catalog, keymap): Conflict[]` is a pure function over `scopesOverlap(a, b)`.
  - `global` overlaps `page` and `booth`. `page` overlaps `booth`. A `dialog` overlaps only itself and `booth`.
  - The function has unit tests and fast-check property tests: symmetry, distinct gestures never conflict, and adding a binding never removes a conflict.
- **Persistence (lane A).** One settings row, shaped per Q2, appended to `config/defaults.json`, `store.go` `builtinDefaults` and `app.go` `fieldSchemas`. The golden settings contracts are regenerated with `UPDATE_CONTRACTS=1`, and the mock follows. The UI reads the row through the existing settings binding and parses it with `parseWireJson`, never a bare `JSON.parse` (wire contracts). A malformed document falls back to the defaults and reports `wire_invalid`. The save call gets an `interactionFeedback.catalog.ts` row. The overrides live with the host, not in `localStorage`. They survive a webview profile reset, and the host can read the same keymap later for global hotkeys (Phase 12).
- **Accessibility.** A control that runs a command sets `aria-keyshortcuts` from the live keymap, through a `useShortcutLabel(id)` helper. The sheet is a `Dialog`, so it gets an aria snapshot (ADR 0065).

**Risks:**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A migration changes behaviour that users rely on | Medium | Existing tests pass unchanged. Workspace tests are written first (TDD), since that page has none today |
| `App.tsx` is a hot file and every stream edits it | High | Only Phase 2 edits its listener. Phase 7 mounts the sheet after Phase 2. One PR at a time |
| A pedal key (PageDown) also pauses following | Medium | The router calls `preventDefault` on a consumed gesture, and `isScrollKey` skips prevented events (ADR 0119/0196, unchanged) |
| Web MIDI or WebHID is absent or blocked by permission in a webview | High | Phase 8 spike first. MIDI and HID are Should and Could. KeyboardSource covers keyboard-type pedals everywhere |
| Screen-reader browse mode swallows single keys | Medium | Remappable and unbindable (WCAG 2.1.4), `aria-keyshortcuts`, owner NVDA check (Q6) |
| A new device input channel is an unrecorded trust boundary | Low | Phases 9 and 11 add a threat-model row (webview input from a device) and update `SECURITY.md` |

## Implementation Phases

Lanes: **U** = primitives and input (Sonnet), **A** = host (Go settings). ADRs come from block U, 0360 to 0379. Each phase is one PR of about 2 hours of agent work.

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Registry core (U) | `src/input/`: catalog, gestures, `InputSource`, KeyboardSource, router, scopes, target guard, conflict function, `useCommand`. Listener guard scan with a ratchet allowlist. ADR 0361 to Accepted | complete | alone | - | - |
| 2 | Migrate app navigation (U) | Back/Forward in `App.tsx` become `global` commands. Mouse buttons 3 and 4 stay | pending | with 3, 4, 5 | 1 | - |
| 3 | Migrate workspace keys (U) | `WorkspacePage.tsx` Space, arrows, `[ ]` become `page` commands, with tests first | pending | with 2, 4, 5 | 1 | - |
| 4 | Migrate the reading Space (U) | `ReadingControlBar.tsx` Space becomes the `booth` command `reading.toggle`. ADR 0196 behaviour is kept | complete | with 2, 3, 5 | 1 | - |
| 5 | Keymap settings row (A) | `Keymap.overrides` in defaults, store, `fieldSchemas`, contracts, mock | pending | with 1 to 4 | Q2 | - |
| 6 | Keyboard & pedals settings (U) | Settings category: list, remap by pressing, conflict message, reset. Visual rows | pending | with 7 | 1, 5, Kbd | - |
| 7 | Shortcut sheet (U) | "?" opens a dialog of the active commands by scope. Aria snapshot, visual row | pending | with 6 | 2, Kbd | - |
| 8 | Spike: Web MIDI and WebHID (U) | Availability and permission in WebView2, WKWebView and WebKitGTK 6.0. A research note | pending | with 2 to 7 | - | - |
| 9 | MidiSource (U, A if needed) | Web MIDI note-on and CC presses, learned in the Phase 6 recorder. Threat model | pending | with 10 | 6, 8 | - |
| 10 | Silent while recording (U) | `noisy` commands suppressed while the DAW port reports recording | pending | with 9 | 1, DAW port P9 | - |
| 11 | HidSource (U, Could) | WebHID buttons as gestures, if Phase 8 finds it usable | pending | - | 8, 9 | - |
| 12 | Global hotkeys spike (A, Could) | Host-level hotkeys while REAPER has focus, for the companion panel. Not MVP | pending | any | 5 | - |

### Phase details

**Phase 1.**
- **Scope.** The new folder, with colocated Vitest tests (`// @vitest-environment jsdom` for the router and source). The catalog starts with the current shortcuts, using their exact current gestures.
- **Move.** `EDITABLE`, `SPACE_ACTIVATES` and `KEY_WIDGET_ROLES` move to `src/input/targets.ts`. `useFollowCursor.ts` re-exports them, so `isScrollKey` and its tests are untouched (ADR 0119).
- **Guard scan.** The scan's allowlist has two kinds of entry:
  - Permanent, each with a reason: `inputModality.ts`, `Tooltip.tsx`, `SelectionMenu.tsx`, `useFollowCursor.ts`.
  - Temporary, each naming its migration phase: `App.tsx`, `WorkspacePage.tsx`, `ReadingControlBar.tsx`.
- **ADR.** Sets [ADR 0361](../adr/0361-app-commands-go-through-one-registry-and-keyboard-midi-and-hid-are-input-sources-bound-by-a-remappable-keymap.md) to Accepted and adds its index row.
- **Done when:** the fake-source tests prove scope resolution, the target guard, `preventDefault` on a consumed gesture only, and zero conflicts in the defaults.

**Phase 2.**
- **Scope.** Registers `nav.back` and `nav.forward` (`global`) with `Alt+ArrowLeft`, `BrowserBack` and `Mod+BracketLeft`, and their forward pairs. The modal-open rule becomes scope resolution. The `mousedown`/`mouseup` handler stays as it is. The `App.tsx` allowlist entry becomes a pointer-only note.
- **Done when:** `App.test.tsx:941-945` passes unchanged, and a new test proves Alt+← on the workspace no longer steps a word (once Phase 3 has also landed).

**Phase 3.**
- **Scope.** Workspace tests first: Space, the four arrows, `[ ]`, typing in a field, and a modifier held. Then `workspace.*` `page` commands through `useCommand`. The current listener fires with a modifier held. After this phase, a modifier stops the command: exact modifier match. `workspace.play` is flagged `noisy`.
- **Coordination.** Coordinate with [Edit and Proof Workspace](edit-and-proof-workspace.prd.md), which also edits this file.

**Phase 4.**
- **Scope.** `reading.toggle` (`booth`, Space) replaces `useSpaceShortcut`. The read-aloud dialog and the Teleprompter page wrap their content in the `booth` boundary. Stop still has no shortcut (ADR 0196).
- **Done when:** `ReadingControlBar.test.tsx:292-315` passes unchanged, and so does the following-pause behaviour of `useFollowCursor.test.tsx`.

**Phase 5 (lane A).**
- **Scope.** Appends the row: `config/defaults.json`, `apps/desktop/internal/settings/store.go`, and `apps/desktop/app.go` `fieldSchemas`. Adds a Go size cap on the value, for example 64 KiB. Regenerates `tests/fixtures/contracts/settings-*.json` with `UPDATE_CONTRACTS=1`. Updates the mock settings, then adds a Zod schema for the document in `apps/ui/src/api/schemas/` and a `wireContracts.test.ts` row.
- **Version.** No new binding, so `hostAPIVersion` (61, `app.go:55`) does not change unless Q2 picks a new kind.

**Phase 6.**
- **Screen.** A `Keyboard` category (label "Keyboard & pedals", global, no `tool`, its own panel). Groups by scope. Uses the `Kbd` primitive from [Studio UI Primitives](studio-ui-primitives.prd.md). Nothing is shown before that primitive lands.
- **Recorder.** A recorder with a live region that announces the captured gesture. Conflict messages come from `findConflicts`. Includes Replace, Unbind, and Reset to defaults.
- **Host calls.** Save calls get `interactionFeedback.catalog.ts` rows.
- **Visual rows.** `state-catalog.ts` and `app.drivers.ts` rows: `settings / global-keyboard`, `global-keyboard-recording` and `global-keyboard-conflict`, captured at the reflow width like every Settings state (ADR 0061).

**Phase 7.**
- **Sheet.** `help.shortcuts` (`global`, `Shift+Slash`) opens a `Dialog` listing the commands active at that moment, then "Show all" (a link to Settings).
- **Checks.** An aria snapshot in `apps/ui/tests/aria/dialogs.spec.ts` (ADR 0065) and a visual row.
- **Scheduling.** Mounted from `App.tsx`, so it lands after Phase 2.

**Phase 8.**
- **Question.** In a Wails v3 build on each platform, is `navigator.requestMIDIAccess` present? Does a MIDI footswitch deliver `noteon` or CC 64? Is `navigator.hid` present, and can `requestDevice` show its chooser? Where must a permission request be answered: page, WebView2 `PermissionRequested` in the host, or not at all?
- **Output.** A research note under `docs/research/` records each answer with the build used. If the webview cannot deliver MIDI, it records whether a host-side MIDI reader (lane A) is worth a follow-up.

**Phase 9.**
- **Source.** MidiSource maps note-on (velocity > 0) and CC ≥ 64 to a press, with a 30 ms debounce. It follows port hot-plug.
- **Learning.** The Phase 6 recorder also learns MIDI.
- **Host.** Host permission handling goes in lane A if Phase 8 says it is needed.
- **Security.** Updates the threat-model row and `SECURITY.md` (feature-cleanup trust-boundary check).

**Phase 10.**
- **Source of the recording state.** The router reads it through [DAW Port and Capabilities](daw-port-and-capabilities.prd.md). That PRD puts capabilities on the wire (its P4, `DawCapabilities` and `daw_capabilities_changed`) and its P9 adds the live transport state (`daw_transport_changed`, `{playing, recording}`) this phase reads. Today's only recording flag is the click-refreshed `ReadAloudReaperState.recording` (ADR 0249), which is not live.
- **Suppressed press.** Follows Q5.
- **Tests.** Unit tests use a fake state.

**Phase 11.** HidSource maps button reports to `hid:<vid>:<pid>/<button>`, only if Phase 8 finds WebHID usable. Otherwise the phase closes as won't-do with the spike's reason.

**Phase 12.** Spike, lane A. Can Wails v3 or the OS register a hotkey that fires while REAPER has focus, and at what cost (a Windows `RegisterHotKey` hook, macOS accessibility permission)? The keymap row is the source of truth either way.

### Parallelism notes

- **Phase 1 runs alone.** Every other U phase builds on it.
- **Phases 2, 3 and 4 run concurrently** because they touch disjoint files: `App.tsx`, `WorkspacePage.tsx` and `ReadingControlBar.tsx`, each with its own test and its own allowlist line.
  - Three PRs editing the same allowlist file will conflict trivially on rebase. Keep one entry per line.
  - `App.tsx` is a hot file: only one PR at a time across all PRDs.
- **Phase 5 (lane A)** only needs Q2 answered, so it can run alongside 1 to 4.
- **Phases 6 and 7 run concurrently.** 6 edits `Settings.tsx` and 7 edits `App.tsx`. They share only `state-catalog.ts`, which is append-only.
- **Phase 8** is research and can run any time.
- **Phases 9 and 10 run concurrently** (different modules in `src/input/`). 10 waits on the DAW port PRD.

### Parallel-session compatibility

| Phase | Files touched | Collides with |
| --- | --- | --- |
| 1 | `apps/ui/src/input/*` (new), `apps/ui/src/main.tsx`, `components/teleprompter/useFollowCursor.ts` (re-export only), `docs/adr/0361-*.md`, `docs/adr/README.md` | Anything editing `main.tsx` mock wiring. The ADR README index (every ADR) |
| 2 | `apps/ui/src/App.tsx`, `App.test.tsx`, the scan allowlist | [App Navigation and Zoom Controls](app-navigation-and-zoom-controls.prd.md), and every stream that edits `App.tsx` |
| 3 | `components/workspace/WorkspacePage.tsx`, `WorkspacePage.test.tsx`, the allowlist | [Edit and Proof Workspace](edit-and-proof-workspace.prd.md) |
| 4 | `components/teleprompter/ReadingControlBar.tsx`, `ReadAloudDialog.tsx`, `TeleprompterPage` wrapper, the allowlist | [Read Aloud Control Bar](read-aloud-control-bar.prd.md) Phase 7, [Read Aloud Resume from the DAW](read-aloud-resume-from-daw.prd.md), the booth mode PRD |
| 5 | `config/defaults.json`, `apps/desktop/internal/settings/store.go`, `apps/desktop/app.go`, `tests/fixtures/contracts/settings-*.json`, `apps/ui/src/api/schemas/`, mock settings | Any PRD adding a setting (append-only rows, `fieldSchemas`) |
| 6 | `components/settings/Settings.tsx`, a new `components/settings/KeyboardPanel.tsx`, `interactionFeedback.catalog.ts`, `tests/visual/state-catalog.ts`, `app.drivers.ts` | Any new Settings category. [Studio UI Primitives](studio-ui-primitives.prd.md) (`Kbd`) |
| 7 | `App.tsx` (mount), a new `components/help/ShortcutSheet.tsx`, `tests/aria/dialogs.spec.ts` and snapshots, `state-catalog.ts` | Phase 2 and every `App.tsx` stream. Any dialog aria snapshot change |
| 8 | `docs/research/` (new note) | None |
| 9 | `apps/ui/src/input/midi*`, `docs/architecture/threat-model.md`, `SECURITY.md`, possibly a host permission handler | Any PRD editing the threat model's webview rows |
| 10 | `apps/ui/src/input/router*` | [DAW Port and Capabilities](daw-port-and-capabilities.prd.md) (consumer only) |
| 11 | `apps/ui/src/input/hid*`, threat model | Same as 9 |
| 12 | `apps/desktop` (spike branch only), `docs/research/` | [Wails v3 Migration](wails-v3-migration.prd.md) follow-ups |

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Where input lives | `apps/ui/src/input/` | `components/input/`, a primitive | Primitives are leaves (ADR 0062). Input is a service that features depend on, like `chapterStatus.ts` |
| Command shape | Static catalog of descriptors, with handlers attached at runtime by `useCommand` | Commands declared only in components | Settings and the sheet must list commands whose page is not mounted. The catalog is testable data |
| Features and keys | Features register commands and never listen to `keydown` | Keep per-feature listeners with shared helpers | One place applies the dialog, target and recording rules. A scan enforces it (ADR 0361) |
| Devices | `InputSource` interface with keyboard, MIDI and HID implementations, and normalised gestures | Device code in the router | Dependency inversion. Tests use a fake source. A new device is one new class |
| USB pedals | Covered by KeyboardSource | A USB-specific source | Most footswitches present as HID keyboards and send a key |
| Persistence | Host settings store, one global row (Q2) | `localStorage` | Survives a webview profile reset. The host can reuse it for global hotkeys |
| Conflicts | Pure `findConflicts` over overlapping scopes, zero in defaults, a remap conflict asks | Last binding wins silently | A silent shadow is the bug class this PRD removes |
| Existing ADRs | ADR 0196 behaviour and ADR 0119 `isScrollKey` kept. The registry's `preventDefault` is the same hand-off ADR 0196 uses | Rewrite scroll detection as a command | Scroll intent is detection, not a command |

## Research Summary

- **Benchmark:** the must-have (`:75`), the Booth UX rules (`:116-119`), the Missing row (`:191`) and recommendation 2 (`:345-346`). The pedal source cited there is the Nektar PACER, a MIDI footswitch controller [W35].
- **Codebase:** see Evidence. The three listeners, their helper constants, and the gap in workspace test coverage.
- **Platform:** Web MIDI and WebHID are Chromium APIs, and WebView2 is Chromium. Their exposure and permissions inside WebView2 under Wails v3 are unverified. WebKit-based webviews (macOS, Linux) are not known to ship them. Hence the Phase 8 spike before any MIDI or HID work.
- **Accessibility:** WCAG 2.1.4 (Character Key Shortcuts) is met by remapping or turning shortcuts off. `aria-keyshortcuts` exposes a binding to assistive technology.

## Visual Spec

No mockups yet. Before Phase 6 starts, owner-approved mockups of the Keyboard & pedals category (list, recording, conflict) and of the "?" sheet go under `mockups/input-commands-and-pedals/`.
