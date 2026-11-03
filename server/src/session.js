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

// A small registry for the API. Every session belongs to one owner (the visitor that created it): only that owner can
// read, approve or delete it. Capped per owner (that owner's oldest goes first) and globally (least recently used goes
// first, set well above the per-owner cap), with a time-to-live.
export function createSessions({ max = 5000, perOwnerMax = 10, ttlMs = 15 * 60_000, now = Date.now } = {}) {
  const live = new Map(); // id -> { session, owner, touched }; Map order = oldest first
  const drop = async (id) => { const e = live.get(id); if (e) { live.delete(id); await e.session.close().catch(() => {}); } };
  const sweep = async (owner) => {
    for (const [id, e] of live) { if (now() - e.touched > ttlMs) await drop(id); }
    const mine = [...live].filter(([, e]) => e.owner === owner).map(([id]) => id);
    for (const id of mine.slice(0, Math.max(0, mine.length - perOwnerMax + 1))) await drop(id);
    while (live.size >= max) await drop(live.keys().next().value);
  };
  return {
    async create(opts = {}) {
      const { owner = 'anonymous', ...rest } = opts;
      await sweep(owner);
      const session = await createSession(rest);
      live.set(session.id, { session, owner, touched: now() });
      return session;
    },
    get(id, owner) {
      const e = live.get(id);
      if (!e || e.owner !== owner || now() - e.touched > ttlMs) return null;
      e.touched = now();
      live.delete(id); live.set(id, e);
      return e.session;
    },
    async delete(id, owner) {
      const e = live.get(id);
      if (!e || e.owner !== owner) return false;
      await drop(id);
      return true;
    },
    /** Every session owned by `owner` is dropped; returns how many (rule 3 reset). */
    async deleteAllFor(owner) {
      const mine = [...live].filter(([, e]) => e.owner === owner).map(([id]) => id);
      for (const id of mine) await drop(id);
      return mine.length;
    },
    size: () => live.size,
    sizeFor: (owner) => [...live.values()].filter((e) => e.owner === owner).length,
  };
}
