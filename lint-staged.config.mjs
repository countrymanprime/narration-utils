export default {
  'apps/ui/**/*.{cjs,cts,css,js,json,jsx,mjs,mts,ts,tsx}': ['node scripts/quality.mjs fix-ui', 'node scripts/quality.mjs check-ui'],
  '**/*.py': ['node scripts/quality.mjs fix-python', 'node scripts/quality.mjs check-python'],
  'apps/desktop/**/*.go': ['node scripts/quality.mjs fix-go', 'node scripts/quality.mjs check-go'],
  '**/*.lua': ['node scripts/quality.mjs fix-lua', 'node scripts/quality.mjs check-lua'],
  '**/*.{ps1,psm1}': 'node scripts/quality.mjs check-powershell',
};
