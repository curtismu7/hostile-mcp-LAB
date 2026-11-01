// Entitlement-aware discovery and the aggregate policy cap, simulated in process. Every Ping product claim modelled here
// is a release claim (2026-11-02), UNVERIFIED on our tenant. The assertions live in gateway-checks.js so the mutation
// test can run the same ones against mutated source.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as gateway from '../src/gateway.js';
import * as scenario from '../src/gateway-scenario.js';
import { BANK_BALANCE, CALLERS, DEFAULT_CAP, SIMULATED_TOOLS, hostileCatalog } from '../src/gateway-fixtures.js';
import { BANK_TOOLS, createSession } from '../src/session.js';
import { currentTools } from '../src/mcp/hostile.js';
import { CHECKS, SCENARIO_CHECKS } from './gateway-checks.js';

for (const c of CHECKS) test(`gateway: ${c.id} (${c.row})`, () => c.run(gateway));
const mod = { ...scenario };
for (const c of SCENARIO_CHECKS) test(`scenario: ${c.id} (${c.row})`, () => c.run(mod));

test('the fixtures are not hard-coded stand-ins: they match what the real server and session serve', async () => {
  assert.deepEqual(hostileCatalog(1), currentTools(1));
  assert.deepEqual(hostileCatalog(2), currentTools(2));
  assert.deepEqual([BANK_BALANCE], BANK_TOOLS);
  const session = await createSession({ trusted: false });
  try {
    assert.deepEqual((await session.list()).tools, hostileCatalog(1));
    assert.deepEqual((await session.list()).tools, hostileCatalog(2));
  } finally { await session.close(); }
});

test('the simulated tools are labelled simulated: the real server does not serve them', () => {
  const real = new Set(currentTools(2).map((t) => t.name));
  assert.deepEqual(SIMULATED_TOOLS.map((t) => t.name).filter((n) => real.has(n)), []);
  assert.equal(SIMULATED_TOOLS.length, 3);
});

test('the default policy is consistent with the callers and the cap', () => {
  const d = scenario.defaultPolicy('analyst');
  assert.deepEqual(d.entitled, [...CALLERS.analyst.entitled]);
  assert.deepEqual(d.capAllow, [...DEFAULT_CAP]);
  assert.deepEqual(Object.keys(CALLERS).sort(), ['analyst', 'viewer']);
});

test('every claim is tagged, and the swagger names are exactly the four that exist', () => {
  assert.deepEqual(Object.keys(gateway.TAGS), ['swagger', 'deck', 'invented', 'reading']);
  assert.match(gateway.TAGS.swagger, /console swagger name, 2026-10-31, schema only/);
  assert.match(gateway.TAGS.deck, /UNVERIFIED on our tenant/);
  const src = JSON.stringify(gateway.GATEWAY_LIMITS);
  assert.match(src, /UNVERIFIED on our tenant/);
  assert.match(src, /v1\.261030/);
});

test('gateway.js has no imports, so the mutation test can load a mutated copy anywhere', async () => {
  const fs = await import('node:fs');
  const text = fs.readFileSync(new URL('../src/gateway.js', import.meta.url), 'utf8');
  assert.doesNotMatch(text, /^\s*import\s/m);
  assert.doesNotMatch(text, /\bfetch\s*\(|Date\.now|Math\.random|process\.env|require\(/);
});
