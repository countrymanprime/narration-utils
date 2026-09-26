# 0360. Studio primitives land as flat leaf files after one token batch, and capability gating is a primitive

**Status:** Proposed
**Date:** 2026-09-26
**Supersedes:**

## Context

The [audiobook studio benchmark](../research/audiobook-studio-benchmark.md) (section 3, recommendations 2 to 5) asks for a booth mode, a compact DAW companion, a proof timeline, a QC page and a production board. [Studio UI Primitives](../prds/studio-ui-primitives.prd.md) found that none of them can be drawn from the 33 primitives in `apps/ui/src/components/primitives/` today. There is no key cap, no audio level meter with zones, no status badge, no KPI tile, no toolbar, no timeline, no cell-navigable grid, no full-screen or narrow layout, and no single way to show a control the DAW cannot do yet. The local copies that exist show what happens without them:

- `InputLevelMeter.tsx` in `teleprompter/`;
- `StatTile` inside `home/RecordingCheckReport.tsx`;
- hand-drawn status dots in `AudiobookEstimatePanel.tsx` and `manuscript/ChapterNav.tsx`, and a second `STATUS_COLOR` map in `tracks/LinkChaptersDialog.tsx`.

Three facts forced a decision on *how* the new primitives land, not only which ones:

1. **Parallel sessions.** The benchmark train runs several agent sessions at once. Lane U builds the primitives and lane C the feature screens. Primitives that share files cannot land in parallel.
2. **Two conflict hot spots.** Every colour token lives in the two theme blocks of `apps/ui/src/styles.css`, and every colour pair must be listed in `PAIRS` in `apps/ui/src/paletteContrast.test.ts`, with `KNOWN_FAILURES` empty ([ADR 0059](0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md)). Two phases adding tokens conflict every time.
3. **Hard-coded DAW gating.** "Punch from here" (`teleprompter/ReaderFlagsPanel.tsx`, the `PUNCH_PENDING` constant) and "Record in REAPER" (`teleprompter/ReadingControlBar.tsx`) are always disabled, each with a reason string the UI wrote. The DAW port work ([DAW Port and Capabilities](../prds/daw-port-and-capabilities.prd.md), [ADR 0300](0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md), drafted alongside this ADR) makes the host report what each DAW can do: per capability a level (`unsupported`, `not_yet_available`, `experimental`, `supported`), whether it is available right now, and a message for the narrator. If nothing changes, every hard-coded button must be found and edited by hand when the host starts reporting. Also, a disabled child of `TooltipTarget` becomes a `role="group"` wrapper named by the reason, so a screen reader hears why the control is off but never what the control is.

## Decision

**All new colour tokens land in one phase that runs alone.** Phase 1 of the PRD adds every colour token the studio primitives need:

- the meter zones;
- badge fills, where a tint of an existing status token does not reach contrast;
- the `experimental` tone;
- a high-contrast booth token block, proposed as `[data-surface='booth']` and scoped to `FocusShell` (open question Q1 of the PRD).

Each token goes in both theme blocks of `styles.css`, and the booth block covers all of them. Each gets a `PAIRS` row, and `src/tokenContrast.ts` learns to check the booth block as a third token map. No later phase of the PRD edits `styles.css`, `paletteContrast.test.ts` or `tokenContrast.ts`. A primitive that finds it needs a colour after Phase 1 waits for a follow-up token batch. It never adds a colour in its own pull request.

**Each studio primitive is one flat leaf file under the existing rules.**

- **The primitives:** `Kbd`, `LevelMeter`, `StatusBadge`, `StatTile`, `Toolbar`, `Timeline` (with `TimelineLane` in the same file), `StageGrid`, `FocusShell`, `CompactShell` and `CapabilityGate`.
- **The files:** each is a `<Name>.tsx` in `apps/ui/src/components/primitives/`, with its `<Name>.stories.tsx` and `<Name>.test.tsx` beside it.
- **The rules:** Base UI is imported per component and only there ([ADR 0047](0047-the-ui-primitives-wrap-base-ui-and-app-code-never-imports-it.md)). Nothing else under `components/` is imported (`primitives-are-leaves`, [ADR 0062](0062-ui-import-rules-are-a-dependency-cruiser-config-and-a-mark-scan-that-name-their-adr.md)). Shared data and logic go in `apps/ui/src/*.ts`, for example the level ballistics in `src/levelMeter.ts` and the status-to-tone map in `src/chapterStatus.ts`. Styling is Tailwind utilities on `var(--token)`, with no class added to `styles.css` ([ADR 0009](0009-complete-tailwind-migration.md), [ADR 0017](0017-no-legacy-css-shadowing-tailwind.md)).
- **The one shared edit:** a primitive's pull request may touch one shared file, its row in the primitive table of `docs/design/design-system.md`, and the coordinator merges those rows mechanically.
- **`docs/ui/` is regenerated once,** by the PRD's close-out phase with `pnpm --dir apps/ui docs:atlas`, because its `inventory.json` is shared.

**`LevelMeter` is a new primitive, and `MeterBar` is left alone.**

- **`LevelMeter`** is a live `role="meter"`. It shows peak and RMS in dBFS, a peak-hold tick, and zones at the peak ceiling and the noise floor (ACX's −3 dB and −60 dB by default). Its accessible value updates at most once a second. It replaces `teleprompter/InputLevelMeter.tsx`.
- **`MeterBar`** stays the segmented progress image of [ADR 0050](0050-the-segmented-meter-is-an-image-named-by-its-segments-and-field-wires-its-hint-and-error.md).

**Capability gating is a primitive, fed by a hook outside the primitives.**

- **The primitive.** `CapabilityGate` is presentational. It takes one capability entry, `{ level, available, message? }`, typed locally so the primitive imports nothing from `src/api`, and one control:
  - available at `supported`: renders the control unchanged.
  - available at `experimental`: renders the control enabled, with an "Experimental" `StatusBadge` and the message as its description.
  - not available, at any level: renders the control `aria-disabled` and still focusable. The gate swallows its press, and the host's message is both its `aria-describedby` and its tooltip. The narrator hears the control's name first, then why it is off. A caller may choose to hide an `unsupported` control instead.
- **The hook.** `useCapability(cap)` lives in `apps/ui/src/useCapability.ts`, not in `primitives/`. It reads the host's `DawCapabilities` report and follows its `daw_capabilities_changed` event through `useApi()`. The binding, contract, schema, golden and mock (`src/api/dawMock.ts`) are the DAW port PRD's; this decision adds none of them. The hook's call and subscription have their rows in `src/interactionFeedback.catalog.ts` ([ADR 0075](0075-every-action-that-leaves-the-interface-acknowledges-within-100-ms-cannot-be-fired-twice-and-tells-the-narrator-when-it-ends.md)).
- **Where the message comes from.** The text comes from the host. Neither the gate nor a feature file writes its own "not built yet" string for a DAW capability.
- **The existing gated controls.** "Punch from here", "Record in REAPER" and the nav's `requiresDaw` move onto the gate in the DAW port PRD's P7, after the gate and the hook land. One PRD edits those files, not two. The gate itself needs no API, so it lands and is judged in the atlas before the binding exists.
- **Other disabled controls.** `TooltipTarget`'s disabled-child behaviour stays for disabled controls that are not about a DAW capability.

**`Kbd` only draws keys.** The command registry, key bindings and pedal input belong to [Input Commands and Pedals](../prds/input-commands-and-pedals.prd.md) ([ADR 0361](0361-app-commands-go-through-one-registry-and-keyboard-midi-and-hid-are-input-sources-bound-by-a-remappable-keymap.md)).

**The two shells are layout only.**

- **`FocusShell`** is the full-screen booth layout. The feature decides whether it is a route or sits in `Dialog size="full"` ([ADR 0094](0094-dialog-gains-a-full-size-variant-that-fills-the-viewport-with-a-margin.md)).
- **`CompactShell`** is the narrow companion layout. Always-on-top, window flags and global hotkeys are the host's.

## Consequences

- **Parallel work.** After the token batch, phases 2 to 10 of the PRD add only new files and one table row, so up to nine lane U sessions can run at once. Lane C feature PRDs get finished parts instead of writing local widgets. The existing checks enforce the rules without new tooling: `atlasCoverage.test.ts`, `baseUiBoundary.test.ts`, `rawNatives.test.ts`, `paletteContrast.test.ts`, `legacyCss.test.ts` and the dependency-cruiser rules.
- **Capabilities switch on without UI edits.** When the host reports a capability available (it moved to `supported`, or REAPER started), every gated control comes to life with no UI change. Keyboard and screen-reader users hear what a disabled DAW action is and why it is off.
- **What was given up.** Colour work is serialized: a primitive that needs a token after Phase 1 waits for another batch. The booth look is a scoped token block that the palette guard checks as a third map, so every future token needs a booth value as well as light and dark. Disabled capability controls use `aria-disabled` rather than `disabled`, so the gate, not the browser, must stop the press, and a test must prove it does.
- **Dependencies.** `useCapability` depends on the DAW port PRD's binding (its P4), and the call-site moves depend on its P7. If ADR 0300 changes the capability shape, only the hook and the gate's local entry type change, not the callers.
- **Changing this decision.** To let a primitive add its own tokens, to make a primitive import the API, or to gate DAW actions differently, write a new ADR that supersedes this one (see [the ADR README](README.md)). This ADR moves to Accepted when the PRD's first phases land. Further decisions from the PRD take the next free number in lane U's block (0362 to 0379), checked at merge time.
