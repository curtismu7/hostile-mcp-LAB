// Identity for the web UI's /api/mcp-session/* calls. A visitor is a random id THIS server mints and sets as an HttpOnly
// hm_ui cookie; only ids in this server's own table count, so an id a client invents is ignored (a new one is minted).
// Minting is throttled per source (connection address, or the X-Forwarded-For hop when HOSTILE_TRUST_PROXY is set), and
// each visitor has its own rate on creating sessions, so one caller cannot churn the shared tables.
import { randomUUID } from 'node:crypto';
import { clientSource, createWindowLimiter } from './source.js';

export function createUiVisitors({ max = 5000, ttlMs = 30 * 60_000, now = Date.now, newId = randomUUID, mintsPerMin = 60, newPerMin = 30, trustProxy = 0 } = {}) {
  const table = new Map(); // id -> touched; Map order = least recently used first
  const mintOk = createWindowLimiter({ limit: mintsPerMin, now });
  const newOk = createWindowLimiter({ limit: newPerMin, now });
  const known = (id) => {
    const t = table.get(id);
    if (t === undefined) return false;
    if (now() - t > ttlMs) { table.delete(id); return false; }
    table.delete(id); table.set(id, now());
    return true;
  };
  return {
    // Returns { id } for a known visitor, a freshly minted one (sets the cookie), or { throttled: true } when over the mint rate.
    identify(req, res) {
      const cookie = /(?:^|;\s*)hm_ui=([\w-]{8,64})/.exec(req.headers.cookie || '')?.[1];
      if (cookie && known(cookie)) return { id: cookie };
      if (!mintOk(clientSource(req, trustProxy))) return { throttled: true };
      for (const [id, t] of table) { if (now() - t > ttlMs) table.delete(id); }
      while (table.size >= max) table.delete(table.keys().next().value);
      const id = newId();
      table.set(id, now());
      const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? '; Secure' : '';
      res.setHeader('Set-Cookie', `hm_ui=${id}; Path=/; HttpOnly; SameSite=Lax${secure}`);
      return { id };
    },
    allowNew: (id) => newOk(id),
    size: () => table.size,
  };
}
