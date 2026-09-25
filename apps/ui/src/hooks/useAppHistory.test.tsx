// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppHistory } from './useAppHistory';

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => window.history.replaceState(null, '', '/'));

function wrapper({ children }: { children: React.ReactNode }) {
  return <BrowserRouter>{children}</BrowserRouter>;
}

function renderAppHistory() {
  return renderHook(
    () => {
      const navigate = useNavigate();
      const history = useAppHistory();
      return { navigate, ...history };
    },
    { wrapper },
  );
}

// jsdom dispatches `popstate` (which `history.back()`/`history.forward()`/`navigate(-1)` all end in) on a task,
// not synchronously, so a pop needs a real turn of the event loop before the hook's state reflects it; `waitFor`
// polls until it does.
describe('useAppHistory', () => {
  it('starts with nothing to go back or forward to', () => {
    const { result } = renderAppHistory();
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
  });

  it('enables Back after a push and disables Forward again', () => {
    const { result } = renderAppHistory();
    act(() => result.current.navigate('/manuscript'));
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
  });

  it('back() then forward() moves exactly one page each way', async () => {
    const { result } = renderAppHistory();
    act(() => result.current.navigate('/manuscript'));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.canGoBack).toBe(false));
    expect(result.current.canGoForward).toBe(true);
    act(() => result.current.forward());
    await waitFor(() => expect(result.current.canGoForward).toBe(false));
    expect(result.current.canGoBack).toBe(true);
  });

  it('a push after a back discards the forward entries (a new ceiling)', async () => {
    const { result } = renderAppHistory();
    act(() => result.current.navigate('/manuscript'));
    act(() => result.current.navigate('/story-bible'));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.canGoForward).toBe(true));
    act(() => result.current.navigate('/settings'));
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.canGoBack).toBe(true);
  });

  it('a replace does not add a page to go back to', () => {
    const { result } = renderAppHistory();
    // The pattern a gated route or a redirect uses (App.tsx:262-264): replace the current entry instead
    // of pushing a new one, so the page it bounced from does not become a Back step.
    act(() => result.current.navigate('/settings', { replace: true }));
    expect(result.current.canGoBack).toBe(false);
  });

  it('resetFloor stops Back at the page open when a project attaches (Q8)', async () => {
    const { result } = renderAppHistory();
    act(() => result.current.navigate('/manuscript'));
    act(() => result.current.resetFloor());
    expect(result.current.canGoBack).toBe(false);
    act(() => result.current.navigate('/story-bible'));
    expect(result.current.canGoBack).toBe(true);
    act(() => result.current.back());
    await waitFor(() => expect(result.current.canGoBack).toBe(false));
  });

  it('unexpectedPop stays false for a pop this hook started itself', async () => {
    const { result } = renderAppHistory();
    act(() => result.current.navigate('/manuscript'));
    act(() => result.current.back());
    await waitFor(() => expect(result.current.canGoBack).toBe(false));
    expect(result.current.unexpectedPop).toBe(false);
  });

  it('unexpectedPop is set for a pop the app did not start (a mouse-button gesture WebView2 acted on), and clears', async () => {
    const { result } = renderAppHistory();
    act(() => result.current.navigate('/manuscript'));
    act(() => void window.history.back());
    await waitFor(() => expect(result.current.canGoBack).toBe(false));
    expect(result.current.unexpectedPop).toBe(true);
    act(() => result.current.clearUnexpectedPop());
    expect(result.current.unexpectedPop).toBe(false);
  });
});
