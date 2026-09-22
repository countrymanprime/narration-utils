import type { GuideProperty } from '../../types';

// The rows of the properties table while an entry is being edited. A row has an id of its own, because its name is the thing the
// narrator is typing into: keying a row by its name would remount its field on every keystroke and drop the caret.
export type DraftProperty = { id: number; key: string; value: string };

export const draftFrom = (properties: GuideProperty[]): DraftProperty[] => properties.map((property, index) => ({ id: index, ...property }));

export function addDraftRow(rows: DraftProperty[]): DraftProperty[] {
  const id = rows.reduce((highest, row) => Math.max(highest, row.id), -1) + 1;
  return [...rows, { id, key: '', value: '' }];
}

export const removeDraftRow = (rows: DraftProperty[], id: number): DraftProperty[] => rows.filter((row) => row.id !== id);

export const updateDraftRow = (rows: DraftProperty[], id: number, change: Partial<Pick<DraftProperty, 'key' | 'value'>>): DraftProperty[] =>
  rows.map((row) => (row.id === id ? { ...row, ...change } : row));

/** Moves a row one place up (-1) or down (1). A row already at that end stays where it is. */
export function moveDraftRow(rows: DraftProperty[], id: number, direction: -1 | 1): DraftProperty[] {
  const from = rows.findIndex((row) => row.id === id);
  const to = from + direction;
  if (from === -1 || to < 0 || to >= rows.length) return rows;
  const moved = [...rows];
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return moved;
}

/** What a Save sends: names and values trimmed, and a row left completely blank dropped (the narrator added it and changed their mind). */
export const propertiesFrom = (rows: DraftProperty[]): GuideProperty[] =>
  rows.map((row) => ({ key: row.key.trim(), value: row.value.trim() })).filter((row) => row.key !== '' || row.value !== '');

/** The first thing wrong with the rows, in words the narrator can act on, or nothing. The sidecar refuses the same two cases. */
export function propertyProblem(rows: DraftProperty[]): string | undefined {
  const seen = new Set<string>();
  const kept = rows.filter((row) => row.key.trim() !== '' || row.value.trim() !== '');
  for (const [index, row] of kept.entries()) {
    const key = row.key.trim();
    if (key === '') return `Give property ${index + 1} a name, or clear its value.`;
    if (seen.has(key.toLowerCase())) return `Two properties are named “${key}”. Give each a different name.`;
    seen.add(key.toLowerCase());
  }
  return undefined;
}

export const sameProperties = (left: GuideProperty[], right: GuideProperty[]): boolean =>
  left.length === right.length && left.every((property, index) => property.key === right[index].key && property.value === right[index].value);
