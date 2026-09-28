import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { formatScoreTable, type MockScore } from './report';

// The pixel-match run starts from an empty folder, and at its end gathers every mock's record into one table
// (screenshots/mock-match/scores.md, gitignored) and prints it.
const OUT_DIR = 'screenshots/mock-match';

export default function globalSetup(): () => void {
  rmSync(OUT_DIR, { recursive: true, force: true });
  return () => {
    if (!existsSync(OUT_DIR)) return;
    const scores = readdirSync(OUT_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(`${OUT_DIR}/${name}`, 'utf8')) as MockScore);
    const table = formatScoreTable(scores);
    writeFileSync(`${OUT_DIR}/scores.md`, `${table}\n`);
    console.log(`\nMock match (${scores.length} states, written to apps/ui/${OUT_DIR}/scores.md):\n\n${table}\n`);
  };
}
