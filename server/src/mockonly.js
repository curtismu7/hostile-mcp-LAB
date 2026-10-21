// MOCK_ONLY=1 (or "true"): the hosted-mock switch. Same name and behaviour in every sibling demo.
//  - refuses, server-side and in one place, any request that carries a user-supplied URL / host / credential / token;
//  - gives each visitor (cookie) their own rug-pull list counter on the stateless MCP endpoints.
// This app has no such feature today (no outbound call of any kind), so the guard is defence in depth: it keeps the
// refusal contract identical to the siblings and stops one being added by accident.
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

// Per-visitor rug-pull counters for the stateless MCP endpoints. Key = the hm_visitor cookie if the client sends one,
// else its remote address (an MCP client usually keeps no cookies). Behind a shared proxy, address-keyed visitors
// share a counter; send a distinct hm_visitor cookie to be isolated. Capped, oldest evicted.
export function createVisitorStates({ max = 500 } = {}) {
  const states = new Map();
  return (req) => {
    const m = /(?:^|;\s*)hm_visitor=([\w-]{8,64})/.exec(req.headers.cookie || '');
    const id = m ? `c:${m[1]}` : `ip:${req.socket.remoteAddress}`;
    if (!states.has(id)) {
      if (states.size >= max) states.delete(states.keys().next().value);
      states.set(id, createListState());
    }
    return states.get(id);
  };
}
