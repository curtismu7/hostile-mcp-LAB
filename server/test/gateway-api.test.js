// The gateway simulation over HTTP, under the network guard. Every Ping product claim behind it is a release claim
// (2026-11-02), UNVERIFIED on our tenant; there is no live path, so zero outbound attempts is the whole network story.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { mockOnly } from '../src/mockonly.js';
import { createSessions } from '../src/session.js';
import { guardNetwork } from './netguard.js';

const SECRET = 'SECRET_TOKEN_123';
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

async function withServer(fn, env = {}) {
  const health = createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks: () => runChecks({ env }), allPassed, mockOnly, env });
  const server = await startHttpServer(0, '127.0.0.1', { env, health, sessions: createSessions() });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  try { await fn({ base, post, get: (p) => fetch(base + p) }); } finally { health.stop(); await server.close(); }
}

test('GET /api/gateway/config says what is claimed, what is invented and that there is no live path', () => withServer(async ({ get }) => {
  const c = await (await get('/api/gateway/config')).json();
  assert.match(c.status, /Ping release claim \(2026-11-02\), UNVERIFIED on our tenant/);
  assert.match(c.mode, /no live path/i);
  assert.deepEqual(Object.keys(c.callers).sort(), ['analyst', 'viewer']);
  assert.equal(c.tasks.length, 7);
  assert.deepEqual(c.members.map((m) => m.key), ['bank', 'hostile']);
  assert.equal(c.members[0].tools.length, 2);
  assert.equal(c.members[1].tools.length, 13);
  assert.deepEqual(c.defaults.capAllow.length, 5);
  assert.deepEqual(c.aliasPresets, ['hostile', 'bank', 'vendor', 'ledger', 'files', 'mail']);
  assert.deepEqual(c.defaults.aliases, { bank: 'bank', hostile: 'hostile' });
  assert.match(c.tags.swagger, /console swagger name, 2026-10-31, schema only/);
}));

test('POST /api/gateway/run: real counts, side by side, for both callers and both lists', () => withServer(async ({ post }) => {
  const later = await (await post('/api/gateway/run', {})).json();
  assert.deepEqual([later.direct.count, later.gateway.count, later.gateway.audit.hiddenCount, later.gateway.audit.memberHops, later.listNumber], [15, 4, 11, 2, 2]);
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
  assert.equal((await run({ aliases: { hostile: 'vendor' } })).count, 2);
  const bankDown = await run({ reachable: { bank: false } });
  assert.deepEqual([bankDown.unreachable, bankDown.count], [['bank'], 2]);
  assert.equal((await run({ aliases: { bank: 'ledger' }, entitled: ['ledger__get_balance'], capAllow: null })).count, 1);
}));

test('bad requests get a 400 with a fixed message and nothing typed is echoed', () => withServer(async ({ post }) => {
  const bodies = [
    { stage: SECRET }, { caller: SECRET }, { task: SECRET }, { [SECRET]: 1 }, { policy: { [SECRET]: 1 } },
    { policy: { entitled: [`${SECRET} !`] } }, { policy: { aliases: { bank: SECRET } } }, { policy: { aliases: { bank: 'hostile' } } }, { policy: { aliases: { bank: 'ext' } } },
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
      // a typed ToolFilter entry is not echoed either, in any field of the response
      const filtered = await (await post('/api/gateway/run', { policy: { toolFilter: { bank: [`sk-live-${SECRET}`, 'get_balance'], hostile: [`nonexistent_${SECRET}`] } } })).text();
      assert.ok(!filtered.includes(SECRET));
      assert.equal(JSON.parse(filtered).policy.ignoredEntries, 2);
      assert.ok(JSON.parse(filtered).members.every((m) => !Object.hasOwn(m, 'toolFilter')), 'no member carries a ToolFilter back');
      // names that match real tools are not echoed outside the demo audit view either
      const named = JSON.parse(await (await post('/api/gateway/run', { policy: { toolFilter: { hostile: ['send_email', 'get_weather'] } } })).text());
      const { audit, ...callerSide } = named.gateway;
      assert.ok(!JSON.stringify({ ...named, direct: { ...named.direct, tools: null }, gateway: callerSide }).includes('send_email'));
      assert.ok(audit.hidden.some((h) => h.name === 'hostile__send_email'));
      // a refused call tells the caller one thing, whether the tool is hidden or missing; the reason is the audit field
      const attempts = JSON.parse(await (await post('/api/gateway/run', {})).text()).gateway.attempts;
      assert.ok(attempts.every((a) => !Object.hasOwn(a, 'auditReason') && !Object.hasOwn(a, 'reason')), 'the caller-side attempts carry no reason');
      for (const b of [{ policy: { entitled: [`${SECRET} !`] } }, { caller: SECRET }]) assert.ok(!(await (await post('/api/gateway/run', b)).text()).includes(SECRET));
    });
  } finally { Object.assign(console, real); }
  assert.ok(!lines.join('\n').includes(SECRET));
});

test('token-shaped strings in the old alias position and in every other field never come back, in any response or on the page', () => withServer(async ({ post, base, get }) => {
  const leaks = ['ghp-aliasleak1234abcd', 'sk-live-aliasleak1234', 'eyJhbGciOiJub25lIn0.aliasleak1234.sig', 'AKIAALIASLEAK123456'];
  const seen = [];
  for (const leak of leaks) {
    const bodies = [
      { policy: { aliases: { bank: leak } } }, { policy: { aliases: { hostile: leak } } }, { policy: { aliases: { [leak]: 'bank' } } }, { policy: { aliases: { bank: [leak] } } },
      { policy: { toolFilter: { bank: [leak], hostile: [leak, 'get_weather'] } } }, { policy: { entitled: [leak, `hostile__${leak}`, 'bank__get_balance'], capAllow: [leak] } },
      { policy: { reachable: { bank: leak } } }, { policy: { [leak]: 1 } }, { [leak]: 1 }, { stage: leak }, { caller: leak }, { task: leak },
    ];
    for (const b of bodies) {
      const r = await post('/api/gateway/run', b);
      const text = await r.text();
      assert.ok(!text.includes(leak.slice(0, 12)), `no response field repeats the input: ${JSON.stringify(b).slice(0, 30)}`);
      if (r.status === 400 && JSON.stringify(b).includes('"aliases"') && !JSON.stringify(b).includes(`"${leak}":`)) seen.push(JSON.parse(text).message);
    }
    for (const q of [`/api/gateway/config?alias=${leak}`, `/api/gateway/run?alias=${leak}`]) assert.ok(!(await (await get(q)).text()).includes(leak.slice(0, 12)));
  }
  assert.equal(new Set(seen).size, 1, 'one generic 400 for an alias outside the fixed list');
  assert.ok(seen.length >= leaks.length * 3);
  const page = await (await fetch(base + '/')).text();
  for (const leak of leaks) assert.ok(!page.includes(leak.slice(0, 12)));
}));

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
