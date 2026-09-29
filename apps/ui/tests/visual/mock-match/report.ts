// The score table the pixel-match tool prints and writes (screenshots/mock-match/scores.md), in the shape the PRD's
// baseline and every UI pull request's Mockup check use (mock, page/state, viewport, match %; a diagnostic, D97 on #509).

/** The match of one region of the screen (mocks.ts `chromeRegions`). */
interface RegionScore {
  matchPercent: number;
  inkMatchPercent: number;
}

export interface MockScore {
  file: string;
  target: string;
  viewport: string;
  theme: 'light' | 'dark';
  /** The text-blind match (glyphs.ts): layout, features and style. The headline number. */
  matchPercent: number;
  /** The plain pixel match, text and sample data included. */
  pixelMatchPercent: number;
  inkMatchPercent: number;
  /**
   * The nav rail and the header scored apart from the page, where the mock draws them; `spec` when the mock's chrome is the
   * chrome's spec (mocks.ts `isChromeSpec`).
   */
  chrome?: { spec: boolean; rail?: RegionScore; header?: RegionScore };
  /** Where the diff picture was written (gitignored). */
  diff: string;
}

function percent(value: number): string {
  return value.toFixed(2);
}

function delta(now: number | undefined, then: number | undefined): string {
  if (now === undefined || then === undefined) return '';
  const change = Math.round((now - then) * 100) / 100;
  return ` (${change > 0 ? '+' : change < 0 ? '−' : '±'}${Math.abs(change).toFixed(2)})`;
}

function region(score: RegionScore | undefined, before: RegionScore | undefined): string {
  return score ? `${percent(score.matchPercent)}${delta(score.matchPercent, before?.matchPercent)}` : '–';
}

/**
 * A Markdown table of the scores, worst first. With a `baseline` (the `scores.json` of an
 * earlier run, MOCK_MATCH_BASELINE), each score carries its change since then, and a chrome region that fell is marked: as a
 * regression where the mock is the chrome's spec, and as an old shell where it is not.
 */
export function formatScoreTable(scores: MockScore[], baseline: MockScore[] = []): string {
  const before = new Map(baseline.map((score) => [score.file, score]));
  const rows = [...scores].sort((a, b) => a.matchPercent - b.matchPercent || a.file.localeCompare(b.file));
  const lines = [
    '| Mock | Page/state | Viewport | Theme | Match % | Raw pixel % | Ink match % | Rail % | Header % | Diff |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    const then = before.get(row.file);
    const change = delta(row.matchPercent, then?.matchPercent);
    const match = `${percent(row.matchPercent)}${change}`;
    const chrome = (name: 'rail' | 'header') => {
      const cell = region(row.chrome?.[name], then?.chrome?.[name]);
      const fell = then?.chrome?.[name] && row.chrome?.[name] && row.chrome[name].matchPercent < then.chrome[name].matchPercent;
      if (!fell) return cell;
      return row.chrome?.spec ? `**${cell}** (fell)` : `${cell} (old shell)`;
    };
    lines.push(
      `| \`${row.file}\` | ${row.target} | ${row.viewport} | ${row.theme} | ${match} | ${percent(row.pixelMatchPercent)} | ${percent(row.inkMatchPercent)} | ${chrome('rail')} | ${chrome('header')} | \`${row.diff}\` |`,
    );
  }
  return lines.join('\n');
}
