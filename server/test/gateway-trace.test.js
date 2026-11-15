// "What Privilege did" for the lab's simulated gateway. There is no live gateway path in this app, so every trace is
// source 'mock' and every decision 'checked'; the assertions are the honesty rule (assertTrace), no secret in the record,
// and that each decision is what gateway.js really computed. The pin test below keeps the vendored files unedited.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as gateway from '../src/gateway.js';
import { CALL_CHECKS, GATEWAY_URL, callExchange } from '../src/gateway-exchanges.js';
import { CALLERS } from '../src/gateway-fixtures.js';
import { parseRequest, runGateway } from '../src/gateway-scenario.js';
import { assertTrace } from '../src/gatewayTrace.js';
import { build, entitledOf } from './gateway-checks.js';

const SECRET = 'SECRET_TOKEN_123';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = (body) => runGateway(parseRequest(body));
const decisionsOf = (ex) => Object.fromEntries(ex.trace.decisions.map((d) => [d.id, d.outcome]));

test('every exchange of a run satisfies the honesty contract: mock, checked, a reserved host, no secret', async () => {
  for (const caller of Object.keys(CALLERS)) for (const stage of ['first', 'later']) {
    const r = await run({ stage, caller, policy: { entitled: [...CALLERS[caller].entitled, `bank__${SECRET}`], capAllow: [`bank__${SECRET}`, 'bank__get_balance'] } });
    const exchanges = r.gateway.audit.trace;
    assert.equal(exchanges.length, 1 + r.gateway.attempts.length);
    assert.deepEqual(exchanges.map((e) => e.step), exchanges.map((_, i) => i + 1));
    for (const ex of exchanges) {
      assert.deepEqual(assertTrace(ex.trace), [], `${caller}/${stage}/${ex.title}`);
      assert.equal(ex.trace.source, 'mock');
      assert.ok(ex.trace.decisions.length > 0 && ex.trace.decisions.every((d) => d.basis === 'checked'));
      assert.equal(new URL(ex.trace.request.url).hostname.endsWith('.invalid'), true);
      assert.equal(ex.trace.request.url, GATEWAY_URL);
    }
    assert.ok(!JSON.stringify(exchanges).includes(SECRET), 'a typed entry is never in the trace');
  }
});

test('the listing exchange: its counts are the reasons gateway.js recorded, and its body is the listing the caller got', async () => {
  const r = await run({ stage: 'later', caller: 'analyst' });
  const [list] = r.gateway.audit.trace;
  const hid = (reason) => r.gateway.audit.hidden.filter((h) => h.reason === reason).length;
  assert.equal(list.trace.request.body.method, 'tools/list');
  assert.deepEqual(list.trace.response.body.result.tools.map((t) => t.name), r.gateway.tools.map((t) => t.name));
  const text = Object.fromEntries(list.trace.decisions.map((d) => [d.id, d.evidence]));
  assert.deepEqual([hid('not-in-toolfilter'), hid('not-entitled'), hid('over-cap')], [0, 10, 1]);
  assert.match(text.entitlement, /left 10 tools out/);
  assert.match(text.cap, /left 1 tool out/);
  assert.match(text.toolfilter, /left no tool out/);
  assert.deepEqual(decisionsOf(list), { reachable: 'pass', names: 'pass', toolfilter: 'pass', entitlement: 'info', cap: 'info' });
  // negative control: a ToolFilter and a down member change the counts, so they are read from the run and not fixed
  const f = await run({ policy: { toolFilter: { hostile: ['get_weather'] }, reachable: { bank: false } } });
  const filtered = f.gateway.audit.trace[0];
  assert.equal(decisionsOf(filtered).toolfilter, 'info');
  assert.equal(decisionsOf(filtered).reachable, 'info');
  assert.match(filtered.trace.decisions.find((d) => d.id === 'reachable').evidence, /1 member is down/);
});

test('each probe call: the refusing decision is the one gateway.call() reported, earlier checks pass, later ones are not reached', async () => {
  const r = await run({ stage: 'later', caller: 'analyst' });
  const calls = r.gateway.audit.trace.slice(1);
  const byName = Object.fromEntries(calls.map((e) => [e.trace.request.body.params.name, e]));
  const order = CALL_CHECKS.map((c) => c.id);
  const expectFailAt = (ex, id) => {
    const d = decisionsOf(ex);
    const at = order.indexOf(id);
    order.forEach((k, i) => assert.equal(d[k], i < at ? 'pass' : i === at ? 'fail' : 'skipped', `${ex.title}: ${k}`));
    assert.equal(d.forward, undefined);
  };
  expectFailAt(byName.hostile__create_transfer, 'entitlement');
  expectFailAt(byName.hostile__bulk_export, 'entitlement');
  expectFailAt(byName.create_transfer, 'prefix');
  expectFailAt(byName.hostile__bank__get_balance, 'entitlement'); // the hostile member really serves a tool with that name (the spoof)
  for (const name of ['bank__get_balance', 'hostile__get_stock_price']) {
    const d = decisionsOf(byName[name]);
    assert.ok(order.every((k) => d[k] === 'pass') && d.forward === 'pass', name);
  }
  // what the caller is told is the same text for a hidden tool and one that does not exist
  const told = (n) => byName[n].trace.response.body.result.content[0].text;
  assert.equal(told('hostile__create_transfer'), 'not available');
  assert.equal(told('hostile__create_transfer'), told('hostile__bulk_export'));
});

test('every way gateway.call() can refuse maps to the check that refused it (read against the real simulation)', () => {
  const cases = [
    ['bad_name', (gw) => gw.call(entitledOf('analyst'), '', {}), 'name'],
    ['unprefixed', (gw) => gw.call(entitledOf('analyst'), 'get_balance', {}), 'prefix'],
    ['unknown_alias', (gw) => gw.call(entitledOf('analyst'), 'nope__get_balance', {}), 'alias'],
    ['member_unreachable', (gw) => gw.call(entitledOf('analyst'), 'hostile__get_weather', {}), 'reachable', { hostileUp: false }],
    ['no_such_tool', (gw) => gw.call(entitledOf('analyst'), 'hostile__nothing_here', {}), 'exists'],
    ['not-in-toolfilter', (gw) => gw.call(entitledOf('analyst'), 'bank__get_balance', {}), 'toolfilter', { bankFilter: ['get_statement'] }],
    ['not-entitled', (gw) => gw.call(entitledOf('viewer'), 'bank__get_statement', {}), 'entitlement'],
    ['over-cap', (gw) => gw.call(entitledOf('analyst'), 'hostile__send_email', {}), 'cap'],
  ];
  for (const [reason, call, id, over] of cases) {
    const gw = build(gateway, over);
    const result = call(gw);
    const entry = gw.audit()[0];
    const ex = callExchange({ step: 2, caller: 'analyst', name: 'x__y', result, reason: entry ? entry.reason : null });
    assert.deepEqual(assertTrace(ex.trace), [], reason);
    const failed = ex.trace.decisions.filter((d) => d.outcome === 'fail');
    assert.deepEqual(failed.map((d) => d.id), [id], reason);
    assert.ok(entry ? entry.reason === reason : result.code === reason, `${reason}: the refusal is the one this case names`);
  }
  assert.throws(() => callExchange({ step: 2, caller: 'analyst', name: 'x', result: { ok: false, code: 'something_new' }, reason: null }), /does not know/);
});

test('vendored gateway-trace files match gateway-trace.sha256 byte for byte (an edited copy fails here)', () => {
  const where = { 'GatewayTrace.jsx': 'web/src/gateway-trace', 'gateway-trace.css': 'web/src/gateway-trace', 'gateway-trace.test.jsx': 'web/src/gateway-trace', 'gatewayTrace.js': 'server/src' };
  const pins = fs.readFileSync(path.join(ROOT, 'web/src/gateway-trace/gateway-trace.sha256'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/));
  assert.deepEqual(pins.map(([, f]) => f).sort(), Object.keys(where).sort());
  for (const [hash, file] of pins) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, where[file], file))).digest('hex');
    assert.equal(actual, hash, `${file} differs from the pin: re-vendor it from AI-DEMO-Standalone shared/gateway-trace, never edit it here`);
  }
});
