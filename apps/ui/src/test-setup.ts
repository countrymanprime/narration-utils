import { configure } from '@testing-library/react';
import fc from 'fast-check';

// Testing Library's findBy* and waitFor give up after 1 s by default. Vitest runs test files in parallel workers, and a
// page that mounts the whole app or a long chapter in jsdom can take longer than that when the machine is busy: two of 25
// consecutive full runs on a quiet 32-core machine failed with "Unable to find ..." at about 1.1 s while the same
// tests take a few hundred milliseconds alone. A wait ends the moment its condition holds, so a longer limit costs nothing
// on a passing run and only lets a slow one finish; it stays below `testTimeout` (15 s, vite.config.ts) so a real
// hang still fails on the wait's own message rather than as a bare test timeout.
configure({ asyncUtilTimeout: 5_000 });

// Vitest 4's jsdom compat layer wraps URL.createObjectURL and reads a private
// `_buffer` field off jsdom's Blob implementation, which jsdom 30 no longer
// has, so the real call throws. No test needs a real blob URL - the audio
// element is never actually loaded - so hand back a stable fake instead.
URL.createObjectURL = () => 'blob:vitest-object-url';
URL.revokeObjectURL = () => undefined;

// Property tests (fast-check) are deterministic in the gate: a fixed seed makes every run draw the
// same examples, so a red run is a real bug and never a lucky draw (ADR 0023: red must mean real).
// VITE_FAST_CHECK_EXPLORE=1 runs random seeds and many more runs by hand; a failing random run prints its
// seed and counterexample, and the counterexample becomes a plain example test.
fc.configureGlobal(import.meta.env.VITE_FAST_CHECK_EXPLORE === '1' ? { numRuns: 5000 } : { seed: 20260920, numRuns: 200 });
