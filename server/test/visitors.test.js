// Visitor-bound UI sessions, the proxy-aware throttle and the fail-closed Host check.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createSessions } from '../src/session.js';
import { createUiVisitors } from '../src/uivisitor.js';
import { createVisitorStates } from '../src/mockonly.js';
import { clientSource, trustHops } from '../src/source.js';
import { assertBindAllowed } from '../src/safety.js';

async function withServer(opts, fn) {
  const health = createHealth();
  const server = await startHttpServer(0, '127.0.0.1', { health, ...opts });
  const base = `http://127.0.0.1:${server.port}`;
  // A "browser": its own cookie jar.
  const browser = () => {
    let cookie = '';
    const call = async (method, path, body, headers = {}) => {
      const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
      const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
      return r;
    };
    return { post: (p, b, h) => call('POST', p, b ?? {}, h), del: (p) => call('DELETE', p) };
  };
  try { await fn({ browser }); } finally { health.stop(); await server.close(); }
}

test('finding 1: one visitor flooding /new cannot wipe another visitor\'s session', async () => {
  await withServer({}, async ({ browser }) => {
    const a = browser(); const attacker = browser();
    const { sessionId } = await (await a.post('/api/mcp-session/new')).json();
    const codes = [];
    for (let i = 0; i < 25; i += 1) codes.push((await attacker.post('/api/mcp-session/new')).status);
    assert.ok(codes.every((c) => c === 201 || c === 429));
    assert.equal((await a.post(`/api/mcp-session/${sessionId}/list`)).status, 200, 'A still has the session');
  });
});

test('a session id is useless to anyone but its visitor (list, approve, delete)', async () => {
  await withServer({}, async ({ browser }) => {
    const a = browser(); const b = browser();
    const { sessionId } = await (await a.post('/api/mcp-session/new')).json();
    for (const [m, p] of [['post', 'list'], ['post', 'approve']]) assert.equal((await b[m](`/api/mcp-session/${sessionId}/${p}`)).status, 404, p);
    assert.equal((await b.del(`/api/mcp-session/${sessionId}`)).status, 404);
    assert.equal((await a.post(`/api/mcp-session/${sessionId}/list`)).status, 200);
  });
});

test('an invented hm_ui cookie is ignored: it does not open someone else\'s session or mint a bucket', async () => {
  await withServer({}, async ({ browser }) => {
    const a = browser();
    const { sessionId } = await (await a.post('/api/mcp-session/new')).json();
    const r = await browser().post(`/api/mcp-session/${sessionId}/list`, {}, { cookie: 'hm_ui=00000000-0000-0000-0000-000000000000' });
    assert.equal(r.status, 404);
  });
});

test('per-visitor cap: one visitor loses only their own oldest session', async () => {
  const sessions = createSessions({ perOwnerMax: 3, max: 100 });
  const other = await sessions.create({ owner: 'other' });
  const mine = [];
  for (let i = 0; i < 5; i += 1) mine.push(await sessions.create({ owner: 'me' }));
  assert.equal(sessions.sizeFor('me'), 3);
  assert.equal(sessions.get(mine[0].id, 'me'), null);
  assert.ok(sessions.get(mine[4].id, 'me'));
  assert.ok(sessions.get(other.id, 'other'), 'the other visitor is untouched');
  assert.equal(sessions.get(mine[4].id, 'other'), null, 'wrong owner');
});

test('global cap: many distinct visitors exercise LRU eviction (least recently used goes first)', async () => {
  const sessions = createSessions({ perOwnerMax: 2, max: 50 });
  const first = await sessions.create({ owner: 'v0' });
  const kept = await sessions.create({ owner: 'v1' });
  for (let i = 2; i < 80; i += 1) {
    await sessions.create({ owner: `v${i}` });
    sessions.get(kept.id, 'v1'); // v1 keeps using theirs
  }
  assert.equal(sessions.size(), 50);
  assert.equal(sessions.get(first.id, 'v0'), null, 'idle visitor evicted');
  assert.ok(sessions.get(kept.id, 'v1'), 'active visitor survives');
});

test('visitor table: many distinct visitors, LRU + ttl, and an invented id is not accepted', () => {
  let t = 0; let n = 0;
  const v = createUiVisitors({ max: 5, ttlMs: 1000, now: () => t, newId: () => `visitor-${String(n += 1).padStart(4, '0')}`, mintsPerMin: 1000 });
  const mk = (cookie, addr = '10.0.0.1') => ({ headers: cookie ? { cookie: `hm_ui=${cookie}` } : {}, socket: { remoteAddress: addr } });
  const res = () => ({ setHeader() {} });
  const ids = []; for (let i = 0; i < 8; i += 1) ids.push(v.identify(mk(), res()).id);
  assert.equal(v.size(), 5);
  assert.notEqual(v.identify(mk(ids[0]), res()).id, ids[0], 'evicted visitor gets a new identity');
  assert.equal(v.identify(mk('visitor-9999'), res()).id === 'visitor-9999', false, 'invented id');
  t = 5000;
  assert.notEqual(v.identify(mk(ids[7]), res()).id, ids[7], 'expired');
});

test('/new has a per-visitor rate (429) and minting a visitor has a per-source rate', () => {
  const v = createUiVisitors({ newPerMin: 3, mintsPerMin: 2 });
  assert.deepEqual([1, 2, 3, 4].map(() => v.allowNew('x')), [true, true, true, false]);
  const req = { headers: {}, socket: { remoteAddress: '10.0.0.1' } };
  const r = { setHeader() {} };
  assert.ok(v.identify(req, r).id); assert.ok(v.identify(req, r).id);
  assert.equal(v.identify(req, r).throttled, true);
});

// ---- finding 2: trust-proxy

const req = (xff, addr = '10.1.1.1') => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: addr } });

test('trustHops: default off; numbers and true parse; junk is off', () => {
  assert.deepEqual([{}, { HOSTILE_TRUST_PROXY: '' }, { HOSTILE_TRUST_PROXY: '0' }, { HOSTILE_TRUST_PROXY: '1' }, { HOSTILE_TRUST_PROXY: 'true' }, { HOSTILE_TRUST_PROXY: '2' }, { HOSTILE_TRUST_PROXY: 'abc' }, { HOSTILE_TRUST_PROXY: '-1' }].map(trustHops), [0, 0, 0, 1, 1, 2, 0, 0]);
});

test('clientSource: off ignores X-Forwarded-For entirely; on takes the left-most untrusted hop', () => {
  assert.equal(clientSource(req('203.0.113.9'), 0), '10.1.1.1', 'off: the connection, header ignored');
  assert.equal(clientSource(req('198.51.100.7, 203.0.113.9'), 1), '203.0.113.9', 'one proxy: its appended hop; a client-prepended entry is ignored');
  assert.equal(clientSource(req('6.6.6.6, 203.0.113.9, 10.9.9.9'), 2), '203.0.113.9', 'two proxies');
  assert.equal(clientSource(req(undefined), 1), '10.1.1.1', 'no header: connection');
  assert.equal(clientSource(req('203.0.113.9'), 2), '10.1.1.1', 'fewer hops than trusted: connection');
});

const initReq = (xff, addr = '10.1.1.1') => ({ method: 'POST', headers: xff ? { 'x-forwarded-for': xff } : {}, body: { method: 'initialize' }, socket: { remoteAddress: addr } });
const minted = (resolve, r) => { let got = null; resolve(r, { setHeader: (k, v) => { if (k === 'Mcp-Session-Id') got = v; } }); return got; };

test('mint throttle behind an ingress: without trust-proxy every visitor shares the ingress bucket', () => {
  const resolve = createVisitorStates({ mintsPerMin: 3 });
  const got = [1, 2, 3, 4, 5].map((i) => minted(resolve, initReq(`203.0.113.${i}`)));
  assert.deepEqual(got.map(Boolean), [true, true, true, false, false], 'the shared bucket starves later visitors (the old behaviour, still the default)');
});

test('mint throttle behind an ingress: with trust-proxy each visitor has their own bucket, and a flooder is still limited', () => {
  const resolve = createVisitorStates({ mintsPerMin: 3, trustProxy: 1 });
  for (let i = 1; i <= 5; i += 1) assert.ok(minted(resolve, initReq(`203.0.113.${i}`)), `visitor ${i}`);
  const results = Array.from({ length: 5 }, () => minted(resolve, initReq('198.51.100.1, 203.0.113.99')));
  assert.deepEqual(results.map(Boolean), [true, true, true, false, false]);
  const spoof = Array.from({ length: 5 }, (_, i) => minted(resolve, initReq(`spoof${i}, 203.0.113.99`)));
  assert.ok(spoof.every((x) => !x), 'a prepended fake hop does not buy a fresh bucket');
});

// ---- finding 3: fail-closed host check

test('MOCK_ONLY on a non-loopback bind refuses to start without HOSTILE_ALLOWED_HOSTS', async () => {
  const env = { MOCK_ONLY: '1', HOSTILE_BIND: '0.0.0.0' };
  assert.throws(() => assertBindAllowed('0.0.0.0', env), /requires HOSTILE_ALLOWED_HOSTS/);
  await assert.rejects(async () => startHttpServer(0, "0.0.0.0", { env }), /requires HOSTILE_ALLOWED_HOSTS/);
  assert.equal(assertBindAllowed('0.0.0.0', { ...env, HOSTILE_ALLOWED_HOSTS: 'mock.hostile.example' }), '0.0.0.0');
  assert.equal(assertBindAllowed('127.0.0.1', { MOCK_ONLY: '1' }), '127.0.0.1', 'loopback is unchanged');
  assert.equal(assertBindAllowed('0.0.0.0', { HOSTILE_BIND: '0.0.0.0' }), '0.0.0.0', 'without MOCK_ONLY the local opt-in is unchanged');
});
