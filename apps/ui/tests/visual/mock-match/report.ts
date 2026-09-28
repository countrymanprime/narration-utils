// The score table the pixel-match tool prints and writes (screenshots/mock-match/scores.md), in the shape the PRD's
// baseline and every UI pull request's Mockup check use (D91 on #509: mock, page/state, viewport, match %).

import { MATCH_BAR_PERCENT } from './compare';

export interface MockScore {
  file: string;
  target: string;
  viewport: string;
  theme: 'light' | 'dark';
  matchPercent: number;
  inkMatchPercent: number;
  /** Where the diff picture was written (gitignored). */
  diff: string;
}

function percent(value: number): string {
  return value.toFixed(2);
}

/** A Markdown table of the scores, worst first, with every score under the bar marked. */
export function formatScoreTable(scores: MockScore[]): string {
  const rows = [...scores].sort((a, b) => a.matchPercent - b.matchPercent || a.file.localeCompare(b.file));
  const lines = ['| Mock | Page/state | Viewport | Theme | Match % | Ink match % | Diff |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const row of rows) {
    const match = row.matchPercent < MATCH_BAR_PERCENT ? `**${percent(row.matchPercent)}** (under ${MATCH_BAR_PERCENT})` : percent(row.matchPercent);
    lines.push(`| \`${row.file}\` | ${row.target} | ${row.viewport} | ${row.theme} | ${match} | ${percent(row.inkMatchPercent)} | \`${row.diff}\` |`);
  }
  return lines.join('\n');
}
