/** Shared transport primitive for domain API clients. */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      // A non-JSON response is still useful diagnostic context.
    }
    throw new Error(message || `${method} ${path} failed with ${response.status}`);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

export const get = <T>(path: string) => request<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
export const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {});
export const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {});
export const del = <T>(path: string) => request<T>('DELETE', path);
