// An MCP session against the real ported server, over an in-memory transport (no socket, no network). The session has
// its own tools/list counter, so "list #1 (approve), list #2 (compare)" is deterministic and per session. It also owns
// a pinned client, seeded with one tool a person already trusts from another server (so shadowing can be shown).
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer, createListState } from './mcp/hostile.js';
import { createPinnedClient } from './pinning.js';

// Reserved names (RFC 6761 .invalid): these origins resolve nowhere.
export const HOSTILE_ORIGIN = 'mcp://hostile-demo.invalid';
export const BANK_ORIGIN = 'mcp://bank-demo.invalid';

// The tool a person approved last week from the bank's own server. Same name as the hostile get_balance.
export const BANK_TOOLS = [{
  name: 'get_balance',
  description: 'Get the customer\'s current account balance.',
  inputSchema: {
    type: 'object',
    properties: { account: { type: 'string', description: 'Account id' } },
    required: ['account'],
  },
}];

export async function createSession({ trusted = true, id = randomUUID() } = {}) {
  const state = createListState();
  const server = buildServer(state);
  const client = new Client({ name: 'pinned-demo-client', version: '1.0.0' }, { capabilities: {} });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);

  const pinned = createPinnedClient();
  if (trusted) pinned.approve(BANK_TOOLS, { origin: BANK_ORIGIN });

  const session = {
    id,
    pinned,
    lastList: null,
    async list() {
      const { tools } = await client.listTools();
      session.lastList = { listNumber: state.count, tools };
      return session.lastList;
    },
    // Trust on first use: approve whatever the last list contained.
    approve() {
      if (!session.lastList) return null;
      return pinned.approve(session.lastList.tools, { origin: HOSTILE_ORIGIN });
    },
    check(tools = session.lastList?.tools) {
      return pinned.check(tools, { origin: HOSTILE_ORIGIN });
    },
    async close() { await client.close(); await server.close(); },
  };
  return session;
}

// A small registry for the API: capped, with a time-to-live, oldest evicted first.
export function createSessions({ max = 20, ttlMs = 15 * 60_000, now = Date.now } = {}) {
  const live = new Map(); // id -> { session, touched }
  const sweep = async () => {
    for (const [id, e] of live) {
      if (now() - e.touched > ttlMs) { live.delete(id); await e.session.close().catch(() => {}); }
    }
    while (live.size >= max) {
      const [oldest] = live.keys();
      const e = live.get(oldest); live.delete(oldest); await e.session.close().catch(() => {});
    }
  };
  return {
    async create(opts) {
      await sweep();
      const session = await createSession(opts);
      live.set(session.id, { session, touched: now() });
      return session;
    },
    get(id) {
      const e = live.get(id);
      if (!e || now() - e.touched > ttlMs) return null;
      e.touched = now();
      return e.session;
    },
    async delete(id) {
      const e = live.get(id);
      if (!e) return false;
      live.delete(id); await e.session.close().catch(() => {});
      return true;
    },
    size: () => live.size,
  };
}
