import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../src/services/apiClient.ts';

test('sends the bearer token and unwraps JSON', async () => {
  const seen: any[] = [];
  const fetchImpl = async (url: string, init: any) => {
    seen.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ success: true, channels: [] }) } as any;
  };
  const api = createApiClient({ baseUrl: '', getToken: () => 'T', onUnauthorized: () => {}, fetchImpl });
  const out = await api.get('/api/chat/channels');
  assert.deepEqual(out, { success: true, channels: [] });
  assert.equal(seen[0].init.headers.Authorization, 'Bearer T');
});

test('401 calls onUnauthorized and throws ApiError with the server code', async () => {
  let bounced = 0;
  const fetchImpl = async () =>
    ({
      ok: false,
      status: 401,
      json: async () => ({ success: false, tokenError: 'token_expired', message: 'Session expired' }),
    }) as any;
  const api = createApiClient({
    baseUrl: '',
    getToken: () => 'T',
    onUnauthorized: () => {
      bounced++;
    },
    fetchImpl,
  });
  await assert.rejects(
    () => api.get('/x'),
    (e: any) => e instanceof ApiError && e.status === 401 && e.code === 'token_expired',
  );
  assert.equal(bounced, 1);
});

test('post sends JSON and surfaces 4xx codes without bouncing', async () => {
  let bounced = 0;
  const fetchImpl = async (_u: string, _init: any) =>
    ({ ok: false, status: 429, json: async () => ({ success: false, code: 'rate', message: 'Slow down' }) }) as any;
  const api = createApiClient({
    baseUrl: '',
    getToken: () => 'T',
    onUnauthorized: () => {
      bounced++;
    },
    fetchImpl,
  });
  await assert.rejects(
    () => api.post('/x', { a: 1 }),
    (e: any) => e.status === 429 && e.message === 'Slow down',
  );
  assert.equal(bounced, 0);
});
