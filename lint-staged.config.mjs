export default {
  'apps/ui/**/*.{cjs,cts,css,js,json,jsx,mjs,mts,ts,tsx}': ['node scripts/quality.mjs fix-ui', 'node scripts/quality.mjs check-ui'],
  '**/*.py': ['node scripts/quality.mjs fix-python', 'node scripts/quality.mjs check-python'],
  'apps/desktop/**/*.go': ['node scripts/quality.mjs fix-go', 'node scripts/quality.mjs check-go'],
  '**/*.lua': ['node scripts/quality.mjs fix-lua', 'node scripts/quality.mjs check-lua'],
  '**/*.{ps1,psm1}': 'node scripts/quality.mjs check-powershell',
  // markdownlint-cli2 --fix (ADR 0415): fixes what it can and reports the rest, so a remaining violation still
  // fails the commit. lint-staged passes the staged *.md files as arguments.
  '**/*.md': 'markdownlint-cli2 --fix',
};
