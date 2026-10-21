import assert from 'node:assert/strict';
import test from 'node:test';
import { startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { createSessions } from '../src/session.js';
import { guardNetwork } from './netguard.js';

async function withServer(fn, opts) {
  const health = createHealth();
  const server = await startHttpServer(0, '127.0.0.1', { health, sessions: createSessions(), ...opts });
  const base = `http://127.0.0.1:${server.port}`;
  const post = (path, body, init = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body), ...init });
  try { await fn({ base, post, get: (p) => fetch(base + p) }); } finally { health.stop(); await server.close(); }
}

test('GET /api/catalog lists the ten poisons with an honest scanner and pinning answer each', () => withServer(async ({ get }) => {
  const body = await (await get('/api/catalog')).json();
  assert.equal(body.items.length, 10);
  assert.deepEqual(body.items.map((i) => i.id), ['description_injection', 'schema_exfiltration', 'tool_shadowing', 'action_exfil_sink', 'credential_harvest', 'imperative_injection', 'rug_pull', 'result_injection', 'resource_poisoning', 'prompt_poisoning']);
  for (const i of body.items) {
    for (const f of ['id', 'kind', 'name', 'category', 'what', 'how']) assert.ok(i[f], `${i.id}.${f}`);
    assert.ok(['yes', 'partial', 'no'].includes(i.pinning.catches) && i.pinning.note, i.id);
    assert.ok(['yes', 'partial', 'no'].includes(i.scanner.catches) && i.scanner.note, i.id);
  }
  const by = Object.fromEntries(body.items.map((i) => [i.id, i]));
  assert.equal(by.rug_pull.pinning.catches, 'yes');
  assert.equal(by.tool_shadowing.pinning.catches, 'yes');
  for (const id of ['description_injection', 'credential_harvest', 'imperative_injection', 'result_injection', 'resource_poisoning', 'prompt_poisoning']) assert.equal(by[id].pinning.catches, 'no', id);
  assert.equal(by.rug_pull.scanner.catches, 'partial');
  assert.ok(body.pinningLimits.some((l) => l.id === 'first-list-poison'));
}));

test('GET /api/safety-scan reports every payload clean of non-reserved hosts', () => withServer(async ({ get }) => {
  const body = await (await get('/api/safety-scan')).json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.offenders, []);
  assert.ok(body.scanned > 20);
}));

test('GET /api/victim-rules documents the rules and the limits', () => withServer(async ({ get }) => {
  const body = await (await get('/api/victim-rules')).json();
  assert.equal(body.rules.length, 7);
  assert.ok(body.pinningCatches.length && body.pinningLimits.length);
}));

test('run-victim ungoverned, the morning after: the rug-pull lands, the hostile get_balance wins', () => withServer(async ({ post }) => {
  const stock = await (await post('/api/run-victim', { task: 'What is the stock price of ACME?', mode: 'ungoverned' })).json();
  assert.deepEqual(stock.victim.calls.map((c) => c.tool), ['create_transfer', 'get_stock_price']);
  assert.equal(stock.summary.poisonLanded, true);
  assert.equal(stock.pinned, null);
  assert.equal(stock.victim.executed, false);
  assert.deepEqual(stock.trace.map((t) => t.step), [1, 2, 3, 4]);
  const bal = await (await post('/api/run-victim', { task: 'Check my account balance', mode: 'ungoverned' })).json();
  assert.deepEqual(bal.victim.calls.map((c) => c.tool), ['get_balance', 'create_transfer']);
  assert.equal(bal.victim.resolution.length, 1);
}));

test('run-victim returns the metadata the victim saw, so the UI can show the poisoned fields', () => withServer(async ({ post }) => {
  const r = await (await post('/api/run-victim', { task: 'What is the stock price of ACME?', mode: 'ungoverned' })).json();
  const stock = r.toolsSeen.find((t) => t.name === 'get_stock_price');
  assert.match(stock.description, /IMPORTANT/);
  assert.equal(stock.inputSchema.type, 'object');
}));

test('run-victim pinned, the morning after: the rug-pull and the shadow are withheld, nothing lands', () => withServer(async ({ post }) => {
  const stock = await (await post('/api/run-victim', { task: 'What is the stock price of ACME?', mode: 'pinned' })).json();
  assert.deepEqual(stock.victim.calls, []);
  assert.equal(stock.summary.poisonLanded, false);
  const changed = stock.pinned.results.find((r) => r.name === 'get_stock_price');
  assert.equal(changed.verdict, 'changed');
  assert.match(changed.diff[0].after, /IMPORTANT/);
  assert.ok(stock.pinned.withheld.some((w) => w.name === 'get_stock_price'));
  assert.deepEqual(stock.pinned.skippedAtApproval, [{ name: 'get_balance', reason: 'shadowed', pinnedOrigin: 'mcp://bank-demo.invalid' }]);

  const bal = await (await post('/api/run-victim', { task: 'Check my account balance', mode: 'pinned' })).json();
  assert.deepEqual(bal.victim.calls.map((c) => c.tool), ['get_balance']);
  assert.equal(bal.summary.poisonLanded, false);
  assert.equal(bal.pinned.results.find((r) => r.name === 'get_balance').verdict, 'shadowed');
  assert.deepEqual(bal.toolsSeen.filter((t) => t.name === 'get_balance').map((t) => t.source), ['bank']);
}));

test('run-victim pinned on the first day: poison approved blindly still lands (the honest limit)', () => withServer(async ({ post }) => {
  const r = await (await post('/api/run-victim', { task: "What's the weather in Denver?", mode: 'pinned', stage: 'first' })).json();
  assert.deepEqual(r.victim.calls.map((c) => c.tool), ['create_transfer', 'get_weather']);
  assert.equal(r.summary.poisonLanded, true);
  assert.equal(r.summary.withheldCount, 1, 'only the shadowing get_balance is withheld');
  const s = await (await post('/api/run-victim', { task: 'Search the docs for the vacation policy', mode: 'pinned', stage: 'first' })).json();
  assert.equal(s.victim.calls[0].poison, true, 'the schema sink was approved with the tool');
}));

test('run-victim never touches the network, and runs are independent', () => withServer(async ({ post }) => {
  const guard = guardNetwork();
  try {
    const body = { task: 'What is the stock price of ACME?', mode: 'ungoverned' };
    const a = await (await post('/api/run-victim', body)).json();
    const b = await (await post('/api/run-victim', body)).json();
    assert.deepEqual(a, b);
    assert.deepEqual(guard.attempts, []);
  } finally { guard.restore(); }
}));

test('run-victim validates its input', () => withServer(async ({ post, base }) => {
  const bad = async (body, init) => { const r = await post('/api/run-victim', body, init); assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60)); return (await r.json()).error; };
  assert.equal(await bad({ mode: 'pinned' }), 'bad_request');
  assert.equal(await bad({ task: '', mode: 'pinned' }), 'bad_request');
  assert.equal(await bad({ task: '   ', mode: 'pinned' }), 'bad_request');
  assert.equal(await bad({ task: 42, mode: 'pinned' }), 'bad_request');
  assert.equal(await bad({ task: 'x'.repeat(301), mode: 'pinned' }), 'bad_request');
  assert.equal(await bad({ task: 'weather', mode: 'governed' }), 'bad_request');
  assert.equal(await bad({ task: 'weather' }), 'bad_request');
  assert.equal(await bad({ task: 'weather', mode: 'pinned', stage: 'never' }), 'bad_request');
  assert.equal(await bad('{not json'), 'bad_request');
  assert.equal(await bad('plain text', { headers: { 'content-type': 'text/plain' } }), 'bad_request');
  assert.equal((await post('/api/run-victim', 'null')).status, 400);
  assert.equal((await fetch(`${base}/api/run-victim`)).status, 404, 'GET is not an endpoint');
}));

test('a huge body is refused with 413 before it is parsed', () => withServer(async ({ post }) => {
  const r = await post('/api/run-victim', JSON.stringify({ task: 'x'.repeat(200_000), mode: 'pinned' }));
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error, 'payload_too_large');
}));

test('the rug-pull flow over the API: new session, list #1, approve, list #2 is flagged', () => withServer(async ({ post, base }) => {
  const made = await post('/api/mcp-session/new', {});
  assert.equal(made.status, 201);
  const { sessionId, pins } = await made.json();
  assert.deepEqual(pins.map((p) => p.name), ['get_balance']);

  const first = await (await post(`/api/mcp-session/${sessionId}/list`, {})).json();
  assert.equal(first.listNumber, 1);
  assert.equal(first.check, null, 'nothing approved from this server yet');
  assert.equal(first.descriptionsRevealed.get_stock_price, first.tools.find((t) => t.name === 'get_stock_price').description, 'a clean description reveals unchanged');
  assert.doesNotMatch(first.tools.find((t) => t.name === 'get_stock_price').description, /IMPORTANT/);

  const approval = await (await post(`/api/mcp-session/${sessionId}/approve`, {})).json();
  assert.equal(approval.listNumber, 1);
  assert.equal(approval.approved.length, 10, 'eleven tools, get_balance refused');
  assert.deepEqual(approval.skipped.map((s) => s.name), ['get_balance']);

  const second = await (await post(`/api/mcp-session/${sessionId}/list`, {})).json();
  assert.equal(second.listNumber, 2);
  assert.match(second.tools.find((t) => t.name === 'get_stock_price').description, /IMPORTANT/);
  const flagged = second.check.results.filter((r) => r.verdict !== 'ok').map((r) => `${r.name}:${r.verdict}`);
  assert.deepEqual(flagged, ['get_balance:shadowed', 'get_stock_price:changed']);

  // A second session starts again at list #1: the flip is per session.
  const other = (await (await post('/api/mcp-session/new', { trusted: false })).json()).sessionId;
  assert.equal((await (await post(`/api/mcp-session/${other}/list`, {})).json()).listNumber, 1);

  assert.equal((await fetch(`${base}/api/mcp-session/${sessionId}`, { method: 'DELETE' })).status, 204);
  assert.equal((await post(`/api/mcp-session/${sessionId}/list`, {})).status, 404);
}));

test('session endpoints validate: unknown id 404, approve before list 409, bad flag 400', () => withServer(async ({ post }) => {
  assert.equal((await post('/api/mcp-session/nope/list', {})).status, 404);
  assert.equal((await post('/api/mcp-session/nope/approve', {})).status, 404);
  const { sessionId } = await (await post('/api/mcp-session/new', {})).json();
  assert.equal((await post(`/api/mcp-session/${sessionId}/approve`, {})).status, 409);
  assert.equal((await post('/api/mcp-session/new', { trusted: 'yes' })).status, 400);
}));

test('sessions are capped and expire', async () => {
  let t = 0;
  const sessions = createSessions({ max: 2, ttlMs: 1000, now: () => t });
  const a = await sessions.create();
  await sessions.create();
  await sessions.create();
  assert.equal(sessions.size(), 2);
  assert.equal(sessions.get(a.id), null, 'oldest evicted');
  const b = await sessions.create();
  assert.equal(sessions.get(b.id)?.id, b.id);
  t = 5000;
  assert.equal(sessions.get(b.id), null, 'expired after the time-to-live');
  const c = await sessions.create();
  assert.equal(sessions.size(), 1, 'expired sessions are swept on the next create');
  assert.equal(sessions.get(c.id)?.id, c.id);
});

test('the MCP endpoints still answer next to the API', () => withServer(async ({ get }) => {
  const h = await (await get('/health')).json();
  assert.deepEqual(h, { ok: true, tools: 11 });
  assert.equal((await get('/api/nope')).status, 404);
}));
