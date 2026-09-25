---
name: architecture-decision-records
description: Record, supersede, and index Architecture Decision Records (ADRs) in MADR format, keeping the log append-only. Use when a significant or hard-to-reverse technical decision is made or proposed (choosing a framework, database, messaging style, API or versioning strategy, project structure, cross-cutting convention, or a major dependency), when asked to "write an ADR" or "record this decision", when a change reverses an earlier decision, or when setting up a decision log in a repo.
---

# Architecture Decision Records

An ADR records **one** decision: the context that forced it, the options considered, the choice
made, and its consequences. The ADR log is **append-only**. Once a record is accepted, you never
rewrite it; you supersede it with a new one. That is what keeps ADRs trustworthy while code keeps
changing.

Templates:

- [templates/adr-template.md](templates/adr-template.md): the MADR-based record.
- [templates/decisions-readme.md](templates/decisions-readme.md): the index for a new decision log.

## When to write one

Write an ADR when the decision meets **any** of these:

- It is hard or expensive to reverse: storage, a framework, a public API shape, a protocol.
- It affects several components, or everyone working in the repo, e.g. a convention or layering rule.
- There were at least two viable options and the reasons for the choice aren't obvious from the code.
- It adds a major dependency or platform, or removes one.
- It deliberately deviates from a common default or an earlier ADR.

Don't write one for local, easily reversed choices, for style preferences already covered by
tooling, or for things the code states plainly.

If you notice such a decision being made in conversation or in a diff, and there's no ADR for it,
**offer** to write one. Don't silently skip it.

## Step 1: Find the existing log and match it

Look for an existing log: `docs/decisions/`, `docs/adr/`, `docs/architecture/decisions/`,
`doc/adr/`, `adr/`. You can also search: `git grep -l -i "## Decision" -- '*.md'`.

- **If one exists,** use its folder, file naming, numbering width, template, and status vocabulary,
  even if they differ from this skill's.
- **If none exists,** confirm with the user first; starting a decision log is itself a decision.
  Then create `docs/decisions/` (MADR's default location) containing:
  - `README.md`, from `templates/decisions-readme.md`
  - `0001-record-architecture-decisions.md`: the first record, which adopts ADRs and MADR

  Link the log from the repo's docs index or README.

## Step 2: Write the record

1. **Number it:** the next number after the highest existing one, zero-padded to 4 digits. Never
   reuse a number, even one belonging to a deleted draft.
2. **Filename:** `NNNN-short-imperative-title.md`, e.g. `0007-use-outbox-for-integration-events.md`.
3. **Title:** a short present-tense statement of the decision: "Use the outbox pattern for integration events".
4. **Fill in the template** (`templates/adr-template.md`):
   - **Context and problem**: the forces at play. These can be technical, business, team or
     time. Give facts and links (issues, benchmarks, docs), not opinions.
   - **Decision drivers**: the criteria used to choose between options.
   - **Considered options**: at least two real ones, plus "keep the status quo" when that is
     viable. Give each an honest list of pros and cons.
   - **Decision outcome**: the chosen option, and **why**, tied back to the drivers.
   - **Consequences**: good, bad and neutral. Include what gets harder and what follow-up work it creates.
   - **Confirmation**: how compliance will be checked. Examples: an analyzer rule, an
     architecture test (e.g. NetArchTest), a CI check, or code review.
5. **Status:**
   - `Proposed` while it's under discussion, e.g. in a PR.
   - `Accepted` once the decision is agreed, usually when the PR merges.
   - Other values: `Rejected`, `Deprecated`, `Superseded by [ADR-NNNN](NNNN-….md)`.
   - Whenever the status changes, update the `Date` field to match.
6. **Keep it short:** one to two pages. Link to the details; don't paste them in.
7. **Update the index** in the log's `README.md`.

**Don't invent context.** If the conversation, PR, or code doesn't show why an option was
chosen, ask the user, or mark the gap with `> TODO(owner): …`. Don't record a plausible-sounding
rationale that nobody actually gave.

**Retroactive ADRs** for decisions already in the code are useful. Mark them as
"Recorded retroactively on YYYY-MM-DD", and use the original decision date if it's known.

## Step 3: Superseding or deprecating

When a new decision replaces an old one:

1. Write the new ADR as normal. In its context section, link the one it replaces:
   `Supersedes [ADR-0003](0003-….md)`.
2. In the **old** ADR, change **only** the status line to
   `Superseded by [ADR-0012](0012-….md)`, and the `Date` line to today. Leave the rest of the
   old record unchanged.
3. Update both entries in the index.

For a decision that simply no longer applies, with no replacement, set the status to
`Deprecated` and add a one-line reason.

**Edits allowed on an accepted ADR:** status changes, fixed broken links, and typos. Anything
that changes meaning needs a new ADR.

## Step 4: Connect it to the code

- Where code looks surprising *because of* the decision, add a short pointer comment:
  `// Integration events go through the outbox; see docs/decisions/0007-use-outbox-for-integration-events.md.`
- If the decision changes architecture, update the affected diagrams in the same change,
  using the `mermaid-diagrams` skill.
- Add the ADR link to the PR description.

## Review checklist

- [ ] It records one decision, and the title states it.
- [ ] Context is factual and links its sources.
- [ ] It has at least two real options with honest trade-offs.
- [ ] The outcome explains *why*, in terms of the drivers.
- [ ] Negative consequences are listed.
- [ ] It says how compliance is confirmed.
- [ ] The number is unique, the index is updated, and superseded records have their status line updated.
