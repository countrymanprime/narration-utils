#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const tag = process.argv[2];
if (!tag) {
  console.error('Usage: pnpm release:promote <rc-tag>  (e.g. v0.2.0-rc.1)');
  process.exit(1);
}

execFileSync('gh', ['workflow', 'run', 'promote-release.yml', '-f', `prerelease_tag=${tag}`], { stdio: 'inherit' });
console.log(`\nTriggered promotion for ${tag}.`);
console.log('Approval from a required reviewer on the "production" environment is needed before it runs.');
console.log('Track it with: gh run list --workflow=promote-release.yml --limit 1');
