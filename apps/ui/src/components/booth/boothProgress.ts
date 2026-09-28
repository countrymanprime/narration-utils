import { estimateFinishedHours } from '../../state';
import { splitWords, type ReaderMark, type ReaderRow } from './readerModel';
import type { GuideEntity, GuidePronunciation } from '../../types';

/**
 * The Booth status line's progress (mock 03, audit BO5): "¶ 38 of 71 · 41% · ~8:10 finished left". The paragraph is the
 * one the current word sits in, counted over the chapter's paragraph rows only (the title is not a paragraph); the share
 * is of the words; the time left is the words still to read at the app's one finished-audio pace (`estimateFinishedHours`,
 * the Home estimate's ~155 words a minute), so it is an estimate of finished audio, not of the narrator's own speed.
 */
export type BoothProgress = { paragraph: number; paragraphs: number; percent: number; secondsLeft: number };

export function boothProgress(rows: ReaderRow[], cursor: number, tokens: number): BoothProgress | undefined {
  const paragraphs = rows.filter((row) => row.kind === 'paragraph');
  if (paragraphs.length === 0 || tokens <= 0) return undefined;
  const read = Math.min(Math.max(cursor, 0), tokens);
  const current = paragraphs.reduce((index, row, at) => (row.start <= read ? at : index), 0);
  return {
    paragraph: current + 1,
    paragraphs: paragraphs.length,
    percent: Math.floor((read / tokens) * 100),
    secondsLeft: Math.round(estimateFinishedHours(tokens - read) * 3600),
  };
}

/** Seconds as the mocks write a duration: m:ss (or, with `minuteDigits` 2, the REC badge's 06:42), h:mm:ss from an hour. */
export function clockText(seconds: number, minuteDigits: 1 | 2 = 1): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(minuteDigits, '0')}:${s}`;
}

export const progressText = ({ paragraph, paragraphs, percent, secondsLeft }: BoothProgress): string =>
  `¶ ${paragraph.toLocaleString()} of ${paragraphs.toLocaleString()} · ${percent}% · ~${clockText(secondsLeft)} finished left`;

/** One name ahead of the reading position with a pronunciation to say it by (mock 03's "Coming up", audit BO8). */
export type ComingUpName = { key: string; text: string; entity: GuideEntity; pronunciation: GuidePronunciation };

/**
 * The name a mention says and how to say it: the entry's own name or the alias the marked words are ("Rabbit"), the longest
 * one they contain when the mark covers more than the name (a whole word such as "rabbit-hole"), else the entry's name.
 */
function mentionOf(entity: GuideEntity, words: string): { name: string; pronunciation: GuidePronunciation } {
  const said = words.toLowerCase();
  const names = [
    { name: entity.canonical_name, pronunciation: entity.pronunciation },
    ...entity.aliases.map((alias) => ({ name: alias.text, pronunciation: alias.pronunciation })),
  ];
  const exact = names.find((item) => item.name.toLowerCase() === said);
  const inside = names.filter((item) => said.includes(item.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  const found = exact ?? inside ?? names[0];
  return found.pronunciation.ipa.trim() ? found : { name: found.name, pronunciation: entity.pronunciation };
}

/**
 * The next `limit` distinct names the narrator will read, from the current word on, that have a pronunciation in the Story
 * Bible (mock 03's "Coming up"): the same Story Bible marks the text draws, in reading order, each name once. A row the
 * tracker does not follow yet (before a session) counts from its first word, so before Play the list is the chapter's
 * first names; `cursor` is the session's current word.
 */
export function comingUp(rows: ReaderRow[], marks: Map<string, ReaderMark[]>, cursor: number, tracked: boolean, limit = 3): ComingUpName[] {
  const found: ComingUpName[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const rowMarks = marks.get(row.key);
    if (!rowMarks) continue;
    const words = row.words ?? splitWords(row.text).words;
    const local = tracked ? cursor - row.start : 0;
    if (tracked && local >= words.length) continue;
    for (const mark of rowMarks) {
      if (mark.value.kind !== 'entity' || mark.from < local) continue;
      const { name, pronunciation } = mentionOf(mark.value.entity, words.slice(mark.from, mark.to).join(' '));
      const key = name.toLowerCase();
      if (seen.has(key) || !pronunciation.ipa.trim()) continue;
      seen.add(key);
      found.push({ key, text: name, entity: mark.value.entity, pronunciation });
      if (found.length === limit) return found;
    }
  }
  return found;
}
