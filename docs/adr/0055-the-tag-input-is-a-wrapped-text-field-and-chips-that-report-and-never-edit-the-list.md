# 0055. The tag input is a wrapped text field and chips that report and never edit the list

- **Status:** Accepted
- **Date:** 2026-09-20

## Context and problem

The Proofing setup page keeps a list of vocabulary hints (unusual names Whisper is likely to mis-hear) as chips in a box, with suggested ones as dashed chips, a text box to add one, and buttons beside it. It was written inline in `Transcript.tsx` with a bare `<input>`, a remove cross with no label of its own beyond `aria-label`, and no group name; the focus was lost when a cross was pressed and its chip disappeared. The vocabulary-hints PRD's phase 2 ("the tag-input box") builds on this, and the owner asked for `TagInput` to be added ([ADR 0053](0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md) has the `TextField` it uses). Base UI's Combobox with chips was the other candidate.

## Decision drivers

- The hints are free text, not a choice from a fixed list.
- The typing box needs no popup, filtering or active index.
- Domain matching around a combobox is where regressions live.
- An accidental keypress must not delete data that is saved for the project.

## Considered options

1. A wrapped `TextField` plus chips that report and never edit the list
2. Base UI's Combobox with chips
3. Backspace on an empty box removes the last chip

## Decision outcome

**Chosen option: a wrapped `TextField` plus chips that report and never edit the list**, because the hints are free text rather than a choice from a fixed list, which is what Combobox chips model.

`TagInput` is a wrapped `TextField` plus chips, not a Base UI Combobox. The hints are free text (a name the user types or accepts), not a choice from a fixed list, which is what Combobox chips model; the typing box needs no popup, filtering or active index, and the alias combobox already showed that domain matching around a combobox is where regressions live ([ADR 0052](0052-toggle-menu-checkbox-collapsible-and-switch-replace-the-hand-rolled-widgets.md)).

- One `role="group"` named by `label` holds the chip box, the typing box and the Add button, and an `actions` slot for other buttons beside Add (the page's "Suggest from manuscript"). The chip box shows `tags` as chips with a `Remove <tag>` cross, `suggestions` as dashed chips that a press accepts (with a hint), and `emptyText` while there is neither.
- It owns the draft text only. It reports `onAdd(text)` (Enter or Add; a blank draft reports nothing and is cleared), `onRemove(tag)` and `onAcceptSuggestion(term)` and never edits the lists, so the caller keeps the meaning of a term: the vocabulary hints split a pasted list on commas, compare without case and save through the host.
- After a chip is removed the cursor returns to the typing box, because the cross that had focus is gone. Nothing in it submits an enclosing form.
- Backspace on an empty box does not remove the last chip: an accidental keypress would delete data that is saved for the project, and the cross is a clear control.

### Consequences

- **Neutral:** The vocabulary hints keep their layout and gain a group name, a named typing box, a screen-reader note that a chip is only suggested (`aria-description`), and focus that does not fall to the page. Two texts are darker: the suggested chips and the "No hints yet" line now use `--text`, because on the box's `--surface-2` background `--text-muted` reached 4.31:1 and `--text-faint` 2.5:1 and the atlas's axe check failed the new stories (the debt list is at its cap and may only shrink). Nine of 282 captures differ, all in the Proofing setup box (the empty line and the dashed chips); the palette stack may refine the colours.
- **Neutral:** Enter that ends an input-method composition does not add a term.
- **Neutral:** A second use (a term list elsewhere) has the component; a use that needs a fixed list of choices does not, and would be a Combobox wrap decided then.
- **Neutral:** To change any of this (Backspace removal, a Combobox), write a new ADR that supersedes this one.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Base UI's Combobox with chips

- Bad, because Combobox chips model a choice from a fixed list, and the hints are free text.
- Bad, because the typing box needs no popup, filtering or active index, and domain matching around a combobox is where regressions live.

### Backspace on an empty box removes the last chip

- Bad, because an accidental keypress would delete data that is saved for the project.
