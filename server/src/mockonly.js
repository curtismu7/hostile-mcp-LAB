// MOCK_ONLY=1 (or "true"): the hosted-mock switch. Same name and behaviour in every sibling demo.
//  - refuses, server-side and in one place, any request that carries a user-supplied URL / host / credential / token;
//  - gives each visitor (a server-minted MCP session / cookie) their own rug-pull list counter on the MCP endpoints.
// This app has no such feature today (no outbound call of any kind), so the guard is defence in depth: it keeps the
// refusal contract identical to the siblings and stops one being added by accident.
import { randomUUID } from 'node:crypto';
import { createListState } from './mcp/hostile.js';

export function mockOnly(env = process.env) { return ['1', 'true'].includes(String(env.MOCK_ONLY ?? '').trim().toLowerCase()); }

const FORBIDDEN_KEY = /^(url|uri|host|hostname|endpoint|upstream|gateway|baseurl|base_url|token|access_token|id_token|refresh_token|credential|credentials|secret|client_secret|password|api_key|apikey|authorization)$/i;

function hasForbiddenKey(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 6) return false;
  return Object.entries(v).some(([k, x]) => FORBIDDEN_KEY.test(k) || hasForbiddenKey(x, depth + 1));
}

export function mockOnlyGuard(enabled) {
  return (req, res, next) => {
    if (!enabled) return next();
    if (req.headers.authorization || hasForbiddenKey(req.body) || hasForbiddenKey(req.query)) {
      return res.status(403).json({ error: 'mock_only', message: 'Disabled in the hosted mock.' });
    }
    return next();
  };
}

// Per-visitor rug-pull counters for the MCP endpoints. The visitor identity is minted by THIS server on `initialize`
// (a random UUID returned as the Mcp-Session-Id header and as an HttpOnly, SameSite=Lax hm_visitor cookie, Secure behind
// https) and is looked up only in this server's own map. Neither the remote address nor an id the client invents is ever
// a key: a request with no identity, or one this server did not issue, gets a throwaway fresh state, so nobody shares a
// bucket and nobody can read another visitor's state without guessing a 122-bit id. The map is capped (LRU) with a TTL.
// A flood of `initialize` calls can still evict real visitors, which only resets their demo.
export function createVisitorStates({ max = 500, ttlMs = 30 * 60_000, now = Date.now, newId = randomUUID } = {}) {
  const states = new Map(); // id -> { state, touched }; Map order = least recently used first
  const live = (id) => {
    const e = states.get(id);
    if (!e) return null;
    if (now() - e.touched > ttlMs) { states.delete(id); return null; }
    e.touched = now();
    states.delete(id); states.set(id, e);
    return e.state;
  };
  const isInit = (b) => (Array.isArray(b) ? b : [b]).some((m) => m?.method === 'initialize');
  const resolve = (req, res) => {
    const cookie = /(?:^|;\s*)hm_visitor=([\w-]{8,64})/.exec(req.headers.cookie || '')?.[1];
    const known = live(String(req.headers['mcp-session-id'] || '')) || live(cookie || '');
    if (known) return known;
    if (!res || req.method !== 'POST' || !isInit(req.body)) return createListState();
    for (const [id, e] of states) { if (now() - e.touched > ttlMs) states.delete(id); }
    while (states.size >= max) states.delete(states.keys().next().value);
    const id = newId();
    const state = createListState();
    states.set(id, { state, touched: now() });
    const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? '; Secure' : '';
    res.setHeader('Mcp-Session-Id', id);
    res.setHeader('Set-Cookie', `hm_visitor=${id}; Path=/; HttpOnly; SameSite=Lax${secure}`);
    return state;
  };
  resolve.size = () => states.size;
  return resolve;
}
