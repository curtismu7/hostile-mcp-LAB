// Rule 19: the Mock/Real toggle's API. This app is mock only, so Real is never available and the hosted build (MOCK_ONLY) cannot be switched.
import assert from 'node:assert/strict';
import test from 'node:test';
import { startHttpServer } from '../src/app.js';
import { createHealth } from '../src/health.js';
import { allPassed, runChecks } from '../src/doctor.js';
import { mockOnly } from '../src/mockonly.js';
import { createSessions } from '../src/session.js';

async function withServer(env, fn) {
  const health = createHealth({ demoId: 'hostile-mcp', demoName: 'Hostile MCP', version: '0.1.0', runChecks: () => runChecks({ env }), allPassed, mockOnly, env });
  const server = await startHttpServer(0, '127.0.0.1', { env, health, sessions: createSessions() });
  const base = `http://127.0.0.1:${server.port}`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, json: await r.json() }; };
  const mode = async (body) => { const r = await fetch(`${base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
  try { await fn({ get, mode }); } finally { health.stop(); await server.close(); }
}

test('local: /api/info says Mock with no Real; /api/mode keeps Mock, refuses Real (409) and bad bodies (400)', () => withServer({}, async ({ get, mode }) => {
  const info = (await get('/api/info')).json;
  assert.equal(info.source, 'mock'); assert.equal(info.realAvailable, false); assert.equal(info.hosted, false); assert.equal(info.mode, 'local');
  const keep = await mode({ source: 'mock' });
  assert.equal(keep.status, 200); assert.equal(keep.json.source, 'mock');
  const real = await mode({ source: 'real' });
  assert.equal(real.status, 409); assert.match(real.json.message, /no live version/);
  for (const body of [{}, { source: 'live' }, { source: 'mock', extra: 1 }, []]) assert.equal((await mode(body)).status, 400, JSON.stringify(body));
}));

test('hosted (MOCK_ONLY=1): reports Mock only and refuses every switch (403)', () => withServer({ MOCK_ONLY: '1' }, async ({ get, mode }) => {
  const info = (await get('/api/info')).json;
  assert.equal(info.hosted, true); assert.equal(info.source, 'mock'); assert.equal(info.realAvailable, false); assert.equal(info.mode, 'mock-only');
  assert.equal((await mode({ source: 'real' })).status, 403);
  assert.equal((await mode({ source: 'mock' })).status, 403);
}));
