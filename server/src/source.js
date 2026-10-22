// Who is calling, for throttling only (never a state key). HOSTILE_TRUST_PROXY = number of trusted proxy hops in front
// of this server (default 0 = off: key on the TCP connection). With N > 0 the source is the Nth entry from the RIGHT of
// X-Forwarded-For, i.e. the left-most hop that is not one of our own proxies; anything a client prepends is ignored.
// Too few entries (or a missing header) falls back to the connection address.
export function trustHops(env = process.env) {
  const raw = String(env.HOSTILE_TRUST_PROXY ?? '').trim().toLowerCase();
  if (['true', 'yes', 'on'].includes(raw)) return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 5) : 0;
}

export function clientSource(req, hops = 0) {
  const conn = req.socket?.remoteAddress || 'unknown';
  if (!hops) return conn;
  const xff = []
    .concat(req.headers?.['x-forwarded-for'] || [])
    .join(',').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length >= hops ? xff[xff.length - hops] : conn;
}

// Fixed one-minute window counter per key.
export function createWindowLimiter({ limit, now = Date.now, windowMs = 60_000 }) {
  const w = new Map();
  return (key) => {
    const t = now();
    for (const [k, e] of w) { if (t - e.start >= windowMs) w.delete(k); }
    const e = w.get(key) || { start: t, n: 0 };
    w.set(key, e);
    return ++e.n <= limit;
  };
}
