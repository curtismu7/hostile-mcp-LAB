import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startHttpServer } from '../src/app.js';
import { createPinnedClient } from '../src/pinning.js';
import { SCAN_MAX_DEPTH, SCAN_MAX_NODES, findSinks, hostOfValue, inspectValue, scanSinks } from '../src/sinks.js';
import { runVictim } from '../src/victim.js';

const ORIGIN = 'mcp://server-a.invalid';
const TIME_BOUND_MS = 3000;

// ---- invisible characters before, inside or around a host --------------------------------------------------------

const INVISIBLES = {
  ZWSP: '​', ZWNJ: '‌', BOM: '﻿', 'word joiner': '⁠', 'soft hyphen': '­',
  'RLO bidi override': '‮', 'LRI bidi isolate': '⁦', 'RLM mark': '‏', 'tag character': '\u{E0041}', 'null byte': '\u0000',
};

for (const [name, ch] of Object.entries(INVISIBLES)) {
  test(`an invisible character (${name}) before a URL does not hide the sink, and the finding says so`, () => {
    const hit = inspectValue(`${ch}https://evil.invalid/x`);
    assert.equal(hit.host, 'evil.invalid');
    assert.equal(hit.invisible, true);
    const sinks = findSinks({ type: 'object', properties: { u: { type: 'string', default: `${ch}https://evil.invalid/x` } } }, ORIGIN);
    assert.equal(sinks.length, 1);
    assert.equal(sinks[0].host, 'evil.invalid');
    assert.equal(sinks[0].invisible, true);
  });
}

test('invisible characters inside the host, in an email, in a protocol-relative value and in a pattern are all caught', () => {
  assert.equal(hostOfValue('https://ev​il.invalid'), 'evil.invalid');
  assert.equal(hostOfValue('​bob@evil.invalid'), 'evil.invalid');
  assert.equal(hostOfValue('﻿//evil.invalid/x'), 'evil.invalid');
  const s = findSinks({ pattern: '​https:\\/\\/evil\\.invalid' }, ORIGIN);
  assert.deepEqual(s.map((x) => [x.host, x.invisible]), [['evil.invalid', true]]);
});

test('fullwidth and ideographic look-alikes fold to the real host (NFKC and U+3002)', () => {
  assert.equal(hostOfValue('https://evil．invalid/x'), 'evil.invalid', 'fullwidth full stop U+FF0E');
  assert.equal(hostOfValue('https://evil。invalid/x'), 'evil.invalid', 'ideographic full stop U+3002');
  assert.equal(hostOfValue('https://evil｡invalid/x'), 'evil.invalid', 'halfwidth ideographic full stop U+FF61');
  assert.equal(hostOfValue('ｈｔｔｐｓ：／／evil.invalid'), 'evil.invalid', 'fully fullwidth scheme');
  assert.equal(hostOfValue('https://ｅvil.invalid'), 'evil.invalid', 'fullwidth letter');
});

test('a clean value carries no invisible flag, and an invisible character in the approved host is not a sink', () => {
  assert.equal(inspectValue('https://evil.invalid').invisible, false);
  assert.equal(findSinks({ default: '​https://server-a.invalid/x' }, ORIGIN).length, 0);
  assert.equal(hostOfValue('plain text'), null);
  assert.equal(hostOfValue('​​'), null);
});

// ---- hostile shapes: deep, wide, cyclic -------------------------------------------------------------------------

const deep = (n, leaf = { type: 'string' }) => { let s = leaf; for (let i = 0; i < n; i++) s = { type: 'object', properties: { a: s } }; return s; };
const wide = (n) => { const props = {}; for (let i = 0; i < n; i++) props[`k${i}`] = { type: 'string' }; return { type: 'object', properties: props }; };
const cyclicLooking = () => ({
  $id: 'root', type: 'object',
  properties: { self: { $ref: '#' }, loop: { $ref: '#/properties/loop' } },
  $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } },
  anyOf: [{ $ref: '#' }],
});
const trulyCyclic = () => { const o = { type: 'object', properties: {} }; o.properties.me = o; return o; };

const mkTool = (inputSchema) => ({ name: 'get_stock_price', description: 'Get the price.', inputSchema });
const timed = (fn) => { const t = Date.now(); const out = fn(); assert.ok(Date.now() - t < TIME_BOUND_MS, `took ${Date.now() - t} ms`); return out; };

const SHAPES = {
  '5000 levels deep': () => deep(5000),
  '200000 levels deep': () => deep(200000),
  '100000 keys wide': () => wide(100000),
  'cyclic-looking $ref JSON': cyclicLooking,
};

test('scanSinks stops at its budget and flags truncation instead of throwing', () => {
  assert.equal(scanSinks(deep(5000), ORIGIN).truncated, true);
  assert.equal(scanSinks(wide(100000), ORIGIN).truncated, true);
  assert.equal(scanSinks(trulyCyclic(), ORIGIN).truncated, true, 'a real object cycle ends at the depth budget');
  assert.equal(scanSinks(cyclicLooking(), ORIGIN).truncated, false);
  assert.equal(scanSinks(deep(10), ORIGIN).truncated, false);
  assert.ok(SCAN_MAX_DEPTH >= 32 && SCAN_MAX_NODES >= 1000, 'the budget stays above any real schema');
});

test('a sink inside the budget is still found next to a truncated region', () => {
  const schema = { type: 'object', properties: { u: { type: 'string', default: 'https://evil.invalid' }, d: deep(5000) } };
  const r = scanSinks(schema, ORIGIN);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.sinks.map((s) => s.host), ['evil.invalid']);
});

for (const [name, make] of Object.entries(SHAPES)) {
  test(`pinned client approve() and check() never throw on a schema ${name}, and flag the scan as truncated when it was`, () => {
    const schema = make();
    const client = createPinnedClient();
    const approved = timed(() => client.approve([mkTool(schema)], { origin: ORIGIN }));
    assert.equal(approved.approved.length, 1);
    const same = timed(() => client.check([mkTool(schema)], { origin: ORIGIN }));
    assert.equal(same.results[0].verdict, 'ok');
    // a later change to a hostile schema: still hashed in full, so still reported, with a bounded diff
    const changed = mkTool(deep(5000, { type: 'number' }));
    const client2 = createPinnedClient();
    client2.approve([mkTool(deep(5000))], { origin: ORIGIN });
    const later = timed(() => client2.check([changed], { origin: ORIGIN }));
    assert.equal(later.results[0].verdict, 'changed');
    assert.equal(later.results[0].scanTruncated, true);
    assert.ok(later.results[0].diff.length >= 1);
    assert.ok(JSON.stringify(later).length < 100000, 'the response stays small');
  });

  test(`victim run never throws on a schema ${name}`, () => {
    const out = timed(() => runVictim({ task: 'What is the stock price of ACME?', tools: [mkTool(make())], origin: ORIGIN }));
    assert.equal(out.selected, 'get_stock_price');
    if (name !== 'cyclic-looking $ref JSON') assert.ok(out.notes.some((n) => /scan budget/.test(n)), 'the victim says the scan was cut short');
  });
}

test('a hash of a deeply nested tool is stable and distinguishes a change at the bottom', () => {
  const a = createPinnedClient(); const b = createPinnedClient();
  a.approve([mkTool(deep(5000))], { origin: ORIGIN });
  b.approve([mkTool(deep(5000))], { origin: ORIGIN });
  assert.equal(a.pins()[0].sha256, b.pins()[0].sha256);
  b.approve([mkTool(deep(5000, { type: 'number' }))], { origin: ORIGIN });
  assert.notEqual(a.pins()[0].sha256, b.pins()[0].sha256);
});

test('the API answers with a result or a clean 4xx within the time bound under hostile inputs', async () => {
  const srv = await startHttpServer(0, '127.0.0.1');
  try {
    const post = (path, body, raw) => fetch(`${srv.url}api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
    const cases = [
      ['invisible-padded task', () => post('/run-victim', { task: `${'​'.repeat(100)}stock price of ACME`, mode: 'pinned' })],
      ['deeply nested JSON body', () => post('/run-victim', null, '['.repeat(5000) + ']'.repeat(5000))],
      ['deeply nested task object', () => post('/run-victim', null, `{"task":${'['.repeat(5000)}${']'.repeat(5000)},"mode":"pinned"}`)],
      ['wide body', () => post('/run-victim', null, JSON.stringify({ task: 'x', mode: 'pinned', ...Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, 1])) }))],
    ];
    for (const [name, call] of cases) {
      const t = Date.now();
      const r = await call();
      assert.ok(Date.now() - t < TIME_BOUND_MS, `${name} took too long`);
      assert.ok(r.status === 200 || (r.status >= 400 && r.status < 500), `${name}: status ${r.status}`);
    }
    const ok = await (await cases[0][1]()).json();
    assert.ok(ok.victim && ok.summary, 'a result, not an error');
  } finally { await srv.close(); }
});

// ---- the test script keeps its explicit glob --------------------------------------------------------------------

test('server/package.json pins the explicit node --test glob (a bare `node --test` also walks node_modules and fixtures)', () => {
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  assert.equal(pkg.scripts.test, 'node --test test/*.test.js');
  assert.notEqual(pkg.scripts.test.trim(), 'node --test');
});
