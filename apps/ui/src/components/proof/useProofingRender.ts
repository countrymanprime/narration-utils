import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage, describeApiError } from '../../api/errorMessage';
import type { ProofingRender } from '../../types';
import type { Notify } from '../primitives/Toast';

/** How often a running measurement is read (matches DeliveryPage.tsx's own POLL_MS). */
const POLL_MS = 500;

export type ProofingRenderState = {
  phase: 'loading' | 'ready' | 'error';
  render?: ProofingRender;
  error: string;
  /** A choice or a clear is being sent. */
  busy: boolean;
  /** Measure (DX-1's job) is running against this chapter's chosen render. */
  measuring: boolean;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A chapter's render association (proofing-readiness-signals.prd.md Phase 6): reads it on mount and on `refresh`;
 * `choose` opens the native file dialog and attests what the narrator picks; `clear` removes the association;
 * `measure` runs the existing measurement job (DX-1) against the chosen render and re-reads the association once it
 * ends, so the recorded result (apps/desktop/internal/proofing/renders.go's RecordRenderMeasurements, already wired
 * into every measurement job) shows without a page reload. Nothing here evaluates the delivery signals themselves;
 * those are read through StageRecommendations, which already reads the same association.
 */
export function useProofingRender(chapterId: string | undefined, notify: Notify) {
  const api = useApi();
  const [state, setState] = useState<ProofingRenderState>({ phase: 'loading', error: '', busy: false, measuring: false });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (!chapterId) return;
    setState((current) => ({ ...current, phase: 'loading' }));
    try {
      const render = await api.proofingRenderState(chapterId);
      if (mounted.current) setState((current) => ({ ...current, phase: 'ready', render, error: '' }));
    } catch (error) {
      if (mounted.current) setState((current) => ({ ...current, phase: 'error', error: apiErrorMessage(error) }));
    }
  }, [api, chapterId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const choose = useCallback(async () => {
    if (!chapterId) return;
    setState((current) => ({ ...current, busy: true }));
    try {
      const result = await api.proofingChooseRender(chapterId);
      if (result.status === 'cancelled') return;
      if (result.status === 'refused') {
        notify(result.message, 'error');
        return;
      }
      if (mounted.current) setState((current) => ({ ...current, phase: 'ready', render: result.render, error: '' }));
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      if (mounted.current) setState((current) => ({ ...current, busy: false }));
    }
  }, [api, chapterId, notify]);

  const clear = useCallback(async () => {
    if (!chapterId) return;
    setState((current) => ({ ...current, busy: true }));
    try {
      const render = await api.proofingClearRender(chapterId);
      if (mounted.current) setState((current) => ({ ...current, phase: 'ready', render, error: '' }));
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      if (mounted.current) setState((current) => ({ ...current, busy: false }));
    }
  }, [api, chapterId, notify]);

  const measure = useCallback(async () => {
    const path = state.render?.path;
    if (!path) return;
    setState((current) => ({ ...current, measuring: true }));
    try {
      let job = await api.measureAnalyze([path]);
      while (job.phase === 'running') {
        await wait(POLL_MS);
        if (!mounted.current) return;
        job = await api.measureState();
      }
      if (job.phase === 'error') notify(job.message, 'error');
      await refresh();
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      if (mounted.current) setState((current) => ({ ...current, measuring: false }));
    }
  }, [api, notify, refresh, state.render?.path]);

  return { ...state, refresh, choose, clear, measure };
}
