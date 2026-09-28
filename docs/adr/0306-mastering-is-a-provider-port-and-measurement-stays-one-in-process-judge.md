# 0306. Mastering is a provider port, and measurement stays one in-process judge

**Status:** Proposed
**Date:** 2026-09-28
**Supersedes:** none. It applies [ADR 0301](0301-providers-sit-behind-small-ports-with-a-registry-and-a-capability-descriptor.md)'s port pattern to mastering, keeps [ADR 0321](0321-the-mastering-chain-is-a-fixed-high-pass-limiter-and-gain-that-masters-to-the-profiles-own-measured-rms-and-sample-peak.md)'s chain as it is, and narrows one rule of the REAPER bridge (below).

## Context

The render-encode-master PRD built one mastering chain, `apps/desktop/internal/mastering` ([ADR 0321](0321-the-mastering-chain-is-a-fixed-high-pass-limiter-and-gain-that-masters-to-the-profiles-own-measured-rms-and-sample-peak.md)): a fixed high-pass EQ, a limiter and gain into the delivery profile's RMS window, re-measured with `internal/measure` and judged with `internal/deliveryprofile`. Its Q3 took the built-in chain for v1 and left "a REAPER-FX-chain alternative" as a Could, gated on the DAW port's `fx_chains` capability reaching Supported.

On 2026-09-28 the owner decided (D86 on [#509](https://github.com/countrymanprime/narration-utils/issues/509)) that mastering must be swappable like the other providers: REAPER and Audacity may master with their own FX, while the metrics stay the app's own, `internal/measure` plus `internal/deliveryprofile` judging whatever file any mastering chain produces.

Three facts shape the design:

- [Provider ports](../architecture/provider-ports.md) chose not to make measurement a port: one implementation needs no registry. That still holds, and D86 keeps it.
- The DAW port has `fx_chains` (`FXManager`: list, apply and add FX, Experimental) and `render_config` (`RenderConfigurer`: set up REAPER's render for chapter files, Supported), but no role renders. `integrations/reaper/narration_render.lua` configures a render and deliberately never triggers one; the narrator renders from REAPER's own dialog.
- Audacity 3.x can apply effect macros and export through mod-script-pipe (`Export2`), and its pipe client is being built (N-B36, [#834](https://github.com/countrymanprime/narration-utils/pull/834), [#838](https://github.com/countrymanprime/narration-utils/pull/838)).

## Decision

**Mastering is a provider port, `apps/desktop/internal/masteringport`.**

- `Mastering` is `Name()`, `Capabilities()` and `Master(ctx, Request) (Result, error)`. A `Request` names the input (a WAV `Source`, or a DAW `Region`), a new `Destination`, the delivery `Profile`, the narrator's `Approved` for this run, and optional progress. A `Result` says which row ran, the chain it ran (steps in words, for the narrator's report), and `Before`, `After` and `Judgement`.
- The registry is `masteringport.Rows`, a `port.Registry[Mastering]`, keyed by the name a project's choice stores. A row's descriptor `Modes` say what it masters from: `wav` (a rendered WAV) or `daw_region` (the DAW renders a region itself). Its `Capabilities` declare its `Level` (NotYetAvailable, Experimental or Supported), whether each master `NeedsApproval`, and the DAW port capabilities it `Needs`.
- The conformance suite, `masteringporttest.Run`, runs over every registered row from the registry's own test, so no row skips it. It checks the descriptor and capabilities, that a NotYetAvailable row refuses with a `not_yet` refusal, and that a built row writes only a new file, never over its source or an existing file, leaves nothing after a failure or a cancel, refuses without approval when it needs it, and answers exactly the one judge's verdict on the file it wrote. A row that makes the DAW render and does not need approval fails it. `masteringporttest.Fake` is the mock row (D67): it copies the WAV and passes the suite.

**The rows.**

- **`builtin`**, the default: today's `internal/mastering.Master`, wrapped unchanged. Its code, tests and ADR 0321 do not change; `masteringport.ErrDestinationExists` and `ErrSameFile` are `mastering`'s own errors.
- **`daw`**, declared and not yet available (`port.NotYetAvailable`): it renders one region through the project's own track and master FX. When its phase builds it, `Master` resolves the launch's DAW through the DAW port resolver and asks for a new role, `render_with_fx` (`dawport.FXRenderer`, `RenderWithFX(runID, FXRender)`, answered through `Events`), to render the named region into an empty folder the host made for the run inside the app's project folder. It moves the rendered file to the destination as the built-in chain does, then measures it with `internal/measure` and judges it with `internal/deliveryprofile`. A second new role, `master_chain_read` (`dawport.MasterChainReader`, `ReadMasterChain`), lists every track's FX and the master track's, so the UI can show the narrator what will run before they approve it. Both capabilities are declared in `internal/dawport` now, NotYetAvailable for REAPER (and, like every capability, for Audacity until its pipe client implements them); the REAPER phase adds the Lua commands with their harness tests and moves them to Experimental.
- **`audacity`**, planned and not registered: once the Audacity 3.x pipe client lands, it applies the narrator's effect macro to the chapter's audio, exports with `Export2` to a folder the host chose, and is judged the same way. Whether it stays its own row or becomes the `daw` row served by the Audacity adapter's `render_with_fx` is decided in that phase, by how close the macro-and-export flow comes to the role.

**A render is a new trust-boundary action, and it is allowed on four conditions.** Until now the app configured REAPER's render and never triggered one. The `daw` row changes that, and only this way: each render needs the narrator's explicit approval in the UI for that one render (`Request.Approved`, carried to the engine as `FXRender.Approval`, never stored or remembered between runs); it runs only from the narrator's action; it is Experimental until the owner's REAPER pass; and it writes only into an empty folder the host created inside the project, never over a file. [Threat model](../architecture/threat-model.md) row 5o and `SECURITY.md` record it before anything sends it.

**Measurement stays one in-process judge, not a port.** Every row's `After` and `Judgement` are `masteringport.Judge`'s answer on the file it wrote: `internal/measure` reads it and `internal/deliveryprofile.EvaluateFile` judges it, the same code the Delivery page, the proofing checks and the Master & QC flow already use. A row never reports levels of its own, not even a DAW's loudness meter. So a narrator reads one set of numbers whichever chain made the file, a file mastered in REAPER and one mastered by the built-in chain are compared by the same ruler, and a profile's verdict cannot change with the chain that produced the file.

**A project chooses its row.** The choice is the project settings row `Mastering.provider`, written only by `MasteringChooseProvider(name)`, which refuses an unknown row or one that is not available yet with its sentence and clears the choice on an empty name. `MasteringProviders()` answers every row (label, whether it is the default, modes, whether it needs approval, the DAW capabilities it needs, and its `support` in the DAW port's shape), the project's stored choice, the row it masters with, and a notice when a stored choice cannot run. The row is not a generic Settings field. Both bindings carry a Zod schema, three goldens, a `wireContracts.test.ts` row and a mock ([wire contracts](../architecture/wire-contracts.md)); host API 77. No screen reads them yet: Master & QC (stage navigation Phase 8) will.

## Consequences

- A second chain is one registry row that passes the suite; callers ask the registry and never compare names (the provider guard now covers the mastering rows).
- The one-judge rule is tested, not only written down: the suite fails a row whose `After` or `Judgement` differs from `Judge` on its own file.
- The built-in chain's behaviour is proved unchanged: the port's test masters one source through the row and through `mastering.Master` and compares the bytes.
- The REAPER bridge gains its first render when the `daw` row is built. That phase must add the Lua commands with harness tests and mutation checks, keep the four conditions above, and have the owner check REAPER's own render behaviour (sample rate, bounds, tails) in REAPER, since the harness cannot. It depends on `fx_chains` reaching Supported through the booth-actions pass.
- Two DAW capabilities appear in Settings' per-capability list and in `DawCapabilities` as not yet available.
- The approval is enforced by the host. A forged bridge command skips it, as it skips every host check (row 5a); that residual risk is accepted with #240.
- Superseding any of this (making measurement a port, letting a row report its own levels, or rendering without per-render approval) takes a new ADR.
