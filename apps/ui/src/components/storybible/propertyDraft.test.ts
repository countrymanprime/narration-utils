import { describe, expect, it } from 'vitest';
import { addDraftRow, draftFrom, moveDraftRow, propertiesFrom, propertyProblem, removeDraftRow, sameProperties, updateDraftRow } from './propertyDraft';

const PAIRS = [
  { key: 'Codename', value: 'Wren' },
  { key: 'Abilities', value: 'Flight' },
];

describe("the draft rows of an entry's properties", () => {
  it('gives every row an id of its own and keeps the order', () => {
    const rows = draftFrom(PAIRS);
    expect(rows.map((row) => row.key)).toEqual(['Codename', 'Abilities']);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('adds a blank row that never reuses the id of a row still there', () => {
    const rows = removeDraftRow(draftFrom(PAIRS), draftFrom(PAIRS)[0].id);
    const added = addDraftRow(rows);
    expect(added).toHaveLength(2);
    expect(new Set(added.map((row) => row.id)).size).toBe(2);
    expect(added[1]).toMatchObject({ key: '', value: '' });
  });

  it('edits one row without touching the others', () => {
    const rows = draftFrom(PAIRS);
    const edited = updateDraftRow(rows, rows[1].id, { value: 'Flight, sleight of hand' });
    expect(edited.map((row) => row.value)).toEqual(['Wren', 'Flight, sleight of hand']);
    expect(rows[1].value).toBe('Flight');
  });

  it('moves a row up or down and stops at the ends', () => {
    const rows = draftFrom(PAIRS);
    expect(moveDraftRow(rows, rows[1].id, -1).map((row) => row.key)).toEqual(['Abilities', 'Codename']);
    expect(moveDraftRow(rows, rows[0].id, 1).map((row) => row.key)).toEqual(['Abilities', 'Codename']);
    expect(moveDraftRow(rows, rows[0].id, -1)).toEqual(rows);
    expect(moveDraftRow(rows, rows[1].id, 1)).toEqual(rows);
  });
});

describe('what a Save sends', () => {
  it('trims the names and values and drops a row left completely blank', () => {
    const rows = [
      { id: 1, key: '  Codename ', value: ' Wren ' },
      { id: 2, key: '', value: '  ' },
      { id: 3, key: 'Eyes', value: '' },
    ];
    expect(propertiesFrom(rows)).toEqual([
      { key: 'Codename', value: 'Wren' },
      { key: 'Eyes', value: '' },
    ]);
  });

  it('names the row whose value has no name', () => {
    expect(
      propertyProblem([
        { id: 1, key: 'A', value: '1' },
        { id: 2, key: ' ', value: 'x' },
      ]),
    ).toBe('Give property 2 a name, or clear its value.');
  });

  it('names a name that is used twice, whatever its case', () => {
    expect(
      propertyProblem([
        { id: 1, key: 'Codename', value: '1' },
        { id: 2, key: 'codename ', value: '2' },
      ]),
    ).toBe('Two properties are named “codename”. Give each a different name.');
  });

  it('finds no problem in a good list, a blank row or an empty list', () => {
    expect(propertyProblem(draftFrom(PAIRS))).toBeUndefined();
    expect(propertyProblem([{ id: 1, key: '', value: '' }])).toBeUndefined();
    expect(propertyProblem([])).toBeUndefined();
  });

  it('tells a changed list from the saved one by names, values and order', () => {
    expect(sameProperties(PAIRS, [...PAIRS])).toBe(true);
    expect(sameProperties(PAIRS, [PAIRS[1], PAIRS[0]])).toBe(false);
    expect(sameProperties(PAIRS, [PAIRS[0], { key: 'Abilities', value: 'Flying' }])).toBe(false);
    expect(sameProperties(PAIRS, PAIRS.slice(0, 1))).toBe(false);
    expect(sameProperties([], [])).toBe(true);
  });
});
