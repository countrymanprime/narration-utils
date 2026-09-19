import { execFileSync } from 'node:child_process';

/** Runs `gh` and returns stdout. Tests and dry runs inject their own runner instead. */
export function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/** Lists every item of a paginated REST collection. `--jq '.[]'` emits one JSON object per line. */
export function ghList(endpoint, run = gh) {
  return run(['api', '--paginate', endpoint, '--jq', '.[]'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** Sends a REST write. `{owner}` and `{repo}` in the endpoint are filled in by `gh` from the current repository. */
export function ghSend(method, endpoint, fields, run = gh) {
  const args = ['api', '--method', method, endpoint];
  for (const [key, value] of Object.entries(fields)) args.push('-f', `${key}=${value}`);
  return run(args);
}
