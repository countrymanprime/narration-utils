// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiProvider, useApi } from './ApiContext';
import { createMockApi } from './mockApi';

function Probe() {
  const api = useApi();
  return <div>{typeof api.ready}</div>;
}

function ThrowsOutsideProvider() {
  let message = '';
  try {
    useApi();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  return <div>{message}</div>;
}

describe('ApiContext', () => {
  it('gives useApi() the api passed to the nearest ApiProvider', () => {
    render(
      <ApiProvider api={createMockApi()}>
        <Probe />
      </ApiProvider>,
    );
    expect(screen.getByText('function')).toBeTruthy();
  });

  it('useApi() throws a clear error when called with no ApiProvider above it', () => {
    render(<ThrowsOutsideProvider />);
    expect(screen.getByText('useApi() called outside an <ApiProvider>.')).toBeTruthy();
  });
});
