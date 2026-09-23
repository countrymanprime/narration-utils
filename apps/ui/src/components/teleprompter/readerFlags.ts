import type { ReaderMark, ReaderRow } from './readerModel';
import type { TeleprompterFlag, TeleprompterFlagKind, TeleprompterFlagSave } from '../../types';

/**
 * The read-aloud dialog's suspected flags (teleprompter-manuscript-integration.prd.md Phase 7), layered on the reader model:
 * a flag arrives in chapter word indices (ADR 0115) and becomes a `ReaderMark` on the rows it falls in, the same path the
 * story bible and note marks take (ADR 0116), and a `TeleprompterFlagSave` naming its paragraph words when it is kept as a
 * finding (ADR 0117). Every flag is only suspected; Transcript Compare over the recorded take is authoritative.
 */

export type FlagVisibility = Record<TeleprompterFlagKind, boolean>;

/** The order the kinds are listed in the rail and the key: the ones shown by default first. */
export const FLAG_KINDS: TeleprompterFlagKind[] = ['skipped', 'restart', 'misread', 'extra'];

/**
 * Owner decision 2026-09-23, after Phase 6 measured misread at 2.07 false flags per 100 words on synthetic speech (target at
 * most 1): skipped and restart show by default; misread and extra wait behind a toggle until their rate meets the target.
 */
export const DEFAULT_FLAG_VISIBILITY: FlagVisibility = { skipped: true, restart: true, misread: false, extra: false };

export const FLAG_NAMES: Record<TeleprompterFlagKind, string> = {
  misread: 'Suspected misread',
  extra: 'Suspected extra words',
  skipped: 'Suspected skipped words',
  restart: 'Suspected restart',
};

/** The flags to draw: kinds the narrator shows, less the ones dismissed. Keeps the list's order. */
export function visibleFlags(flags: TeleprompterFlag[], visibility: FlagVisibility, dismissed: ReadonlySet<number>): TeleprompterFlag[] {
  return flags.filter((flag) => visibility[flag.kind] && !dismissed.has(flag.id));
}

/** The hint on a flag mark: what kind of flag, that it is suspected, and what was heard. */
export function flagHint(flag: TeleprompterFlag): string {
  const heard = flag.heard ? ` Heard “${flag.heard}”.` : '';
  switch (flag.kind) {
    case 'misread':
      return `Suspected misread.${heard}`;
    case 'extra':
      return `Suspected extra words before this word.${heard}`;
    case 'skipped':
      return 'Suspected skipped words. Nothing was heard for them.';
    case 'restart':
      return `Suspected restart: read again from here.${heard}`;
  }
}

const tracked = (row: ReaderRow): row is ReaderRow & { words: string[] } => row.words !== null;

/**
 * The chapter words a flag marks, [from, to): its own words, or for an extra (zero-width) the one word it was heard before, or
 * the chapter's last word when it was heard after the end.
 */
function markedWords(flag: TeleprompterFlag, rows: ReaderRow[]): [number, number] {
  if (flag.kind !== 'extra') return [flag.start, flag.end];
  const inText = rows.some((row) => tracked(row) && flag.start >= row.start && flag.start < row.start + row.words.length);
  return inText ? [flag.start, flag.start + 1] : [flag.start - 1, flag.start];
}

type RowPart = { row: ReaderRow & { words: string[] }; from: number; to: number };

/** The rows the words [from, to) fall in, numbered in each row's own words. Rows the tracker does not follow are left out. */
function rowParts([from, to]: [number, number], rows: ReaderRow[]): RowPart[] {
  return rows.flatMap((row): RowPart[] => {
    if (!tracked(row)) return [];
    const start = Math.max(from, row.start);
    const end = Math.min(to, row.start + row.words.length);
    return start < end ? [{ row, from: start - row.start, to: end - row.start }] : [];
  });
}

/**
 * Flag marks by row key, in the shape `readerMarks` gives the story bible and note marks. A row with no flag has no entry. A
 * restart is marked on the word the narrator went back to only: a re-read can run a sentence or two, and a mark is one control
 * that never seeks (ADR 0116), so marking all of it would take "Go back to here" away from every word it covers.
 */
export function flagMarks(rows: ReaderRow[], flags: TeleprompterFlag[]): Map<string, ReaderMark[]> {
  const byRow = new Map<string, ReaderMark[]>();
  for (const flag of flags)
    for (const { row, from, to } of rowParts(flag.kind === 'restart' ? [flag.start, flag.start + 1] : markedWords(flag, rows), rows))
      byRow.set(row.key, [...(byRow.get(row.key) ?? []), { id: `flag-${flag.id}`, from, to, value: { kind: 'flag', flag } }]);
  return byRow;
}

/** The script words a flag is about, as the reader shows them: the words misread, skipped or read again, or the word an extra came before. */
export function flagText(rows: ReaderRow[], flag: TeleprompterFlag): string {
  return rowParts(markedWords(flag, rows), rows)
    .map(({ row, from, to }) => row.words.slice(from, to).join(' '))
    .join(' ');
}

/**
 * `extra`'s marks added to `base`'s, row by row, in reading order. A row `extra` does not touch keeps its array, and an empty
 * `extra` returns `base` itself, so the reader's memoized rows re-render only where a flag landed.
 */
export function withMarks(base: Map<string, ReaderMark[]>, extra: Map<string, ReaderMark[]>): Map<string, ReaderMark[]> {
  if (extra.size === 0) return base;
  const merged = new Map(base);
  for (const [key, marks] of extra)
    merged.set(
      key,
      [...(base.get(key) ?? []), ...marks].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id)),
    );
  return merged;
}

/**
 * The flags to keep as findings (`TeleprompterSaveFlags`), each named by paragraph and that paragraph's words, with the
 * event's own indices as evidence and whether the narrator dismissed it. A flag across two paragraphs is one save per
 * paragraph; one on the title (not a manuscript paragraph) or in a row the tracker does not follow is not kept. `flagIds`
 * says which flag each save came from, so the answer (one finding per save) can be read back onto the flags.
 */
export function flagSaves(rows: ReaderRow[], flags: TeleprompterFlag[], dismissed: ReadonlySet<number>): { saves: TeleprompterFlagSave[]; flagIds: number[] } {
  const saves: TeleprompterFlagSave[] = [];
  const flagIds: number[] = [];
  for (const flag of flags)
    for (const { row, from, to } of rowParts(markedWords(flag, rows), rows)) {
      if (row.kind !== 'paragraph') continue;
      saves.push({
        kind: flag.kind,
        paragraphId: row.key,
        wordStart: from,
        wordEnd: to,
        scriptStart: flag.start,
        scriptEnd: flag.end,
        heard: flag.heard,
        dismissed: dismissed.has(flag.id),
      });
      flagIds.push(flag.id);
    }
  return { saves, flagIds };
}
