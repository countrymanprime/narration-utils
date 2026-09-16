# Workflow: Recording, Pickups, and Comping

## Goal

Turn retakes and repeated reads into organized comparison candidates without making automatic editorial decisions.

## Flow

1. Record normal narration and pickups as REAPER takes in the intended timeline item.
2. Run pickup/duplicate detection over the selected chapter or explicit item range.
3. Review each candidate with its matched manuscript span, timestamps, transcript evidence, and similarity evidence.
4. On approval, create or attach a candidate as a take in the requested target item; preserve all source audio and retain an undoable action.
5. Use Take Intelligence for A/B looping and ranking evidence; choose the active take manually.

## Safeguards

- Do not treat repeated prose, echoed dialogue, or deliberate rehearsal as duplicates without a confidence threshold and context.
- Never insert, move, delete, or activate a take automatically.
- Do not compare takes with mismatched manuscript spans as though they were alternatives.

## Success signals

- A likely pickup is found faster than manually hunting through a session.
- A narrator can audition alternatives in context and explain why one was selected.
