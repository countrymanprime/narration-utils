# 0179. A built-in, dated ACX delivery profile ships, and a project is judged against its selected profile

- **Status:** Proposed
- **Date:** 2026-09-24
- **Related:** Supersedes [ADR-0025](0025-delivery-measurements-in-go-profiles-deferred.md) (its "no distributor profile ships" decision; the Go measurement stays), decision 5 of [ADR-0155](0155-settings-gain-a-number-kind-with-a-declared-range-and-delivery-limits-are-the-narrators-own.md) ("delivery limits are the narrator's own").

## Context and problem

The owner asked on 2026-09-24 that the Delivery page be judged against the platform the book is exported to, ACX for now, instead of "your limits" ([Delivery Platform Profiles](../prds/delivery-platform-profiles.prd.md)). ADR 0025 had deferred any distributor profile until its rules were "independently specified and validated", and ADR 0155 (decision 5) made seven number settings the only judge, with no numbers built in. Until a narrator typed ACX's numbers into Settings by hand, the page judged nothing, and ACX's non-level requirements (MP3, file length, room tone, credits, retail sample) were nowhere on it.

`measure.Profile` could hold only five level bounds, and `measure.Evaluate` raised nothing for a value that passed, so a result could not tell "met" from "not checked". The roadmap's condition for a distributor profile is kept rather than dropped: [ACX delivery requirements](../research/acx-delivery-requirements.md) records every rule with its source, what the repository read on ACX's own page and what is still to verify; ACX's help site is not reachable from agent sessions, so the owner's reading of the page and the comparison with Audacity's ACX Check are pending.

## Decision drivers

- The owner's request (2026-09-24): judge the Delivery page against the platform the book is exported to, ACX for now.
- ADR 0025's condition for a distributor profile is kept rather than dropped: every rule is recorded with its source and what is still to verify.
- A result must tell "met" from "not checked".
- ACX's non-level requirements (MP3, file length, room tone, credits, retail sample) were nowhere on the page.

## Considered options

1. A built-in, dated ACX profile of sourced rules, with a project judged against its selected profile
2. Keep the status quo: seven narrator-typed number settings as the only judge (ADR 0155, decision 5)

## Decision outcome

**Chosen option: a built-in, dated ACX profile of sourced rules, with a project judged against its selected profile**, because the owner asked that the Delivery page be judged against the platform the book is exported to, and until a narrator typed ACX's numbers by hand the page judged nothing.

1. **Profiles are rules with sources.** `apps/desktop/internal/deliveryprofile` holds a profile as `{id, version, revision, name, platform, builtIn, basedOn, rules}`. A rule has a scope (file or book), a metric, an inclusive bound (min/max, one-of, the same across files, or a bound in words), a level (required or advice), how the app checks it (`measured`, `not_yet` with why, or `listen`), its source (title, URL, the requirement, whether it is quoted, the date read) and its verification (`verified`, `to_verify`, `conflicting` with a note).
2. **ACX ships as `acx@2026-09`,** compiled in and read-only: thirteen rules (RMS, peak, noise floor, sample rate, file length, room tone at the head and tail, MP3 format, channels, one section per file, credits files, retail sample, consistency). A new reading of ACX's page is a new version, never an edit; a project keeps the version it chose (PRD P5). A conflicting rule is judged against the looser reading with the conflict shown (room tone at the head, 0.5 to 5 s); an unverified rule is judged as written with a "to verify" mark (P4). ACX's peak is the sample peak, with the true peak as advice (P8).
3. **Evaluation is rule by rule.** `EvaluateFile` answers one result per file rule, `met`, `not_met`, `not_measurable`, `not_checked` or `off`, and raises `delivery_qc` findings for a required rule not met (error), an advice rule not met or a rule's advice (warning) and a value not measurable (info). `EvaluateBook` judges the book rules over the measured files. A rule the app cannot check is listed as not checked, never counted as met.
4. **Finding IDs carry the profile id and the rule id,** not the version: `StableID("measure", file, profileId, ruleId, kind)`. Moving to a newer ACX keeps a finding's ID when the rule is unchanged. Delivery findings are not in the findings store yet (ADR 0170), so no saved review decision is lost by the change.
5. **A project is judged against its selected profile.** The project's own choice is `project.Manifest.DeliveryProfile {id, version}` (additive); without one, the Global default (the user-level `delivery-profiles.json`, ADR 0180), and without that the newest ACX (P1, P7). The host judges on every read of the measurement (`judgeMeasureJob`, ADR 0170): the job carries the profile, each file's rule results and the book results. The report (`deliveryreport`, `schema_version` 2) names the profile and version, lists every rule with its source, verification and results, and keeps "not a certification".
6. **The old limits move once, and leave Settings.** The seven `Delivery.*` keys leave `fieldSchemas` and `numberSpecs` (and the min/max pair check with them) and stay in the settings files, unread except by the move: the Global layer's set becomes the custom profile "Your limits" and the Global default, once; a project whose own settings hold limits gets "Your limits (<project>)" (or ACX, when the numbers are ACX's, or an existing moved profile with the same numbers) saved on its manifest. A moved profile keeps ACX's other rules, turns off a level rule with no old limit, drops the true-peak advice and adds a rule for an old loudness or true-peak limit, so the levels are judged exactly as before. A hand-edited value that is not a number is reported, not guessed at.
7. `measure.Profile`, `measure.Evaluate`, `ProfileFromLimits` and the limit keys are deleted; `measure.AnalyzerVersion` is 2. `hostAPIVersion` is 49 for the new bindings (48 went to #480) (`DeliveryProfiles`, `DeliverySelectProfile`, and ADR 0180's three).

### Consequences

- **Good:** A narrator delivering to ACX measures and is judged with no Settings visit, and sees what the app did not check.
- **Bad:** The profile's text is only as good as its reading of ACX's page: five rules are "to verify" and one "conflicting" until the owner reads the page and runs ACX Check (recorded in the research note and `docs/architecture/delivery-measurement-validation.md`). A new reading is a new `acx@YYYY-MM` version.
- **Neutral:** Settings > Delivery no longer has number boxes; a narrator who wants other numbers duplicates ACX (ADR 0180).
- **Neutral:** Proofing readiness (its Phase 5) and editing readiness (its Q3) should read `deliveryprofile` results rather than build their own checks.
- **Neutral:** To change any of this, write an ADR that supersedes this one.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Keep the status quo: seven narrator-typed number settings as the only judge

- Bad, because until a narrator typed ACX's numbers into Settings by hand, the page judged nothing.
- Bad, because `measure.Evaluate` raised nothing for a value that passed, so a result could not tell "met" from "not checked".
- Bad, because ACX's non-level requirements were nowhere on the page.
