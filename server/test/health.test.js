import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { allPassed, runChecks } from '../src/doctor.js';
import { mockOnly } from '../src/mockonly.js';
import { createHealth } from '../src/health.js';

async function serve(health, fn) {
  const app = express();
  app.use('/api/health', health.router);
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  try { await fn(`http://127.0.0.1:${s.address().port}/api/health`); } finally { health.stop(); s.close(); }
}

test('demo-health/1: exact fields, public, no-store', async () => {
  await serve(createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks, allPassed, mockOnly, now: () => new Date('2026-10-21T12:00:00.000Z') }), async (url) => {
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['at', 'demo', 'runtime', 'schema', 'state']);
    assert.deepEqual(Object.keys(body.demo).sort(), ['id', 'name', 'version']);
    assert.equal(body.schema, 'demo-health/1');
    assert.equal(body.at, '2026-10-21T12:00:00.000Z');
    assert.equal(body.state, 'ready');
    assert.equal(body.runtime, 'offline');
    assert.equal(body.demo.id, 'hostile-mcp');
    assert.ok(body.demo.id.length <= 64 && body.demo.name.length <= 80 && body.demo.version.length <= 32);
    assert.ok(JSON.stringify(body).length < 4096);
  });
});

test('GET only', async () => {
  await serve(createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks, allPassed, mockOnly }), async (url) => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const r = await fetch(url, { method });
      assert.equal(r.status, 405, method);
      assert.equal(r.headers.get('allow'), 'GET');
    }
  });
});

test('the state is cached: requests never run the checks, a refresh does', async () => {
  let runs = 0;
  let ok = true;
  const runChecks2 = () => { runs += 1; return [{ id: 'x', level: ok ? 'pass' : 'fail', detail: '' }]; };
  const health = createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks: runChecks2, allPassed, mockOnly });
  assert.equal(runs, 1, 'one check at startup');
  await serve(health, async (url) => {
    const before = runs;
    for (let i = 0; i < 5; i++) await fetch(url);
    assert.equal(runs, before, 'five requests, no extra checks');
    assert.equal((await (await fetch(url)).json()).state, 'ready');
    ok = false;
    health.refresh(); // what the 60 s timer calls (next test)
    assert.equal(runs, before + 1);
    assert.equal((await (await fetch(url)).json()).state, 'broken');
  });
});

test('the background timer is 60 seconds and runs the same refresh', () => {
  let runs = 0;
  const timers = [];
  const real = globalThis.setInterval;
  globalThis.setInterval = (fn, ms) => { timers.push({ fn, ms }); return real(fn, ms); };
  let health;
  try { health = createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks: () => { runs += 1; return []; }, allPassed, mockOnly }); } finally { globalThis.setInterval = real; }
  assert.deepEqual(timers.map((t) => t.ms), [60_000]);
  timers[0].fn();
  assert.equal(runs, 2, 'startup check plus one timer tick');
  health.stop();
});

test('a throwing check reports unknown, not a crash', async () => {
  await serve(createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks: () => { throw new Error('boom'); }, allPassed, mockOnly }), async (url) => {
    assert.equal((await (await fetch(url)).json()).state, 'unknown');
  });
});

test('doctor passes here, reports the HOSTILE_BIND opt-in, and never prints a secret', () => {
  const ok = runChecks({ env: {} });
  assert.ok(allPassed(ok));
  assert.deepEqual(ok.map((c) => c.id), ['node', 'bind', 'payload-hosts', 'outbound']);
  const lanRefused = runChecks({ env: { HOSTILE_BIND: '' } });
  assert.ok(allPassed(lanRefused), 'an empty HOSTILE_BIND is the loopback default');
  const lanOptIn = runChecks({ env: { HOSTILE_BIND: '0.0.0.0' } });
  assert.match(lanOptIn.find((c) => c.id === 'bind').detail, /HOSTILE_BIND opt-in/);
  const withLlm = runChecks({ env: { LLM_URL: 'http://127.0.0.1:1234', SECRET_TOKEN: 'shh-secret-value' } });
  assert.equal(withLlm.find((c) => c.id === 'outbound').level, 'info');
  assert.doesNotMatch(JSON.stringify(withLlm), /shh-secret-value/);
});
