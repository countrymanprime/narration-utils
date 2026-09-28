# 0460. The Audacity mastering row is its own row, not `daw`, and imports the source as its own track before the macro

**Status:** Proposed
**Date:** 2026-09-28
**Supersedes:** none. It answers the open question [ADR 0306](0306-mastering-is-a-provider-port-and-measurement-stays-one-in-process-judge.md) left for this phase ("whether it stays its own row or becomes the `daw` row served by the Audacity adapter's `render_with_fx` is decided in that phase, by how close the macro-and-export flow comes to the role").

## Context

Render-encode-master Phase 10 ("Apply the narrator's chosen Audacity effect macro, then `Export2` to a folder the host created, then measure and judge the file") is the second row behind `internal/masteringport`, after Phase 9's REAPER `daw` row. ADR 0306 built `daw` on two DAW port roles that are shaped around REAPER's own mixing model:

- `FXRenderer.RenderWithFX(runID, FXRender{Regions, OutputFolder})`: renders one or more named **regions** through the project's **per-track and master FX chains**, answered asynchronously through `Events` (the bridge's fan-out, tagged `FX_RENDER_FILE`/`FX_RENDERED`).
- `MasterChainReader.ReadMasterChain()`: lists every track's FX and the master's, so the UI can show the narrator the chain before they approve it.

Audacity has neither of these things behind `mod-script-pipe` (`docs/research/audacity-4-scripting-spec.md`; `apps/desktop/internal/audacitybridge`):

- No regions. Audacity has labels and a time selection, not REAPER-style named project regions a render can target by name.
- No per-track/master FX chain to read. A **macro** (Macro Manager) is one opaque, narrator-authored chain the scripting reference exposes only by name (`ApplyMacro: MacroName=...`); there is no documented command that lists a macro's own steps back.
- No asynchronous event log to poll. `internal/audacitybridge.Client` is a synchronous request/reply pipe (`Do(ctx, cmd)` returns the reply directly), not REAPER's Lua bridge writing to a file another loop polls.

Forcing the Audacity flow into `render_with_fx`/`master_chain_read` would mean answering `ReadMasterChain` with a `MasterChain{Tracks, Master}` this app cannot actually read from Audacity (fabricating a chain), and modelling "apply this macro" as "render this region," which is not what either call does.

## Decision

**The Audacity row is its own registry row, `audacity` (`internal/masteringport/mastering_audacity.go`), not the `daw` row.** It masters `ModeWAV` (a rendered WAV at `Request.Source`), like `builtin`, not `ModeDAWRegion`: the row does not read a region from the DAW, it drives Audacity end to end from a file this app already has.

**A new DAW port capability, `macro_render` (`dawport.CapMacroRender`, role `MacroRenderer.RenderWithMacro`), replaces `render_with_fx`/`master_chain_read` for this row.** It is synchronous, matching Audacity's own client shape, and carries exactly what the flow needs: a source path, the macro's exact name, an output path, and the narrator's one-time approval. REAPER declares it `Unsupported` (`port.go`'s own example is this shape the other way around: "Audacity has no punch-and-roll"); Audacity declares it `Experimental`, alongside `navigate` and `markers`.

**The row's `Master`:**
1. checks `Request.Approved`, `Request.Macro`, and computes a fresh destination the same way `daw.go`'s `newDestination` does (never the source, never an existing file);
2. makes an empty run folder inside the project (`daw.go`'s exact `narration-utils/mastering/<hex>` shape, reused unmodified);
3. asks `macro_render` for `RenderWithMacro`, which imports the source as its **own new track** (`Import2`), selects **only** that track (`SelectTracks`, by the index Audacity reports for the import), applies the named macro (`ApplyMacro`), and exports (`Export2`) into the run folder;
4. moves the one exported file into place without ever replacing a file (`daw.go`'s `placeNew`, reused unmodified);
5. answers `Judge`'s verdict on the file it wrote — `internal/measure` then `internal/deliveryprofile`, never a level Audacity itself reports, same as every row.

Selecting only the freshly imported track, rather than selecting nothing (which Audacity would run the macro or export against the whole project) or everything, is deliberate: applying a macro is the same kind of DAW-triggered render `daw.go`'s row already is, and it must never touch whatever else the narrator happens to have open in Audacity.

**The same four conditions ADR 0306 set for a DAW-triggered render apply unchanged:** the narrator's approval for this one run (`Request.Approved`, carried to the engine as `MacroRender.Approval`, never stored); it runs only from the narrator's action; it is Experimental until the owner's Audacity 3.x pass (`docs/operations/audacity-verification-pass.md`, tracked on [#510](https://github.com/countrymanprime/narration-utils/issues/510)); it writes only into the empty folder this app made.

**`masteringporttest.Problems()` (the conformance suite every row passes) now sets up a fake DAW session for any row whose `Capabilities().Needs` names a DAW capability, not only a `ModeDAWRegion` row.** The Audacity row is `ModeWAV` but still triggers a render through `macro_render` under the same approval rules `ModeDAWRegion` rows get checked against; a new fake, `masteringporttest.FakeAudacity`, mirrors `FakeDAW`'s refusal and misbehaviour shape (`Escapes`, `Fails`) over `MacroRenderer` instead of `FXRenderer`. This keeps `TestANewRowIsOneRegistrationAndPassesTheSuiteWithNoOtherEdit`'s promise: registering a row that needs a DAW capability costs the suite an extension once, not a special case per test file that registers one.

## Consequences

- A DAW-shaped row and a script-pipe-shaped row now both pass the same port contract without either faking a capability its engine does not have. A third mastering engine with its own shape (neither REAPER's mixer nor Audacity's macros) gets the same choice this ADR records: its own row and capability if the existing roles would have to be stretched to fit it.
- `Result.Chain` for the Audacity row is words this row supplies itself ("Import," the macro's name, "Export"), not a chain read back from the engine, because none exists to read. A narrator's report for this row is honest about that: it says what ran, not what plugins ran, unlike `daw`'s report of the project's actual FX slots.
- Two DAW capabilities (`render_with_fx`, `master_chain_read`) already appear as not-yet-available or unsupported in `DawCapabilities` and Settings' per-capability list; `macro_render` is the third, following the same pattern (Phase 8, ADR 0306).
- Superseding this — making the Audacity row answer through `render_with_fx`/`master_chain_read` after all, or dropping the per-render approval or the folder isolation — takes a new ADR.
