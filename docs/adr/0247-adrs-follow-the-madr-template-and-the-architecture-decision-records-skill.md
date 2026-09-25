# 0247. ADRs follow the MADR template and the architecture-decision-records skill

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** the owner

## Context and problem

Until now the decision log used a lightweight Nygard-style format: Status, Date, Context, Decision and Consequences. `docs/adr/README.md` chose it deliberately over [MADR](https://adr.github.io/madr/), on the grounds that the extra sections are overhead for one maintainer and the alternatives can be named in Context. ADRs were written with an `adr-author` skill that lived only in local `.claude/skills/` folders. `.gitignore` kept every skill out of the repository, so a cloud session or a new machine did not have it.

The owner now uses one repo-agnostic ADR skill, `architecture-decision-records`, across repositories. It writes MADR-based records: explicit decision drivers, considered options, a Confirmation section saying how compliance is checked, and pros and cons. The owner asked to adopt it here, to track it in the repository, and to authorize a one-time evaluation of the 184 existing ADRs (0001 to 0245). Records that do not meet the skill's recording requirements are deprecated. Every record is converted to the new template for consistency.

For the evaluation, the owner chose to keep every record that captures a real, applied choice whose reason is not obvious from the code, including small UI choices. Protecting those from silent agent reverts is why this log exists. Only records that capture no decision are deprecated: bug-fix or incident notes, status reports, restatements of code, and unbuilt proposals nobody is pursuing.

## Decision drivers

- One ADR workflow across the owner's repositories.
- The skill that writes ADRs must travel with the repository, so every session, local or cloud, has it.
- Each record should state the options weighed and how the decision is checked, so a later agent can verify a decision before changing it.
- One consistent format across the whole log.

## Considered options

1. Adopt the `architecture-decision-records` skill and its MADR-based template, and convert the existing log once
2. Keep the status quo: the local `adr-author` skill and the Nygard-style format
3. Adopt the skill for new ADRs only, and leave the existing records in the old format

## Decision outcome

**Chosen option: adopt the skill and its MADR-based template, and convert the existing log once**, because it gives one tracked workflow that every session has and one consistent format, while the verbatim conversion leaves every recorded decision unchanged.

1. ADRs are written with the `architecture-decision-records` skill, tracked at `.claude/skills/architecture-decision-records/`. `.gitignore` tracks that folder and keeps every other skill local. It replaces `adr-author`. `CLAUDE.md`, `docs/operations/github-workflow.md` and the PRDs now name it.
2. The log stays in `docs/adr/`, with four-digit numbers and `NNNN-short-title.md` files. [`template.md`](template.md) is the MADR-based template:
   - a metadata list: Status, Date, and Deciders and Related when recorded;
   - Context and problem, Decision drivers, Considered options;
   - Decision outcome, with Consequences (Good, Bad, Neutral) and Confirmation;
   - optionally, Pros and cons of the options, and More information.
3. A status line holds one value: Proposed, Accepted, Rejected, Deprecated, or Superseded by a linked ADR. Partial supersessions and amendments go on the Related line.
4. The rules in `docs/adr/README.md` are unchanged: records are immutable once accepted, superseded rather than deleted, cover one decision each, and are concrete.
5. The one-time conversion on 2026-09-25 is the only authorized edit of accepted records' bodies. It works as follows:
   - Context, Decision and Consequences text is kept verbatim. Consequences bullets gain only a Good, Bad or Neutral label.
   - Drivers, options, the "because" clause, Confirmation, and pros and cons come only from each record's own text. When a record did not capture one, the section says "Not recorded when this decision was made."
   - Parentheticals on old status lines moved to the Related line, the Deciders line, or More information.
   - Every record was checked by a script: it confirms the verbatim text against `origin/main`, the template headings and order, the status vocabulary, and that ADR links resolve.
6. The evaluation deprecated no records. Every one of the 184 records captures a real choice, and each is cited by code, tests, docs or another ADR.
   - 61 records have status Proposed and are already built on main. They stay Proposed, because only the owner accepts a record.
   - ADR 0201 is Proposed and not built. It is kept because ADR 0200 and two PRDs cite it.

### Consequences

- **Good:** Every record has the same sections, so drivers, options and the compliance check are in a predictable place.
- **Good:** The skill is versioned with the repository and reaches cloud sessions and other machines.
- **Bad:** Converted records carry "Not recorded when this decision was made." wherever the original did not capture drivers, options or a check.
- **Bad:** New records cost more to write than the Nygard format. The README's earlier reason for avoiding MADR, overhead for one maintainer, is accepted as a cost.
- **Bad:** Open pull requests that add ADRs in the old format, or add rows to the index, need to be updated or merged against the converted log.
- **Neutral:** The skill defaults to `docs/decisions/` for a new log, but it follows an existing log, so `docs/adr/` stays.

### Confirmation

The skill's review checklist, applied when a new ADR is reviewed. The conversion was checked by a script that verifies each record against its `origin/main` original.

## Pros and cons of the options

### Keep the status quo

- Good, because no files change.
- Bad, because the skill that writes ADRs is not in the repository, so cloud sessions and new machines lack it.

### New ADRs only

- Good, because no existing record is touched.
- Bad, because the log would mix two formats indefinitely.

## More information

- The records that are Proposed and already built await the owner's acceptance. `docs/adr/README.md` lists every record's status.
