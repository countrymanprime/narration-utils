import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { formatScoreTable, type MockScore } from './report';

// The pixel-match run starts from an empty folder, and at its end gathers every mock's record into one table
// (screenshots/mock-match/scores.md, gitignored) and prints it. The records are also written as one scores.json, which a later
// run reads through MOCK_MATCH_BASELINE to print each score's change: the before-and-after a phase's pull request reports.
const OUT_DIR = 'screenshots/mock-match';

export default function globalSetup(): () => void {
  rmSync(OUT_DIR, { recursive: true, force: true });
  return () => {
    if (!existsSync(OUT_DIR)) return;
    const scores = readdirSync(OUT_DIR)
      .filter((name) => name.endsWith('.json') && name !== 'scores.json')
      .map((name) => JSON.parse(readFileSync(`${OUT_DIR}/${name}`, 'utf8')) as MockScore);
    const baselinePath = process.env.MOCK_MATCH_BASELINE;
    const baseline = baselinePath ? (JSON.parse(readFileSync(baselinePath, 'utf8')) as MockScore[]) : [];
    const table = formatScoreTable(scores, baseline);
    writeFileSync(`${OUT_DIR}/scores.json`, `${JSON.stringify(scores, null, 2)}\n`);
    writeFileSync(`${OUT_DIR}/scores.md`, `${table}\n`);
    console.log(`\nMock match (${scores.length} states, written to apps/ui/${OUT_DIR}/scores.md):\n\n${table}\n`);
  };
}
