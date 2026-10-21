import assert from 'node:assert/strict';
import test from 'node:test';
import { startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createSessions } from '../src/session.js';
import { mockOnly } from '../src/mockonly.js';
import { guardNetwork } from './netguard.js';

async function withServer(env, fn) {
  const health = createHealth({ env });
  const server = await startHttpServer(0, '127.0.0.1', { env, health, sessions: createSessions() });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try { await fn({ base, post }); } finally { health.stop(); await server.close(); }
}
const rugPull = async (post, headers, id) => {
  const r = await post('/mcp', { jsonrpc: '2.0', id, method: 'tools/list' }, { accept: 'application/json, text/event-stream', ...headers });
  const text = await r.text();
  const json = JSON.parse(text.includes('data:') ? text.split('data:')[1].trim() : text);
  return json.result.tools.find((t) => t.name === 'get_stock_price').description;
};

test('MOCK_ONLY accepts 1 and true only', () => {
  assert.equal(mockOnly({ MOCK_ONLY: '1' }), true);
  assert.equal(mockOnly({ MOCK_ONLY: 'true' }), true);
  for (const v of [undefined, '', '0', 'false', 'no']) assert.equal(mockOnly({ MOCK_ONLY: v }), false);
});

test('mock-only: URL / token / credential carriers get 403 mock_only; the same requests work with it off', async () => {
  const carriers = [
    ['/api/run-victim', { task: 'price of ACME', mode: 'pinned', url: 'https://real.example.net/mcp' }],
    ['/api/run-victim', { task: 'price of ACME', mode: 'pinned', nested: { access_token: 'x' } }],
    ['/api/mcp-session/new', { trusted: true, upstream: 'http://gw' }],
  ];
  await withServer({ MOCK_ONLY: '1' }, async ({ post }) => {
    for (const [p, b] of carriers) {
      const r = await post(p, b);
      assert.equal(r.status, 403, JSON.stringify(b));
      assert.deepEqual(await r.json(), { error: 'mock_only', message: 'Disabled in the hosted mock.' });
    }
    assert.equal((await post('/api/run-victim', { task: 'price of ACME', mode: 'pinned' }, { authorization: 'Bearer abc' })).status, 403);
    assert.equal((await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer abc', accept: 'application/json, text/event-stream' })).status, 403);
    assert.equal((await post('/api/run-victim', { task: 'price of ACME', mode: 'pinned' })).status, 200);
  });
  await withServer({}, async ({ post }) => {
    for (const [p, b] of carriers) assert.notEqual((await post(p, b)).status, 403, JSON.stringify(b));
  });
});

test('health reports mode only in mock-only', async () => {
  await withServer({ MOCK_ONLY: 'true' }, async ({ base }) => assert.equal((await (await fetch(`${base}/api/health`)).json()).mode, 'mock-only'));
  await withServer({}, async ({ base }) => assert.equal('mode' in (await (await fetch(`${base}/api/health`)).json()), false));
});

test('mock-only: two visitors do not share rug-pull state; with it off the counter is process-global', async () => {
  const guard = guardNetwork();
  try {
    await withServer({ MOCK_ONLY: '1' }, async ({ post }) => {
      const A = { cookie: 'hm_visitor=visitor-aaaaaaaa' };
      const B = { cookie: 'hm_visitor=visitor-bbbbbbbb' };
      assert.match(await rugPull(post, A, 1), /^Get the latest price/);
      assert.match(await rugPull(post, A, 2), /IMPORTANT/);
      assert.match(await rugPull(post, B, 3), /^Get the latest price/, 'B is not flipped by A');
    });
    assert.deepEqual(guard.attempts, [], 'zero outbound attempts');
  } finally { guard.restore(); }
});
