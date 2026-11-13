import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import test from 'node:test';
import { startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { createSessions } from '../src/session.js';
import { createVisitorStates, mockOnly } from '../src/mockonly.js';
import { __resetRugPullForTests } from '../src/mcp/hostile.js';
import { bindHost } from '../src/safety.js';
import { guardNetwork } from './netguard.js';

async function withServer(env, fn) {
  const health = createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks: () => runChecks({ env }), allPassed, mockOnly, env });
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
    ['/api/run-victim', { task: 'price of ACME', mode: 'pinned', url: 'https://real.hostile.example/mcp' }],
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

const INIT = { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
const ACCEPT = { accept: 'application/json, text/event-stream' };
const initialize = async (post) => {
  const r = await post('/mcp', INIT, ACCEPT);
  await r.text();
  return { sid: r.headers.get('mcp-session-id'), cookie: r.headers.get('set-cookie') };
};
const FRESH = /^Get the latest price/;

test('mock-only: two clients from the same address with no cookie are isolated; flipping one does not flip the other', async () => {
  const guard = guardNetwork();
  try {
    await withServer({ MOCK_ONLY: '1' }, async ({ post }) => {
      const A = { 'mcp-session-id': (await initialize(post)).sid };
      const B = { 'mcp-session-id': (await initialize(post)).sid };
      assert.notEqual(A['mcp-session-id'], B['mcp-session-id']);
      assert.match(await rugPull(post, A, 1), FRESH);
      assert.match(await rugPull(post, A, 2), /IMPORTANT/);
      assert.match(await rugPull(post, B, 3), FRESH, 'B is not flipped by A');
      // No identity at all: every request is a fresh isolated state, never an address-keyed shared bucket.
      for (let i = 0; i < 3; i += 1) assert.match(await rugPull(post, {}, 10 + i), FRESH);
    });
    assert.deepEqual(guard.attempts, [], 'zero outbound attempts');
  } finally { guard.restore(); }
});

test('mock-only: initialize mints an HttpOnly SameSite=Lax cookie (Secure behind https); the cookie carries the same state', async () => {
  await withServer({ MOCK_ONLY: '1' }, async ({ post }) => {
    const plain = await initialize(post);
    assert.match(plain.cookie, /^hm_visitor=[\w-]+; Path=\/; HttpOnly; SameSite=Lax$/);
    const https = await post('/mcp', INIT, { ...ACCEPT, 'x-forwarded-proto': 'https' });
    await https.text();
    assert.match(https.headers.get('set-cookie'), /; Secure$/);
    const jar = { cookie: plain.cookie.split(';')[0] };
    assert.match(await rugPull(post, jar, 1), FRESH);
    assert.match(await rugPull(post, jar, 2), /IMPORTANT/);
  });
});

test('mock-only: identity is not forgeable; an id the server did not issue gets fresh state, never another visitor\'s', async () => {
  await withServer({ MOCK_ONLY: '1' }, async ({ post }) => {
    const A = { 'mcp-session-id': (await initialize(post)).sid };
    await rugPull(post, A, 1);
    assert.match(await rugPull(post, A, 2), /IMPORTANT/);
    for (const forged of [{ 'mcp-session-id': 'visitor-aaaaaaaa' }, { cookie: 'hm_visitor=visitor-aaaaaaaa' }, { 'mcp-session-id': '../x' }]) {
      assert.match(await rugPull(post, forged, 3), FRESH);
      assert.match(await rugPull(post, forged, 4), FRESH, 'a forged id is not remembered either');
    }
    assert.match(await rugPull(post, A, 5), /IMPORTANT/, 'A is untouched');
  });
});

test('visitor store is bounded (LRU) and expires by TTL', () => {
  let t = 0;
  const resolve = createVisitorStates({ max: 3, ttlMs: 1000, now: () => t, newId: (() => { let n = 0; return () => `id-${++n}-xxxxxxxx`; })() });
  const headers = {};
  const mint = () => { headers.set = {}; const res = { setHeader: (k, v) => { headers.set[k] = v; } }; resolve({ method: 'POST', headers: {}, body: INIT }, res); return headers.set['Mcp-Session-Id']; };
  const ids = [mint(), mint(), mint(), mint(), mint()];
  assert.equal(resolve.size(), 3);
  const get = (id) => resolve({ method: 'POST', headers: { 'mcp-session-id': id }, body: {} }, null);
  const a = get(ids[4]); a.count = 7;
  assert.equal(get(ids[4]).count, 7, 'newest kept');
  assert.equal(get(ids[0]).count, 0, 'oldest evicted, got a throwaway');
  assert.equal(resolve.size(), 3);
  t = 5000;
  assert.equal(get(ids[4]).count, 0, 'expired');
});

test('with MOCK_ONLY off the rug-pull counter stays process-global', async () => {
  const guard = guardNetwork();
  try {
    await withServer({}, async ({ post }) => {
      __resetRugPullForTests();
      assert.match(await rugPull(post, { cookie: 'hm_visitor=visitor-aaaaaaaa' }, 1), FRESH);
      assert.match(await rugPull(post, { cookie: 'hm_visitor=visitor-bbbbbbbb' }, 2), /IMPORTANT/, 'a different visitor sees the flip');
      assert.equal((await post('/mcp', INIT, ACCEPT)).headers.get('mcp-session-id'), null, 'nothing is minted');
      __resetRugPullForTests();
    });
    assert.deepEqual(guard.attempts, [], 'zero outbound attempts');
  } finally { guard.restore(); }
});

// Hosted-copy settings: the explicit bind plus the allowed-host list; defaults stay loopback.
const getWithHost = (port, host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/api/health', headers: { host } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)); }).on('error', reject);
});

test('hosted mock: HOSTILE_BIND + HOSTILE_ALLOWED_HOSTS serve the allowed Host and reject others with 421', async () => {
  const env = { MOCK_ONLY: '1', HOSTILE_BIND: '0.0.0.0', HOSTILE_ALLOWED_HOSTS: 'mock.hostile.test, other.hostile.test' };
  const health = createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks: () => runChecks({ env }), allPassed, mockOnly, env });
  const server = await startHttpServer(0, bindHost(env), { env, health, sessions: createSessions() });
  try {
    assert.equal(await getWithHost(server.port, 'mock.hostile.test'), 200);
    assert.equal(await getWithHost(server.port, 'MOCK.hostile.test:8443'), 200);
    assert.equal(await getWithHost(server.port, 'evil.example'), 421);
    assert.equal(await getWithHost(server.port, 'mock.hostile.test.evil.example'), 421);
    assert.equal(await getWithHost(server.port, '127.0.0.1'), 421, 'an allow-list means the list, loopback included');
  } finally { health.stop(); await server.close(); }
});

test('without the explicit settings a non-loopback bind is refused and the host check is off', async () => {
  assert.equal(bindHost({ MOCK_ONLY: '1' }), '127.0.0.1');
  await assert.rejects(async () => startHttpServer(0, '0.0.0.0', { env: { MOCK_ONLY: '1' } }), /loopback only/);
  await withServer({ MOCK_ONLY: '1' }, async ({ base }) => assert.equal((await fetch(`${base}/api/health`, { headers: { accept: 'application/json' } })).status, 200));
});

test('the deliberately-hostile banner and the mock banner are both served by the UI', () => {
  const app = fs.readFileSync(new URL('../../web/src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /deliberately hostile/);
  assert.match(app, /mock-only/);
});

test('an initialize flood from one source cannot evict another visitor\'s state', () => {
  const resolve = createVisitorStates({ max: 500 });
  const res = () => ({ setHeader() {} });
  const init = (addr) => ({ method: 'POST', headers: {}, body: { method: 'initialize' }, socket: { remoteAddress: addr } });
  const a = init('10.0.0.1'); const ra = res();
  let id; ra.setHeader = (k, v) => { if (k === 'Mcp-Session-Id') id = v; };
  const stateA = resolve(a, ra); stateA.count = 5;
  for (let i = 0; i < 3000; i += 1) resolve(init('10.0.0.9'), res());
  assert.equal(resolve({ method: 'POST', headers: { 'mcp-session-id': id }, body: {}, socket: { remoteAddress: '10.0.0.1' } }, res()).count, 5);
});

test('an oversize /mcp body gets a JSON 413 with no stack or paths', async () => {
  await withServer({}, async ({ base }) => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pad: 'x'.repeat(200_000) }) });
    const t = await r.text();
    assert.equal(r.status, 413);
    assert.deepEqual(JSON.parse(t), { error: 'payload_too_large' });
    assert.ok(!/node_modules|\/Users\//.test(t));
  });
});
