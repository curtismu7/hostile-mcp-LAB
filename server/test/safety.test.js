// Safety rules for a hostile server: loopback bind, reserved-only hosts in every payload, no outbound request, inert stubs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startHttpServer } from '../src/app.js';
import { buildServer, createListState } from '../src/mcp/hostile.js';
import { ACTION_TOOLS, callResultText } from '../src/mcp/tools.js';
import { assertBindAllowed, bindHost, isLoopbackHost, isReservedHost, payloadCorpus, scanHosts, scanPayloads } from '../src/safety.js';
import { guardNetwork } from './netguard.js';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test('binds loopback by default and refuses another address without HOSTILE_BIND', async () => {
  assert.equal(bindHost({}), '127.0.0.1');
  assert.equal(bindHost({ HOSTILE_BIND: '0.0.0.0' }), '0.0.0.0');
  for (const h of ['127.0.0.1', '::1', 'localhost', '127.5.5.5']) assert.equal(isLoopbackHost(h), true, h);
  for (const h of ['0.0.0.0', '192.168.1.5', '::', 'example.com']) assert.equal(isLoopbackHost(h), false, h);
  assert.throws(() => assertBindAllowed('0.0.0.0', {}), /loopback only/);
  assert.equal(assertBindAllowed('0.0.0.0', { HOSTILE_BIND: '0.0.0.0' }), '0.0.0.0');
  const saved = process.env.HOSTILE_BIND;
  delete process.env.HOSTILE_BIND;
  try { await assert.rejects(async () => startHttpServer(0, '0.0.0.0'), /loopback only/); } finally { if (saved) process.env.HOSTILE_BIND = saved; }
});

test('a started server is actually listening on loopback only', async () => {
  const saved = process.env.HOSTILE_BIND;
  delete process.env.HOSTILE_BIND;
  const server = await startHttpServer(0);
  try {
    const lan = Object.values((await import('node:os')).networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4');
    if (lan) await assert.rejects(fetch(`http://${lan.address}:${server.port}/health`), 'not reachable on the LAN address');
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/health`)).status, 200);
  } finally { await server.close(); if (saved) process.env.HOSTILE_BIND = saved; }
});

test('reserved host rules', () => {
  for (const h of ['attacker.example', 'collect.hostile.invalid', 'example.com', 'example.org', 'example.net', 'x.example', 'a.b.invalid']) assert.equal(isReservedHost(h), true, h);
  for (const h of ['evil.example.com', 'a.example.org', 'www.example.net', 'evil.com', 'example.com.evil.net', 'notexample.com', 'localhost', '10.0.0.1']) assert.equal(isReservedHost(h), false, h);
});

test('the host scanner finds real hosts, IPs and emails (so a clean result means something)', () => {
  assert.deepEqual(scanHosts('send to https://collector.real-host.net/x?y=1'), ['collector.real-host.net']);
  assert.deepEqual(scanHosts('mail ops@leak.org now'), ['leak.org']);
  assert.deepEqual(scanHosts('beacon 203.0.113.9 and http://198.51.100.7:8080/p'), ['198.51.100.7', '203.0.113.9']);
  assert.deepEqual(scanHosts('http://intranet/admin'), ['intranet']);
  assert.deepEqual(scanHosts('see docs.vendor.io for details'), ['docs.vendor.io']);
  assert.deepEqual(scanHosts('https://attacker.example/collect and archive@attacker.example'), []);
});

test('every payload names only reserved hosts', () => {
  const corpus = payloadCorpus();
  assert.ok(corpus.length > 25, `corpus covers tools, resources, prompts and results (${corpus.length})`);
  assert.deepEqual(scanPayloads(corpus), []);
});

test('everything the server sends over the wire names only reserved hosts', async () => {
  const server = buildServer(createListState());
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: 'scan', version: '1' }, { capabilities: {} });
  await client.connect(a);
  const seen = [];
  seen.push(await client.listTools(), await client.listTools(), await client.listResources(), await client.listPrompts());
  for (const r of (await client.listResources()).resources) seen.push(await client.readResource({ uri: r.uri }));
  seen.push(await client.getPrompt({ name: 'account_review', arguments: { account_id: 'demo-001' } }));
  for (const t of (await client.listTools()).tools) seen.push(await client.callTool({ name: t.name, arguments: { amount: 1, to: 'external-001', user: 'u', ticket_id: 'T-1' } }));
  assert.deepEqual(scanHosts(JSON.stringify(seen)), []);
  await client.close(); await server.close();
});

test('the server makes no outbound request: network blocked while every tool, resource and prompt is exercised', async () => {
  const guard = guardNetwork();
  try {
    const server = await startHttpServer(0);
    const { Client: C } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new C({ name: 'v', version: '1' }, { capabilities: {} });
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    for (const t of (await client.listTools()).tools) await client.callTool({ name: t.name, arguments: { amount: 1, to: 'external-001', user: 'u', callback_url: 'https://attacker.example/collect' } });
    await client.readResource({ uri: 'mcp://hostile/account-verification' });
    await client.getPrompt({ name: 'account_review', arguments: { account_id: 'a' } });
    await client.close(); await server.close();
    assert.deepEqual(guard.attempts, [], 'no non-loopback socket, DNS lookup or fetch');
  } finally { guard.restore(); }
});

test('the guard itself works: an outbound fetch is blocked and recorded', async () => {
  const guard = guardNetwork();
  try {
    await assert.rejects(fetch('https://attacker.example/collect'), /network blocked/);
    assert.deepEqual(guard.attempts, ['fetch:attacker.example']);
  } finally { guard.restore(); }
});

test('server source has no outbound code path', () => {
  const banned = /\bfetch\s*\(|node:https?['"]|node:net['"]|node:tls['"]|node:dns['"]|node:child_process['"]|undici|XMLHttpRequest|WebSocket|http\.request|https\.request|ClientTransport/;
  const offenders = walk(SRC).filter((f) => f.endsWith('.js') && banned.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(SRC, f)), []);
});

test('action tools are inert stubs: fixed text, no file, process or network access', async () => {
  for (const f of ['mcp/tools.js']) {
    const src = fs.readFileSync(path.join(SRC, f), 'utf8');
    assert.doesNotMatch(src, /node:fs|child_process|writeFile|appendFile|process\.env|\bimport\s*\(/);
  }
  for (const t of ACTION_TOOLS) {
    const out = callResultText(t.name, { amount: 9, to: 'external-001', user: 'mallory', confirm: true });
    assert.match(out, /DEMO STUB/, t.name);
    assert.equal(out, callResultText(t.name, { amount: 9, to: 'external-001', user: 'mallory', confirm: true }), 'deterministic');
  }
  assert.doesNotThrow(() => callResultText('create_transfer', undefined));
});
