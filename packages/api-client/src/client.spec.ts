import { strict as assert } from 'node:assert';
import test from 'node:test';

import { ApiError, createApiClient } from './client.ts';

test('request adds auth, idempotency and query parameters', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({ data: [], meta: { page: 2 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const client = createApiClient({
    baseUrl: 'https://mes.example.test',
    fetch: fetchImpl,
    getAccessToken: () => 'test-token',
  });

  await client.request('/api/v1/organizations', 'get', {
    idempotencyKey: 'request-1',
    query: { page: 2, active: true, omitted: undefined },
  });

  assert.equal(capturedUrl, 'https://mes.example.test/api/v1/organizations?page=2&active=true');
  const headers = new Headers(capturedInit?.headers);
  assert.equal(capturedInit?.method, 'GET');
  assert.equal(headers.get('authorization'), 'Bearer test-token');
  assert.equal(headers.get('idempotency-key'), 'request-1');
});

test('request throws a structured ApiError for non-2xx responses', async () => {
  const client = createApiClient({
    baseUrl: 'https://mes.example.test',
    fetch: async () =>
      new Response(JSON.stringify({ message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await assert.rejects(
    client.request('/api/v1/me', 'get'),
    (error: unknown) =>
      error instanceof ApiError && error.status === 401 && error.message === 'Unauthorized',
  );
});


test('default fetch keeps the global receiver required by WebKit', async () => {
  const originalFetch = globalThis.fetch;
  let receiver: unknown;
  globalThis.fetch = function (this: unknown) {
    receiver = this;
    return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
  } as typeof fetch;

  try {
    const client = createApiClient({ baseUrl: 'https://mes.example.test' });
    await client.request('/api/v1/health', 'get');
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
