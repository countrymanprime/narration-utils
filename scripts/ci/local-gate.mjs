// How `pnpm check` and `pnpm check:affected` (scripts/quality.mjs) run the Nx targets on a developer's machine. CI does not
// use this: its jobs run their targets through .github/actions/nx-run, one task at a time.
import { readFileSync } from 'node:fs';

/**
 * How many Nx tasks the local gate runs side by side. `NX_PARALLEL` wins when set. On CI (`CI` set) it is one: lint,
 * format and vitest side by side starve a hosted runner and trip vitest's 5 s timeouts. Otherwise half the machine's
 * CPUs, since vitest and pytest each spread over several cores themselves.
 */
export function gateParallelism({ env = process.env, cpus }) {
  const asked = Number.parseInt(env.NX_PARALLEL ?? '', 10);
  if (Number.isInteger(asked) && asked > 0) return asked;
  if (env.CI) return 1;
  return Math.max(1, Math.floor(cpus / 2));
}

/**
 * The files every project depends on but no project owns, as the `workspace_wide` pattern of scripts/ci/nx-scope.sh, so
 * the local affected gate and CI agree on when a change must run everything.
 */
export function workspaceWidePattern(scopeScript = readFileSync(new URL('./nx-scope.sh', import.meta.url), 'utf8')) {
  const match = /^workspace_wide='([^']+)'$/m.exec(scopeScript);
  if (!match) throw new Error('scripts/ci/nx-scope.sh has no workspace_wide pattern');
  return new RegExp(match[1]);
}

/** The changed files (repository-relative, forward slashes) that make a change run every project. */
export function workspaceWideChanges(files, pattern = workspaceWidePattern()) {
  return files.filter((file) => pattern.test(file));
}
