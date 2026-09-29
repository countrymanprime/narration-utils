import { Fragment, useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { MasteringProviders } from '../../api/contracts/mastering';
import { Panel } from '../primitives/Panel';
import { Badge } from '../primitives/StatusBadge';

const MUTED = { color: 'var(--text-muted)' };

/** The mastering chains and the project's choice, read once; `undefined` while loading. */
export function useMasteringProviders(): { providers?: MasteringProviders; problem?: string } {
  const api = useApi();
  const [providers, setProviders] = useState<MasteringProviders>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    let active = true;
    api
      .masteringProviders()
      .then((state) => active && setProviders(state))
      .catch((error) => active && setProblem(apiErrorMessage(error)));
    return () => {
      active = false;
    };
  }, [api]);
  return { providers, problem };
}

/**
 * The mastering chain the book masters with (stage-navigation-and-page-replacement.prd.md Phase 8, mock 05; the mastering port,
 * ADR 0306): the project's row from internal/masteringport, its fixed steps in order as a row of chips, and why the project's
 * choice is not the row it masters with, when it is not. Read-only: the built-in chain is fixed and takes its numbers from the
 * platform's rules (ADR 0321), so mock 05's "Edit chain" is not drawn, and neither is "A/B raw ↔ mastered", which needs a player
 * for a rendered file the host does not have yet.
 */
export function MasteringChain({ providers, problem }: { providers?: MasteringProviders; problem?: string }) {
  const row = providers?.providers.find((candidate) => candidate.name === providers.effective);
  return (
    <Panel
      title="Mastering chain"
      subtitle={row ? `One chain for the book: ${row.label}, the same for every platform, with each platform's own RMS window and peak limit.` : undefined}
    >
      {problem && (
        <p role="alert" className="mt-1 text-sm" style={{ color: 'var(--danger-text)' }}>
          The mastering chain could not be read: {problem}
        </p>
      )}
      {row && (
        <>
          {providers?.notice && (
            <p role="status" className="mt-1 text-sm" style={{ color: 'var(--warn-text)' }}>
              {providers.notice}
            </p>
          )}
          {row.chain.length > 0 ? (
            <ol aria-label="Mastering steps" className="flex flex-wrap items-center gap-2">
              {row.chain.map((step, index) => {
                // The chain's last step is the platform's own gain target, not one of the book's fixed steps (mock 05:
                // its chip alone is --accent-soft, mock-fidelity-primitives-and-components.prd.md Phase 14).
                const last = index === row.chain.length - 1;
                return (
                  <Fragment key={step.name}>
                    {index > 0 && (
                      <li aria-hidden="true" className="text-sm" style={MUTED}>
                        →
                      </li>
                    )}
                    <li>
                      <Badge
                        label={`${step.name} · ${step.detail}`}
                        colors={
                          last
                            ? { fill: 'var(--accent-soft)', text: 'var(--accent-strong)', line: 'transparent' }
                            : { fill: 'var(--surface-2)', text: 'var(--text)', line: 'transparent' }
                        }
                      />
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          ) : (
            <p className="mt-2 text-sm" style={MUTED}>
              The chain&apos;s steps are your DAW&apos;s own FX chain.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
