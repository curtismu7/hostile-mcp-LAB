// Behaviour proof: what the ported server puts on the wire is byte-for-byte what the source server did. The hashes were
// taken from the source server (AI-DEMO2 standalone/hostile-mcp-server) over Streamable HTTP with a real SDK client:
// sha256 of JSON.stringify(result), in this order. Any edit to a payload or a handler changes one of them.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../src/app.js';
import { __resetRugPullForTests } from '../src/mcp/hostile.js';

const GOLDEN = {
  list1: 'cf0d498105278ff861d6179ec5d27bf3e5cad67152829aab107106d513264d6c',
  list2: '7c90bd12c3318c8020919dbac1cacfd022bc408e4a196c8c6addda9a12c21c03',
  resources: 'a166f58d52a4e9cf97efce3105b9423f61489772b5bcc338ca9e1b58ddec9955',
  resourceRead: 'dccb9d4dfc5d4d7498ff2c8d6db42879164278b6a2eee7f3752ee289eb66c183',
  prompts: '3240f7963fd1ef2e4f227dba9f248ddf6ba0a18007e7a2b3d380e56733dc367e',
  promptGet: '90a862bd1acd862c7d5102bc35aeb09550bb66b5d95bd08e0b493de4d7be5d7e',
  calls: 'f8414f8ba61456f649a6ea2bbe01b2b038964e7c09a2b76aa8652b2bc6b19a25',
};
const h = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

test('wire output matches the source server byte for byte', async () => {
  __resetRugPullForTests();
  const server = await startHttpServer(0);
  try {
    const c = new Client({ name: 'golden', version: '1' }, { capabilities: {} });
    await c.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    assert.equal(h((await c.listTools()).tools), GOLDEN.list1, 'tools/list #1');
    assert.equal(h((await c.listTools()).tools), GOLDEN.list2, 'tools/list #2');
    assert.equal(h(await c.listResources()), GOLDEN.resources);
    assert.equal(h(await c.readResource({ uri: 'mcp://hostile/account-verification' })), GOLDEN.resourceRead);
    assert.equal(h(await c.listPrompts()), GOLDEN.prompts);
    assert.equal(h(await c.getPrompt({ name: 'account_review', arguments: { account_id: 'demo-001' } })), GOLDEN.promptGet);
    const calls = [];
    for (const [name, args] of [['create_transfer', { amount: 5, to: 'x' }], ['delete_all_records', {}], ['grant_admin', { user: 'u' }], ['read_ticket', { ticket_id: 'T-9' }], ['get_weather', { city: 'D' }]]) {
      calls.push(await c.callTool({ name, arguments: args }));
    }
    assert.equal(h(calls), GOLDEN.calls);
    await c.close();
  } finally { await server.close(); }
});
