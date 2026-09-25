# 0155. Settings gain a number kind with a declared range, and delivery limits are the narrator's own

- **Status:** Proposed
- **Date:** 2026-09-23
- **Related:** Decision 5 superseded by [ADR-0179](0179-a-built-in-dated-acx-delivery-profile-ships-and-a-project-is-judged-against-its-selected-profile.md).

## Context and problem

The layered settings store (`apps/desktop/app.go` `fieldSchemas`, `saveSettings`) validated only the `text`, `choice`,
`color` and `bool` kinds. Two features need numbers a narrator can type: the delivery limits of
[the diagnostics PRD](../prds/diagnostics-delivery-and-cleanup-tools.prd.md) Phase 2, and the four threshold settings of
[the recording check](../utilities/recording-coverage.md) (recording-coverage analysis Phase 7) ("DX-2's numeric kind"). The diagnostics
PRD's Open Questions 1 and 9 are unanswered by the owner; per rule D22 of `docs/prds/implementation-plan.md` this change
takes their recommendations: limits only, no built-in numeric preset (Q1 A, as ADR 0025 already requires), stored as a
`Delivery` section of the layered settings, one limit set per layer (Q9 a).

## Decision drivers

- Two features need numbers a narrator can type: the diagnostics PRD's delivery limits and the recording check's four thresholds.
- Rule D22 takes the PRD's recommendations for the unanswered Open Questions 1 and 9: limits only, no built-in numeric preset (Q1 A, as ADR 0025 already requires), a `Delivery` section of the layered settings, one limit set per layer (Q9 a).
- The new kind should not rewrite every existing positional field literal.

## Considered options

1. A `number` kind with its range declared beside `fieldSchemas`, and one set of delivery limits per layer
2. The range kept inside `fieldSchema`
3. A built-in numeric preset (Q1)
4. Named, switchable limit sets (Q9 b)

## Decision outcome

**Chosen option: a `number` kind with its range declared beside `fieldSchemas`, and one set of delivery limits per layer**, because rule D22 takes the PRD's recommendations (limits only, no built-in preset, one limit set per layer), and a range beside `fieldSchemas` leaves every existing positional field literal alone.

1. **A `number` kind.** A number setting is stored, like every setting, as text: a plain decimal (`-3`, `0.5`; no
   exponent, sign `+`, spaces, unit, NaN or Inf). Its range is declared in `numberSpecs` (`apps/desktop/settings_number.go`),
   keyed by tool and key: an inclusive `min` and `max`, a `step` counted from `min` (or zero), and a `unit`, any of them
   optional. `saveSettings` rejects a value that is not a plain number, is out of range or is off step, and a number field
   with no declared range fails closed. The range is kept beside `fieldSchemas`, not inside `fieldSchema`, so the kind did
   not rewrite every existing positional field literal; a test keeps the two maps in step.
2. **Clearing a number saves `null`**, never `""`: a project override is removed and a global value reset, so an emptied
   box means "not set" in every layer. The Settings page shows a number box with only its own scope's value (so it can be
   emptied) and what it inherits as the placeholder, with its unit beside it and its range, or what is wrong, below it.
3. **Paired fields.** `numberPairs` names a tool's lowest and highest keys of one quantity; a save is refused when the
   effective lowest would be above the effective highest across all layers once the save lands.
4. **The wire contract.** A `number` field carries a `number: {min, max, step, unit}` object and no other kind does
   (`apps/ui/src/api/schemas/settings.ts`). A new kind the older page cannot render is a contract change: `hostAPIVersion`
   is 29.
5. **Delivery limits.** The `Delivery` section holds seven limits, the bounds that mean something: integrated loudness
   and RMS level lowest and highest, sample peak, true peak and noise floor highest. `config/defaults.json` has an empty
   `Delivery` section. `measure.ProfileFromLimits` builds a `measure.Profile` from the effective values: a blank key is no
   limit, an empty section is a profile with no limits (so `Evaluate` raises nothing), and a non-finite value or a minimum
   above its maximum is an error. `Profile` gains a `SamplePeakdBFS` limit. The ranges keep a typo out; they are not advice.

### Consequences

- **Good:** Any feature can add a numeric setting by adding a `number` field to `fieldSchemas` and its range to `numberSpecs`, with
  validation, the page's rendering and the wire check already in place.
- **Neutral:** The diagnostics and cleanup analyzer thresholds the PRD lists (clipping ceiling, long-pause length, level-shift step,
  silence floor, minimum silence and breath length, pad/hold time) are added with the analyzers that read them (Phases 4
  and 9), not ahead of them, so no setting exists that changes nothing.
- **Bad:** Named, switchable limit sets (Q9 b) are not possible: one set per layer. Revisit only if narrators need several per book.
- **Neutral:** Owner review: this ADR is Proposed because it records D22 defaults for questions the owner has not answered.

### Confirmation

A test keeps `numberSpecs` and `fieldSchemas` in step.

## Pros and cons of the options

### The range kept inside `fieldSchema`

- Bad, because the kind would rewrite every existing positional field literal.

### A built-in numeric preset (Q1)

- Bad, because ADR 0025 already requires none.
