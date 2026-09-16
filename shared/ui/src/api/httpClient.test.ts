import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpClient } from './httpClient';

afterEach(() => vi.unstubAllGlobals());

describe('httpClient manuscript import contract', () => {
  it('uses the registered preview route and camel-case request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'job', phase: 'ready' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await httpClient.manuscriptImportPreview('job', { markdownHeadingLevel: 2 });

    expect(fetchMock).toHaveBeenCalledWith('/api/manuscript/import/job/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdownHeadingLevel: 2 }),
    });
  });

  it('uses the registered cancel route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await httpClient.manuscriptImportCancel('job');

    expect(fetchMock).toHaveBeenCalledWith('/api/manuscript/import/job/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  });
});
