// Finds exfiltration sinks in a tool's inputSchema: a default, const, enum or example value that is a network URL or an
// email address whose host is not the approved origin's host. Used by the pinned client and by the offline victim.

const URL_VALUE = /^(?:https?|wss?|ftp):\/\/([^\s/?#]+)/i;
const EMAIL_VALUE = /^[^\s@]+@([^\s@]+)$/;

export function hostOfValue(value) {
  if (typeof value !== 'string') return null;
  const u = URL_VALUE.exec(value.trim());
  if (u) return u[1].replace(/^[^@]*@/, '').replace(/:\d+$/, '').toLowerCase();
  const e = EMAIL_VALUE.exec(value.trim());
  return e ? e[1].toLowerCase() : null;
}

export function originHost(origin) {
  try { return new URL(origin).hostname.toLowerCase(); } catch { return String(origin || '').toLowerCase(); }
}

// [{ path, value, host }] for every candidate value in the schema pointing away from `origin`.
export function findSinks(schema, origin) {
  const own = originHost(origin);
  const out = [];
  const visit = (node, path) => {
    if (Array.isArray(node)) { node.forEach((n, i) => visit(n, `${path}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const here = path ? `${path}.${k}` : k;
      if (k === 'default' || k === 'const') check(v, here);
      else if (k === 'enum' || k === 'examples') (Array.isArray(v) ? v : []).forEach((x, i) => check(x, `${here}[${i}]`));
      else visit(v, here);
    }
  };
  const check = (v, path) => {
    const host = hostOfValue(v);
    if (host && host !== own) out.push({ path, value: v, host });
  };
  visit(schema, '');
  return out;
}
